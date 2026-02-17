/* eslint-disable @typescript-eslint/no-require-imports */

const mockSecretsManagerSend = jest.fn()
const mockDynamoSend = jest.fn()

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsManagerSend })),
  GetSecretValueCommand: jest.fn((input: unknown) => ({
    _type: 'GetSecretValue',
    _input: input,
  })),
  PutSecretValueCommand: jest.fn((input: unknown) => ({
    _type: 'PutSecretValue',
    _input: input,
  })),
  DeleteSecretCommand: jest.fn((input: unknown) => ({
    _type: 'DeleteSecret',
    _input: input,
  })),
  CreateSecretCommand: jest.fn((input: unknown) => ({
    _type: 'CreateSecret',
    _input: input,
  })),
  ListSecretsCommand: jest.fn((input: unknown) => ({
    _type: 'ListSecrets',
    _input: input,
  })),
  TagResourceCommand: jest.fn((input: unknown) => ({
    _type: 'TagResource',
    _input: input,
  })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    name = 'ResourceNotFoundException'
  },
}))

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}))

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockDynamoSend })),
  },
  PutCommand: jest.fn((input: unknown) => ({ _type: 'Put', _input: input })),
  GetCommand: jest.fn((input: unknown) => ({ _type: 'Get', _input: input })),
  QueryCommand: jest.fn((input: unknown) => ({
    _type: 'Query',
    _input: input,
  })),
  UpdateCommand: jest.fn((input: unknown) => ({
    _type: 'Update',
    _input: input,
  })),
}))

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'rollback-uuid-123'),
}))

process.env.TABLE_NAME = 'test-table'
process.env.KMS_KEY_ID = 'test-key-id'
process.env.SECRETS_PREFIX = 'secret-review/'
process.env.PROJECTS_CONFIG = JSON.stringify({
  'backend-api': ['dev', 'production'],
})

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda'

type Result = APIGatewayProxyStructuredResultV2

const APPROVED_CHANGE = {
  pk: 'PROJECT#backend-api#ENV#production',
  sk: 'CHANGE#2025-01-01T00:00:00.000Z#change-123',
  changeId: 'change-123',
  project: 'backend-api',
  env: 'production',
  status: 'approved',
  proposedBy: 'alice@test.com',
  stagingSecretName: 'secret-review/pending/change-123',
  diff: [{ type: 'added', key: 'NEW_KEY' }],
  diffCount: 1,
  reason: 'Add new key',
  createdAt: '2025-01-01T00:00:00.000Z',
  reviewedBy: 'reviewer@test.com',
  reviewedAt: '2025-01-01T01:00:00.000Z',
  previousVersionId: 'prev-version-id',
}

function makeEvent(
  overrides: Record<string, unknown> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    body: JSON.stringify({
      changeId: 'change-123',
      reason: 'Broke production',
    }),
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: { email: 'admin@test.com', sub: 'user-admin' },
          scopes: [],
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext'],
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
}

describe('Rollback handler', () => {
  let handler: typeof import('../../src/lambda/handlers/rollback').handler

  beforeEach(() => {
    jest.clearAllMocks()
    jest.isolateModules(() => {
      handler = require('../../src/lambda/handlers/rollback').handler
    })
  })

  test('rolls back using AWSPREVIOUS version stage', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [APPROVED_CHANGE] }
      }
      // PutCommand for rollback record
      return {}
    })

    mockSecretsManagerSend.mockImplementation(
      (cmd: { _type: string; _input?: { VersionStage?: string } }) => {
        if (cmd._type === 'GetSecretValue') {
          // AWSPREVIOUS version stage read
          return {
            SecretString: JSON.stringify({
              DB_URL: 'postgres://old-url',
              OLD_KEY: 'old-value',
            }),
            VersionId: 'prev-version-id',
          }
        }
        if (cmd._type === 'PutSecretValue') {
          return {}
        }
        return {}
      },
    )

    const result = (await handler(makeEvent())) as Result
    const body = JSON.parse(result.body as string)

    expect(result.statusCode).toBe(200)
    expect(body.message).toContain('Rolled back change change-123')
    expect(body.rollbackId).toBe('rollback-uuid-123')

    // Verify the GetSecretValue was called with AWSPREVIOUS
    const getCalls = mockSecretsManagerSend.mock.calls.filter(
      (c: Array<{ _type: string }>) => c[0]._type === 'GetSecretValue',
    )
    expect(getCalls.length).toBe(1)
    expect(getCalls[0][0]._input.VersionStage).toBe('AWSPREVIOUS')

    // Verify PutSecretValue was called with the rolled-back values
    const putCalls = mockSecretsManagerSend.mock.calls.filter(
      (c: Array<{ _type: string }>) => c[0]._type === 'PutSecretValue',
    )
    expect(putCalls.length).toBe(1)
    expect(JSON.parse(putCalls[0][0]._input.SecretString)).toEqual({
      DB_URL: 'postgres://old-url',
      OLD_KEY: 'old-value',
    })

    // Verify DynamoDB rollback record was created with currentKeys
    const dynamoPutCalls = mockDynamoSend.mock.calls.filter(
      (c: Array<{ _type: string }>) => c[0]._type === 'Put',
    )
    expect(dynamoPutCalls.length).toBe(1)
    expect(dynamoPutCalls[0][0]._input.Item.currentKeys).toEqual([
      'DB_URL',
      'OLD_KEY',
    ])
    expect(dynamoPutCalls[0][0]._input.Item.reason).toContain('Rollback')
  })

  test('rejects non-approved changes', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [{ ...APPROVED_CHANGE, status: 'pending' }] }
      }
      return {}
    })

    const result = (await handler(makeEvent())) as Result
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body as string).error).toContain(
      'Can only rollback approved changes',
    )
  })

  test('returns error when AWSPREVIOUS not available', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [APPROVED_CHANGE] }
      }
      return {}
    })

    // Return no SecretString -- getSecretByVersionStage returns undefined
    mockSecretsManagerSend.mockImplementation(() => {
      return {}
    })

    const result = (await handler(makeEvent())) as Result
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body as string).error).toContain(
      'Previous version not available',
    )
  })

  test('returns 404 when change not found', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [] }
      }
      return {}
    })

    const result = (await handler(makeEvent())) as Result
    expect(result.statusCode).toBe(404)
  })

  test('rejects missing required fields', async () => {
    const event = makeEvent({
      body: JSON.stringify({ changeId: 'change-123' }),
    })

    const result = (await handler(event)) as Result
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body as string).error).toContain(
      'Missing required fields',
    )
  })
})

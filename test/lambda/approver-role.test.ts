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

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}))

process.env.TABLE_NAME = 'test-table'

process.env.SECRETS_PREFIX = 'secret-review/'
process.env.PROJECTS_CONFIG = JSON.stringify({
  'backend-api': ['dev', 'production'],
})
process.env.PREVENT_SELF_APPROVAL = 'true'
process.env.ENABLE_APPROVER_ROLE = 'true'

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda'

type Result = APIGatewayProxyStructuredResultV2

const PENDING_CHANGE = {
  pk: 'PROJECT#backend-api#ENV#production',
  sk: 'CHANGE#2025-01-01T00:00:00.000Z#change-123',
  changeId: 'change-123',
  project: 'backend-api',
  env: 'production',
  status: 'pending',
  proposedBy: 'alice@test.com',
  stagingSecretName: 'secret-review/pending/change-123',
  diff: [{ type: 'added', key: 'NEW_KEY' }],
  diffCount: 1,
  reason: 'Add new key',
  createdAt: '2025-01-01T00:00:00.000Z',
  secretVersionId: 'version-abc-123',
}

function makeEvent(
  groups: string[],
  email = 'reviewer@test.com',
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    body: JSON.stringify({ comment: 'LGTM' }),
    pathParameters: { changeId: 'change-123' },
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            email: email,
            sub: 'user-456',
            'cognito:groups': groups,
          },
          scopes: [],
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext'],
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
}

describe('Approver role', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('approve handler', () => {
    let handler: typeof import('../../src/lambda/handlers/approve').handler

    beforeEach(() => {
      jest.isolateModules(() => {
        handler = require('../../src/lambda/handlers/approve').handler
      })
    })

    test('allows user in approver group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      mockSecretsManagerSend.mockImplementation(
        (cmd: { _type: string; _input?: { SecretId?: string } }) => {
          if (cmd._type === 'GetSecretValue') {
            if (cmd._input?.SecretId?.includes('pending/')) {
              return {
                SecretString: JSON.stringify({
                  proposed: { DB_URL: 'new-url' },
                  previous: { DB_URL: 'old-url' },
                  project: 'backend-api',
                  env: 'production',
                }),
              }
            }
            return {
              SecretString: JSON.stringify({ DB_URL: 'old-url' }),
              VersionId: 'version-abc-123',
            }
          }
          return {}
        },
      )

      const event = makeEvent(['backend-api-approvers'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(200)
    })

    test('denies user NOT in approver group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      const event = makeEvent(['backend-api'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
      expect(JSON.parse(result.body as string).error).toContain(
        'backend-api-approvers',
      )
    })
  })

  describe('reject handler', () => {
    let handler: typeof import('../../src/lambda/handlers/reject').handler

    beforeEach(() => {
      jest.isolateModules(() => {
        handler = require('../../src/lambda/handlers/reject').handler
      })
    })

    test('allows user in approver group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })
      mockSecretsManagerSend.mockResolvedValue({})

      const event = makeEvent(['backend-api-approvers'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(200)
    })

    test('denies user NOT in approver group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      const event = makeEvent(['backend-api'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
    })
  })

  describe('rollback handler', () => {
    let handler: typeof import('../../src/lambda/handlers/rollback').handler

    beforeEach(() => {
      jest.isolateModules(() => {
        handler = require('../../src/lambda/handlers/rollback').handler
      })
    })

    test('denies user NOT in approver group', async () => {
      const approvedChange = { ...PENDING_CHANGE, status: 'approved' }
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [approvedChange] }
        return {}
      })

      const event = {
        body: JSON.stringify({ changeId: 'change-123', reason: 'Revert' }),
        queryStringParameters: {},
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                email: 'reviewer@test.com',
                sub: 'user-456',
                'cognito:groups': ['backend-api'],
              },
              scopes: [],
            },
          },
        },
      } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer

      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
      expect(JSON.parse(result.body as string).error).toContain(
        'backend-api-approvers',
      )
    })
  })

  describe('assertApproverAccess', () => {
    test('returns undefined when feature is disabled', () => {
      const savedVal = process.env.ENABLE_APPROVER_ROLE
      delete process.env.ENABLE_APPROVER_ROLE

      let assertApproverAccess: typeof import('../../src/lambda/handlers/shared/auth').assertApproverAccess
      jest.isolateModules(() => {
        assertApproverAccess =
          require('../../src/lambda/handlers/shared/auth').assertApproverAccess
      })

      const event = makeEvent([])
      const result = assertApproverAccess!(event, 'backend-api')
      expect(result).toBeUndefined()

      if (savedVal !== undefined) process.env.ENABLE_APPROVER_ROLE = savedVal
      else process.env.ENABLE_APPROVER_ROLE = 'true'
    })
  })
})

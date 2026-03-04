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

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}))

process.env.TABLE_NAME = 'test-table'
process.env.KMS_KEY_ID = 'test-key-id'
process.env.SECRETS_PREFIX = 'secret-review/'
process.env.PROJECTS_CONFIG = JSON.stringify({
  'backend-api': ['dev', 'production'],
  'frontend': ['dev', 'production'],
})
process.env.PREVENT_SELF_APPROVAL = 'true'
process.env.ENABLE_PROJECT_SCOPING = 'true'

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
  overrides: Record<string, unknown> = {},
  groups: string[] = ['backend-api'],
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    body: JSON.stringify({ comment: 'Looks good' }),
    pathParameters: { changeId: 'change-123' },
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            'email': 'reviewer@test.com',
            'sub': 'user-456',
            'cognito:groups': groups,
          },
          scopes: [],
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext'],
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
}

describe('Project scoping', () => {
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

    test('allows access when user is in project group', async () => {
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

      const event = makeEvent({}, ['backend-api'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(200)
    })

    test('denies access when user is not in project group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      const event = makeEvent({}, ['frontend'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
      expect(JSON.parse(result.body as string).error).toContain(
        'Access denied',
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

    test('denies access when user is not in project group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      const event = makeEvent({}, ['frontend'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
    })
  })

  describe('diff handler', () => {
    let handler: typeof import('../../src/lambda/handlers/diff').handler

    beforeEach(() => {
      jest.isolateModules(() => {
        handler = require('../../src/lambda/handlers/diff').handler
      })
    })

    test('denies access when user is not in project group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      const event = makeEvent({}, ['frontend'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
    })

    test('allows access when user is in project group', async () => {
      mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
        if (cmd._type === 'Query') return { Items: [PENDING_CHANGE] }
        return {}
      })

      const event = makeEvent({}, ['backend-api'])
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(200)
    })
  })

  describe('history handler', () => {
    let handler: typeof import('../../src/lambda/handlers/history').handler

    beforeEach(() => {
      jest.isolateModules(() => {
        handler = require('../../src/lambda/handlers/history').handler
      })
    })

    test('denies access when user is not in project group', async () => {
      const event = makeEvent(
        {
          pathParameters: { project: 'backend-api', env: 'production' },
        },
        ['frontend'],
      )
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(403)
    })

    test('validates project/env against PROJECTS_CONFIG', async () => {
      const event = makeEvent(
        {
          pathParameters: { project: 'nonexistent', env: 'dev' },
        },
        ['nonexistent'],
      )
      const result = (await handler(event)) as Result
      expect(result.statusCode).toBe(400)
      expect(JSON.parse(result.body as string).error).toContain(
        'Invalid project/environment',
      )
    })
  })

  describe('list-changes handler', () => {
    let handler: typeof import('../../src/lambda/handlers/list-changes').handler

    beforeEach(() => {
      jest.isolateModules(() => {
        handler = require('../../src/lambda/handlers/list-changes').handler
      })
    })

    test('filters changes by project group membership', async () => {
      const backendChange = {
        ...PENDING_CHANGE,
        changeId: 'change-1',
        project: 'backend-api',
      }
      const frontendChange = {
        ...PENDING_CHANGE,
        changeId: 'change-2',
        project: 'frontend',
      }

      mockDynamoSend.mockImplementation(() => ({
        Items: [backendChange, frontendChange],
      }))

      const event = makeEvent(
        {
          pathParameters: {},
          queryStringParameters: { status: 'pending' },
        },
        ['backend-api'],
      )

      const result = (await handler(event)) as Result
      const body = JSON.parse(result.body as string)
      expect(body.changes).toHaveLength(1)
      expect(body.changes[0].project).toBe('backend-api')
    })
  })

  describe('getUserGroups parsing', () => {
    test('handles array groups claim', () => {
      const { getUserGroups } =
        require('../../src/lambda/handlers/shared/auth') as typeof import('../../src/lambda/handlers/shared/auth')

      const event = makeEvent({}, ['backend-api', 'frontend'])
      const groups = getUserGroups(event)
      expect(groups).toEqual(['backend-api', 'frontend'])
    })

    test('handles JSON string groups claim', () => {
      const { getUserGroups } =
        require('../../src/lambda/handlers/shared/auth') as typeof import('../../src/lambda/handlers/shared/auth')

      const event = {
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'cognito:groups': '["backend-api","frontend"]',
              },
              scopes: [],
            },
          },
        },
      } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer

      const groups = getUserGroups(event)
      expect(groups).toEqual(['backend-api', 'frontend'])
    })

    test('handles missing groups claim', () => {
      const { getUserGroups } =
        require('../../src/lambda/handlers/shared/auth') as typeof import('../../src/lambda/handlers/shared/auth')

      const event = {
        requestContext: {
          authorizer: {
            jwt: {
              claims: { email: 'test@test.com' },
              scopes: [],
            },
          },
        },
      } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer

      const groups = getUserGroups(event)
      expect(groups).toEqual([])
    })
  })
})

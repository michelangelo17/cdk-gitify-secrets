/* eslint-disable @typescript-eslint/no-require-imports */

const mockSecretsManagerSend = jest.fn();
const mockDynamoSend = jest.fn();

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
    name = 'ResourceNotFoundException';
  },
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

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
}));

process.env.TABLE_NAME = 'test-table';
process.env.KMS_KEY_ID = 'test-key-id';
process.env.SECRETS_PREFIX = 'secret-review/';
process.env.PROJECTS_CONFIG = JSON.stringify({
  'backend-api': ['dev', 'production'],
});
process.env.PREVENT_SELF_APPROVAL = 'true';

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

type Result = APIGatewayProxyStructuredResultV2;

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
};

function makeEvent(
  overrides: Record<string, unknown> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    body: JSON.stringify({ comment: 'Looks good' }),
    pathParameters: { changeId: 'change-123' },
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: { email: 'reviewer@test.com', sub: 'user-456' },
          scopes: [],
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext'],
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('Approve handler', () => {
  let handler: typeof import('../../src/lambda/handlers/approve').handler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.isolateModules(() => {
      handler = require('../../src/lambda/handlers/approve').handler;
    });
  });

  test('happy path: copies values, deletes staging, updates DDB', async () => {
    // getChangeById via Query
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [PENDING_CHANGE] };
      }
      // UpdateCommand
      return {};
    });

    let getCallCount = 0;
    mockSecretsManagerSend.mockImplementation(
      (cmd: { _type: string; _input?: { SecretId?: string } }) => {
        if (cmd._type === 'GetSecretValue') {
          if (cmd._input?.SecretId?.includes('pending/')) {
            // Staging secret
            return {
              SecretString: JSON.stringify({
                proposed: { DB_URL: 'new-url', NEW_KEY: 'value' },
                previous: { DB_URL: 'old-url' },
                project: 'backend-api',
                env: 'production',
              }),
            };
          }
          // Real secret reads (concurrency check + capture previous versionId)
          getCallCount++;
          return {
            SecretString: JSON.stringify({ DB_URL: 'old-url' }),
            VersionId: 'version-abc-123',
          };
        }
        // PutSecretValue or DeleteSecret
        return {};
      },
    );

    const result = (await handler(makeEvent())) as Result;
    const body = JSON.parse(result.body as string);

    expect(result.statusCode).toBe(200);
    expect(body.message).toContain('approved and applied');

    // Verify Secrets Manager was called to write new values
    const putCalls = mockSecretsManagerSend.mock.calls.filter(
      (c: Array<{ _type: string }>) => c[0]._type === 'PutSecretValue',
    );
    expect(putCalls.length).toBe(1);

    // Verify staging secret was deleted
    const deleteCalls = mockSecretsManagerSend.mock.calls.filter(
      (c: Array<{ _type: string }>) => c[0]._type === 'DeleteSecret',
    );
    expect(deleteCalls.length).toBe(1);
  });

  test('rejects self-approval', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [PENDING_CHANGE] };
      }
      return {};
    });

    // Use the proposer's email as the reviewer
    const event = makeEvent({
      requestContext: {
        authorizer: {
          jwt: {
            claims: { email: 'alice@test.com', sub: 'user-789' },
            scopes: [],
          },
        },
      },
    });

    const result = (await handler(event)) as Result;
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body as string).error).toContain(
      'Cannot approve your own changes',
    );
  });

  test('rejects non-pending changes', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [{ ...PENDING_CHANGE, status: 'approved' }] };
      }
      return {};
    });

    const result = (await handler(makeEvent())) as Result;
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error).toContain(
      'already approved',
    );
  });

  test('fails on version conflict (optimistic concurrency)', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [PENDING_CHANGE] };
      }
      return {};
    });

    // Real secret has a different VersionId now
    mockSecretsManagerSend.mockImplementation(
      (cmd: { _type: string; _input?: { SecretId?: string } }) => {
        if (cmd._type === 'GetSecretValue') {
          if (cmd._input?.SecretId?.includes('pending/')) {
            return {
              SecretString: JSON.stringify({
                proposed: { DB_URL: 'new' },
                previous: { DB_URL: 'old' },
                project: 'backend-api',
                env: 'production',
              }),
            };
          }
          return {
            SecretString: JSON.stringify({ DB_URL: 'old' }),
            VersionId: 'DIFFERENT-version-id',
          };
        }
        return {};
      },
    );

    const result = (await handler(makeEvent())) as Result;
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error).toContain('Conflict');
  });

  test('returns 404 when change not found', async () => {
    mockDynamoSend.mockImplementation((cmd: { _type: string }) => {
      if (cmd._type === 'Query') {
        return { Items: [] };
      }
      return {};
    });

    const result = (await handler(makeEvent())) as Result;
    expect(result.statusCode).toBe(404);
  });
});

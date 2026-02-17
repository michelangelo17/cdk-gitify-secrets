/* eslint-disable @typescript-eslint/no-require-imports */

// Mock AWS SDK modules before importing handler
const mockGetSecretValueCommand = jest.fn();
const mockSecretsManagerSend = jest.fn();

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsManagerSend })),
  GetSecretValueCommand: jest.fn((input: unknown) => {
    mockGetSecretValueCommand(input);
    return { _input: input };
  }),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    name = 'ResourceNotFoundException';
  },
}));

const mockPutCommand = jest.fn();
const mockQueryCommand = jest.fn();
const mockDynamoSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockDynamoSend })),
  },
  PutCommand: jest.fn((input: unknown) => {
    mockPutCommand(input);
    return { _type: 'Put', _input: input };
  }),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn((input: unknown) => {
    mockQueryCommand(input);
    return { _type: 'Query', _input: input };
  }),
  UpdateCommand: jest.fn(),
}));

// Set env vars before importing handlers
process.env.TABLE_NAME = 'test-table';
process.env.KMS_KEY_ID = 'test-key-id';
process.env.SECRETS_PREFIX = 'secret-review/';
process.env.PROJECTS_CONFIG = JSON.stringify({
  'backend-api': ['dev', 'production'],
});

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

type Result = APIGatewayProxyStructuredResultV2;

function makeEvent(
  overrides: Record<string, unknown> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    body: JSON.stringify({
      project: 'backend-api',
      env: 'production',
      stagingSecretName: 'secret-review/pending/test-change-id',
      reason: 'Test change',
    }),
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: { email: 'dev@test.com', sub: 'user-123' },
          scopes: [],
        },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer['requestContext'],
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe('Propose handler', () => {
  let handler: typeof import('../../src/lambda/handlers/propose').handler;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-require to reset module state
    jest.isolateModules(() => {
      handler = require('../../src/lambda/handlers/propose').handler;
    });
  });

  test('creates a valid proposal and stores metadata', async () => {
    // Mock staging secret read
    mockSecretsManagerSend.mockImplementation(
      (cmd: { _input?: { SecretId?: string; VersionStage?: string } }) => {
        if (cmd._input?.SecretId?.includes('pending/')) {
          return {
            SecretString: JSON.stringify({
              proposed: { DB_URL: 'postgres://new', API_KEY: 'new-key' },
              previous: { DB_URL: 'postgres://old' },
              project: 'backend-api',
              env: 'production',
            }),
          };
        }
        // Real secret read
        return {
          SecretString: JSON.stringify({ DB_URL: 'postgres://old' }),
          VersionId: 'version-abc-123',
        };
      },
    );

    mockDynamoSend.mockResolvedValue({});

    const result = (await handler(makeEvent())) as Result;
    const body = JSON.parse(result.body as string);

    expect(result.statusCode).toBe(200);
    expect(body.changeId).toBe('test-change-id');
    expect(body.diff).toEqual(
      expect.arrayContaining([
        { type: 'modified', key: 'DB_URL' },
        { type: 'added', key: 'API_KEY' },
      ]),
    );
    expect(body.diffCount).toBe(2);

    // Verify DynamoDB put was called with secretVersionId
    expect(mockPutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Item: expect.objectContaining({
          secretVersionId: 'version-abc-123',
          changeId: 'test-change-id',
          status: 'pending',
        }),
      }),
    );
  });

  test('rejects invalid project/env', async () => {
    const event = makeEvent({
      body: JSON.stringify({
        project: 'unknown-project',
        env: 'production',
        stagingSecretName: 'secret-review/pending/test-id',
        reason: 'Test',
      }),
    });

    const result = (await handler(event)) as Result;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain(
      'Invalid project/environment',
    );
  });

  test('rejects missing required fields', async () => {
    const event = makeEvent({
      body: JSON.stringify({ project: 'backend-api' }),
    });

    const result = (await handler(event)) as Result;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain(
      'Missing required fields',
    );
  });

  test('returns error when staging secret not found', async () => {
    // Return no SecretString for the staging secret -- getStagingSecretValue returns undefined
    mockSecretsManagerSend.mockImplementation(
      (cmd: { _input?: { SecretId?: string } }) => {
        if (cmd._input?.SecretId?.includes('pending/')) {
          return {};
        }
        return { SecretString: JSON.stringify({}), VersionId: 'v1' };
      },
    );

    const result = (await handler(makeEvent())) as Result;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error).toContain(
      'Staging secret not found',
    );
  });

  test('returns no-diff message when no changes detected', async () => {
    mockSecretsManagerSend.mockImplementation(
      (cmd: { _input?: { SecretId?: string } }) => {
        if (cmd._input?.SecretId?.includes('pending/')) {
          return {
            SecretString: JSON.stringify({
              proposed: { DB_URL: 'postgres://same' },
              previous: { DB_URL: 'postgres://same' },
              project: 'backend-api',
              env: 'production',
            }),
          };
        }
        return {
          SecretString: JSON.stringify({ DB_URL: 'postgres://same' }),
          VersionId: 'v1',
        };
      },
    );

    const result = (await handler(makeEvent())) as Result;
    const body = JSON.parse(result.body as string);
    expect(result.statusCode).toBe(200);
    expect(body.message).toBe('No changes detected');
  });
});

export const DEFAULT_TEST_CONFIG = {
  apiUrl: 'https://api.test.com',
  clientId: 'test-client',
  region: 'us-east-1',
  secretPrefix: 'secret-review/',
  idToken: 'test-token',
}

export const SDK_MOCKS = {
  secretsManager: () => ({
    SecretsManagerClient: jest.fn(() => ({ send: jest.fn() })),
    GetSecretValueCommand: jest.fn(),
    ResourceNotFoundException: class ResourceNotFoundException extends Error {
      name = 'ResourceNotFoundException'
    },
  }),
  cloudformation: () => ({
    CloudFormationClient: jest.fn(),
    DescribeStacksCommand: jest.fn(),
  }),
  cognito: () => ({
    CognitoIdentityProviderClient: jest.fn(),
    InitiateAuthCommand: jest.fn(),
  }),
}

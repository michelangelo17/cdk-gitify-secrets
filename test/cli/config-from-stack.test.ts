const mockCfnSend = jest.fn()
const MockCfnClient = jest.fn(() => ({ send: mockCfnSend }))

jest.mock('@aws-sdk/client-cloudformation', () => ({
  CloudFormationClient: MockCfnClient,
  DescribeStacksCommand: jest.fn((input: unknown) => ({
    _type: 'DescribeStacks',
    _input: input,
  })),
}))

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(),
  InitiateAuthCommand: jest.fn(),
}))

import { configFromStack } from '../../src/cli/auth'

describe('configFromStack', () => {
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    for (const key of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    ]) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test('maps stack outputs to CliConfig fields', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.example.com' },
            { OutputKey: 'UserPoolId', OutputValue: 'us-east-1_abc123' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-xyz' },
            { OutputKey: 'SecretPrefix', OutputValue: 'my-prefix/' },
            {
              OutputKey: 'FrontendUrl',
              OutputValue: 'https://dashboard.example.com',
            },
          ],
        },
      ],
    })

    const result = await configFromStack('MyStack', 'us-east-1')

    expect(result).toEqual({
      region: 'us-east-1',
      apiUrl: 'https://api.example.com',
      userPoolId: 'us-east-1_abc123',
      clientId: 'client-xyz',
      secretPrefix: 'my-prefix/',
    })
  })

  test('matches CDK-generated output keys with prefix and hash suffix', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            {
              OutputKey: 'SecretReviewApiUrl96A20576',
              OutputValue: 'https://xxx.execute-api.us-west-2.amazonaws.com/',
            },
            {
              OutputKey: 'SecretReviewUserPoolId4B18B7C1',
              OutputValue: 'us-west-2_pXVYocgMs',
            },
            {
              OutputKey: 'SecretReviewUserPoolClientIdD877B95D',
              OutputValue: '7r4arb941iqcqukpfm00qd04li',
            },
            {
              OutputKey: 'SecretReviewSecretPrefixE22BDC15',
              OutputValue: 'secret-review/',
            },
            {
              OutputKey: 'SecretReviewFrontendUrl0E9D6828',
              OutputValue: 'https://d2o338jzjmykgt.cloudfront.net',
            },
          ],
        },
      ],
    })

    const result = await configFromStack('SecretReviewStack', 'us-west-2')

    expect(result).toEqual({
      region: 'us-west-2',
      apiUrl: 'https://xxx.execute-api.us-west-2.amazonaws.com/',
      userPoolId: 'us-west-2_pXVYocgMs',
      clientId: '7r4arb941iqcqukpfm00qd04li',
      secretPrefix: 'secret-review/',
    })
  })

  test('works with missing optional outputs', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.example.com' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-xyz' },
          ],
        },
      ],
    })

    const result = await configFromStack('MyStack', 'eu-west-1')

    expect(result).toEqual({
      region: 'eu-west-1',
      apiUrl: 'https://api.example.com',
      clientId: 'client-xyz',
    })
  })

  test('throws when stack is not found', async () => {
    mockCfnSend.mockResolvedValue({ Stacks: [] })

    await expect(configFromStack('MissingStack', 'us-east-1')).rejects.toThrow(
      'Stack "MissingStack" not found in region us-east-1',
    )
  })

  test('throws when Stacks is undefined', async () => {
    mockCfnSend.mockResolvedValue({})

    await expect(configFromStack('BadStack', 'us-east-1')).rejects.toThrow(
      'Stack "BadStack" not found',
    )
  })

  test('throws when ApiUrl output is missing', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [{ OutputKey: 'UserPoolId', OutputValue: 'us-east-1_abc' }],
        },
      ],
    })

    await expect(configFromStack('NoApiStack', 'us-east-1')).rejects.toThrow(
      'missing the ApiUrl output',
    )
  })

  test('handles stack with no outputs', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [{ Outputs: undefined }],
    })

    await expect(configFromStack('EmptyStack', 'us-east-1')).rejects.toThrow(
      'missing the ApiUrl output',
    )
  })

  test('uses explicit credentials from env vars when set', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST'
    process.env.AWS_SECRET_ACCESS_KEY = 'secret123'
    process.env.AWS_SESSION_TOKEN = 'tok456'

    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.example.com' },
          ],
        },
      ],
    })

    await configFromStack('MyStack', 'us-east-1')

    expect(MockCfnClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secret123',
        sessionToken: 'tok456',
      },
    })
  })

  test('omits sessionToken when AWS_SESSION_TOKEN is not set', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST'
    process.env.AWS_SECRET_ACCESS_KEY = 'secret123'

    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.example.com' },
          ],
        },
      ],
    })

    await configFromStack('MyStack', 'us-east-1')

    expect(MockCfnClient).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secret123',
      },
    })
  })

  test('uses default provider chain when env vars are not set', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.example.com' },
          ],
        },
      ],
    })

    await configFromStack('MyStack', 'us-east-1')

    expect(MockCfnClient).toHaveBeenCalledWith({
      region: 'us-east-1',
    })
  })
})

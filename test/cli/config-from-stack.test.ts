const mockCfnSend = jest.fn()

jest.mock('@aws-sdk/client-cloudformation', () => ({
  CloudFormationClient: jest.fn(() => ({ send: mockCfnSend })),
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
  beforeEach(() => {
    jest.clearAllMocks()
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
            { OutputKey: 'FrontendUrl', OutputValue: 'https://dashboard.example.com' },
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
          Outputs: [
            { OutputKey: 'UserPoolId', OutputValue: 'us-east-1_abc' },
          ],
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
})

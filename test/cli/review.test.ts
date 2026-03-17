import { SDK_MOCKS, DEFAULT_TEST_CONFIG } from './_helpers'

const mockSmSend = jest.fn()

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSmSend })),
  GetSecretValueCommand: jest.fn((input: unknown) => ({
    _type: 'GetSecretValue',
    _input: input,
  })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    name = 'ResourceNotFoundException'
  },
}))

jest.mock('@aws-sdk/client-cloudformation', () => SDK_MOCKS.cloudformation())
jest.mock('@aws-sdk/client-cognito-identity-provider', () =>
  SDK_MOCKS.cognito(),
)

const mockApiRequest = jest.fn()
jest.mock('../../src/cli/auth', () => ({
  ...jest.requireActual('../../src/cli/auth'),
  apiRequest: mockApiRequest,
  requireConfig: jest.fn(() => ({ ...DEFAULT_TEST_CONFIG })),
  awsCredentials: jest.fn(() => undefined),
}))

import { reviewChange } from '../../src/cli/commands/review'
const { ResourceNotFoundException } = jest.requireMock(
  '@aws-sdk/client-secrets-manager',
) as { ResourceNotFoundException: new (msg: string) => Error }

describe('reviewChange', () => {
  const config = {
    apiUrl: 'https://api.test.com',
    clientId: 'test-client',
    region: 'us-east-1',
    secretPrefix: 'secret-review/',
    idToken: 'test-token',
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('computes added, modified, removed, and unchanged diffs', async () => {
    mockApiRequest.mockResolvedValue({
      changeId: 'change-1',
      project: 'api',
      env: 'dev',
      status: 'pending',
      proposedBy: 'alice@test.com',
      reason: 'Update',
      createdAt: '2025-01-01T00:00:00Z',
      diff: [
        { type: 'added', key: 'NEW' },
        { type: 'modified', key: 'DB' },
      ],
    })

    mockSmSend
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({
          proposed: { NEW: 'val', DB: 'new-url', KEEP: 'same' },
        }),
      })
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({
          DB: 'old-url',
          KEEP: 'same',
          OLD: 'gone',
        }),
      })

    const result = await reviewChange('change-1', config)

    expect(result.added).toEqual({ NEW: 'val' })
    expect(result.removed).toEqual({ OLD: 'gone' })
    expect(result.modified).toEqual({ DB: { old: 'old-url', new: 'new-url' } })
    expect(result.unchanged).toEqual({ KEEP: 'same' })
  })

  test('handles first-time secret (no live secret)', async () => {
    mockApiRequest.mockResolvedValue({
      changeId: 'change-2',
      project: 'api',
      env: 'dev',
      status: 'pending',
      proposedBy: 'alice@test.com',
      reason: 'First deploy',
      createdAt: '2025-01-01T00:00:00Z',
      diff: [{ type: 'added', key: 'DB' }],
    })

    mockSmSend
      .mockResolvedValueOnce({
        SecretString: JSON.stringify({
          proposed: { DB: 'new-url', API_KEY: 'secret' },
        }),
      })
      .mockRejectedValueOnce(new ResourceNotFoundException('not found'))

    const result = await reviewChange('change-2', config)

    expect(result.added).toEqual({ API_KEY: 'secret', DB: 'new-url' })
    expect(result.removed).toEqual({})
    expect(result.modified).toEqual({})
  })

  test('throws CliError when staging secret not found', async () => {
    mockApiRequest.mockResolvedValue({
      changeId: 'change-3',
      project: 'api',
      env: 'dev',
      status: 'pending',
      proposedBy: 'alice@test.com',
      reason: 'expired',
      createdAt: '2025-01-01T00:00:00Z',
      diff: [],
    })

    mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException('not found'))

    await expect(reviewChange('change-3', config)).rejects.toThrow(
      'Staging secret not found',
    )
  })

  test('throws CliError when API returns an error', async () => {
    mockApiRequest.mockResolvedValue({ error: 'Change not found' })

    await expect(reviewChange('change-404', config)).rejects.toThrow(
      'Change not found',
    )
  })
})

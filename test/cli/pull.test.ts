import { Command } from 'commander'
import { DEFAULT_TEST_CONFIG, SDK_MOCKS } from './_helpers'

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

const mockWriteEnvFile = jest.fn()
jest.mock('../../src/cli/env-parser', () => ({
  ...jest.requireActual('../../src/cli/env-parser'),
  writeEnvFile: mockWriteEnvFile,
}))

jest.mock('../../src/cli/auth', () => ({
  ...jest.requireActual('../../src/cli/auth'),
  requireConfig: jest.fn(() => ({ ...DEFAULT_TEST_CONFIG })),
  awsCredentials: jest.fn(() => undefined),
}))

jest.mock('../../src/cli/resolve-defaults', () => ({
  ...jest.requireActual('../../src/cli/resolve-defaults'),
  resolveProjectEnv: jest.fn(() => ({ project: 'api', env: 'dev' })),
}))

import { registerPullCommand } from '../../src/cli/commands/pull'

const { ResourceNotFoundException } = jest.requireMock(
  '@aws-sdk/client-secrets-manager',
) as { ResourceNotFoundException: new (msg: string) => Error }

const runPull = async (...args: string[]) => {
  const program = new Command()
  program.exitOverride()
  registerPullCommand(program)
  await program.parseAsync(['node', 'sr', 'pull', ...args])
}

describe('pull command', () => {
  const origLog = console.log

  beforeEach(() => {
    jest.clearAllMocks()
    console.log = jest.fn()
  })

  afterEach(() => {
    console.log = origLog
  })

  test('writes .env file with secret values', async () => {
    mockSmSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        DB_URL: 'postgres://...',
        API_KEY: 'secret',
      }),
    })

    await runPull()

    expect(mockWriteEnvFile).toHaveBeenCalledWith(
      { DB_URL: 'postgres://...', API_KEY: 'secret' },
      '.env',
    )
  })

  test('does not write file with --keys-only', async () => {
    mockSmSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({
        DB_URL: 'postgres://...',
        API_KEY: 'secret',
      }),
    })

    await runPull('--keys-only')

    expect(mockWriteEnvFile).not.toHaveBeenCalled()
  })

  test('throws CliError when secret not found', async () => {
    mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException('not found'))

    await expect(runPull()).rejects.toThrow('Secret not found')
  })

  test('throws CliError when secret has invalid JSON', async () => {
    mockSmSend.mockResolvedValueOnce({
      SecretString: 'not-json',
    })

    await expect(runPull()).rejects.toThrow('not valid JSON')
  })

  test('does not write file when secret is empty', async () => {
    mockSmSend.mockResolvedValueOnce({
      SecretString: undefined,
    })

    await runPull()

    expect(mockWriteEnvFile).not.toHaveBeenCalled()
  })
})

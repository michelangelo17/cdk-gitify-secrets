import * as fs from 'node:fs'
import { Command } from 'commander'
import { DEFAULT_TEST_CONFIG, SDK_MOCKS } from './_helpers'

const mockSmSend = jest.fn()

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSmSend })),
  GetSecretValueCommand: jest.fn((input: unknown) => ({
    _type: 'GetSecretValue',
    _input: input,
  })),
  CreateSecretCommand: jest.fn((input: unknown) => ({
    _type: 'CreateSecret',
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

jest.mock('@aws-sdk/client-cloudformation', () => SDK_MOCKS.cloudformation())
jest.mock('@aws-sdk/client-cognito-identity-provider', () => SDK_MOCKS.cognito())

const mockApiRequest = jest.fn()
jest.mock('../../src/cli/auth', () => ({
  ...jest.requireActual('../../src/cli/auth'),
  apiRequest: mockApiRequest,
  requireConfig: jest.fn(() => ({ ...DEFAULT_TEST_CONFIG })),
  awsCredentials: jest.fn(() => undefined),
}))

jest.mock('../../src/cli/resolve-defaults', () => ({
  ...jest.requireActual('../../src/cli/resolve-defaults'),
  resolveProjectEnv: jest.fn(() => ({ project: 'api', env: 'dev' })),
}))

import { registerProposeCommand } from '../../src/cli/commands/propose'

const { ResourceNotFoundException } = jest.requireMock(
  '@aws-sdk/client-secrets-manager',
) as { ResourceNotFoundException: new (msg: string) => Error }

const runPropose = async (...args: string[]) => {
  const program = new Command()
  program.exitOverride()
  registerProposeCommand(program)
  await program.parseAsync(['node', 'sr', 'propose', ...args])
}

describe('propose command', () => {
  let tmpFile: string
  const origLog = console.log

  beforeEach(() => {
    jest.clearAllMocks()
    console.log = jest.fn()
    tmpFile = `/tmp/sr-propose-test-${Date.now()}.env`
    fs.writeFileSync(tmpFile, 'DB_URL=postgres://localhost\nAPI_KEY=test-key\n')
  })

  afterEach(() => {
    console.log = origLog
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  })

  test('proposes changes and calls API', async () => {
    // Current secret value
    mockSmSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ DB_URL: 'postgres://old' }),
    })
    // Create staging secret
    mockSmSend.mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:us-east-1:123:secret:staging' })
    // Tag resource
    mockSmSend.mockResolvedValueOnce({})

    mockApiRequest.mockResolvedValueOnce({
      changeId: 'abc-123',
      diff: [
        { type: 'modified', key: 'DB_URL' },
        { type: 'added', key: 'API_KEY' },
      ],
    })

    await runPropose('-f', tmpFile, '-r', 'Update DB and add key')

    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/changes',
      expect.anything(),
      expect.objectContaining({
        project: 'api',
        env: 'dev',
        reason: 'Update DB and add key',
      }),
    )
  })

  test('throws CliError when .env file not found', async () => {
    await expect(
      runPropose('-f', '/tmp/nonexistent.env', '-r', 'test'),
    ).rejects.toThrow('File not found')
  })

  test('throws CliError when .env file is empty', async () => {
    const emptyFile = `/tmp/sr-propose-empty-${Date.now()}.env`
    fs.writeFileSync(emptyFile, '# just comments\n')

    try {
      await expect(
        runPropose('-f', emptyFile, '-r', 'test'),
      ).rejects.toThrow('No variables found')
    } finally {
      fs.unlinkSync(emptyFile)
    }
  })

  test('handles first-time secret (no existing secret)', async () => {
    mockSmSend.mockRejectedValueOnce(new ResourceNotFoundException('not found'))
    mockSmSend.mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:staging' })
    mockSmSend.mockResolvedValueOnce({})

    mockApiRequest.mockResolvedValueOnce({
      changeId: 'first-time-id',
      diff: [
        { type: 'added', key: 'DB_URL' },
        { type: 'added', key: 'API_KEY' },
      ],
    })

    await runPropose('-f', tmpFile, '-r', 'Initial setup')

    expect(mockApiRequest).toHaveBeenCalledWith(
      'POST',
      '/changes',
      expect.anything(),
      expect.objectContaining({ project: 'api', env: 'dev' }),
    )
  })

  test('handles no-changes-detected response', async () => {
    mockSmSend.mockResolvedValueOnce({
      SecretString: JSON.stringify({ DB_URL: 'postgres://localhost', API_KEY: 'test-key' }),
    })
    mockSmSend.mockResolvedValueOnce({ ARN: 'arn:aws:secretsmanager:staging' })
    mockSmSend.mockResolvedValueOnce({})

    mockApiRequest.mockResolvedValueOnce({ message: 'No changes detected' })

    // Should not throw
    await runPropose('-f', tmpFile, '-r', 'Nothing changed')
  })
})

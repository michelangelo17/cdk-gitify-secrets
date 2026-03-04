import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const mockCfnSend = jest.fn()
const mockCognitoSend = jest.fn()

jest.mock('@aws-sdk/client-cloudformation', () => ({
  CloudFormationClient: jest.fn(() => ({ send: mockCfnSend })),
  DescribeStacksCommand: jest.fn((input: unknown) => ({
    _type: 'DescribeStacks',
    _input: input,
  })),
}))

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  InitiateAuthCommand: jest.fn((input: unknown) => ({
    _type: 'InitiateAuth',
    _input: input,
  })),
  AdminCreateUserCommand: jest.fn((input: unknown) => ({
    _type: 'AdminCreateUser',
    _input: input,
  })),
  AdminSetUserPasswordCommand: jest.fn((input: unknown) => ({
    _type: 'AdminSetUserPassword',
    _input: input,
  })),
}))

jest.mock('../../src/cli/prompt', () => ({
  prompt: jest.fn(),
  confirm: jest.fn(),
}))

import { Command } from 'commander'
import { registerInitCommand } from '../../src/cli/commands/init'
import { prompt, confirm } from '../../src/cli/prompt'

const mockPrompt = prompt as jest.MockedFunction<typeof prompt>
const mockConfirm = confirm as jest.MockedFunction<typeof confirm>

describe('init command', () => {
  let tmpDir: string
  let configDir: string
  let configFile: string
  let originalCwd: string
  let originalConfigDir: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-init-test-'))
    configDir = path.join(tmpDir, '.cdk-gitify-secrets')
    configFile = path.join(configDir, 'config.json')
    originalCwd = process.cwd()
    originalConfigDir = process.env.SR_CONFIG_DIR
    process.env.SR_CONFIG_DIR = configDir
    process.chdir(tmpDir)
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.SR_CONFIG_DIR
    } else {
      process.env.SR_CONFIG_DIR = originalConfigDir
    }
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const runInit = async (...args: string[]) => {
    const program = new Command()
    program.exitOverride()
    registerInitCommand(program)
    await program.parseAsync(['node', 'sr', 'init', ...args])
  }

  test('auto-configure from stack with --skip-login', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.test.com' },
            { OutputKey: 'UserPoolId', OutputValue: 'us-east-1_test' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-abc' },
            { OutputKey: 'SecretPrefix', OutputValue: 'sr/' },
          ],
        },
      ],
    })

    mockPrompt.mockResolvedValueOnce('backend-api') // default project
    mockPrompt.mockResolvedValueOnce('dev') // default env
    mockConfirm.mockResolvedValueOnce(false) // don't save .sr.json

    await runInit(
      '--stack-name', 'TestStack',
      '--region', 'us-east-1',
      '--skip-login',
    )

    expect(fs.existsSync(configFile)).toBe(true)
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    expect(config.apiUrl).toBe('https://api.test.com')
    expect(config.userPoolId).toBe('us-east-1_test')
    expect(config.clientId).toBe('client-abc')
    expect(config.secretPrefix).toBe('sr/')
    expect(config.region).toBe('us-east-1')
    expect(config.defaultProject).toBe('backend-api')
    expect(config.defaultEnv).toBe('dev')
  })

  test('creates .sr.json when user confirms', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.test.com' },
            { OutputKey: 'UserPoolId', OutputValue: 'us-east-1_test' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-abc' },
          ],
        },
      ],
    })

    mockPrompt.mockResolvedValueOnce('my-app') // default project
    mockPrompt.mockResolvedValueOnce('staging') // default env
    mockConfirm.mockResolvedValueOnce(true) // save .sr.json

    await runInit(
      '--stack-name', 'TestStack',
      '--region', 'us-east-1',
      '--skip-login',
    )

    const srJsonPath = path.join(tmpDir, '.sr.json')
    expect(fs.existsSync(srJsonPath)).toBe(true)
    const localConfig = JSON.parse(fs.readFileSync(srJsonPath, 'utf-8'))
    expect(localConfig).toEqual({ project: 'my-app', env: 'staging' })
  })

  test('falls back to manual config when stack read fails', async () => {
    mockCfnSend.mockRejectedValue(new Error('Stack not found'))

    mockConfirm
      .mockResolvedValueOnce(true) // yes, configure from stack
      .mockResolvedValueOnce(false) // no, don't create user
      .mockResolvedValueOnce(true) // yes, log in with existing account
      .mockResolvedValueOnce(false) // don't save .sr.json

    mockPrompt
      .mockResolvedValueOnce('FailingStack') // stack name
      .mockResolvedValueOnce('https://manual-api.com') // API URL (fallback)
      .mockResolvedValueOnce('pool-manual') // User Pool ID
      .mockResolvedValueOnce('client-manual') // Client ID
      .mockResolvedValueOnce('') // secret prefix (default)
      .mockResolvedValueOnce('test@test.com') // login email
      .mockResolvedValueOnce('pass123') // login password
      .mockResolvedValueOnce('proj') // default project
      .mockResolvedValueOnce('dev') // default env

    mockCognitoSend.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'id-tok',
        RefreshToken: 'ref-tok',
        ExpiresIn: 3600,
      },
    })

    await runInit('--region', 'us-west-2')

    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    expect(config.apiUrl).toBe('https://manual-api.com')
    expect(config.email).toBe('test@test.com')
    expect(config.region).toBe('us-west-2')
  })

  test('--create-user creates user and logs in', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.test.com' },
            { OutputKey: 'UserPoolId', OutputValue: 'us-east-1_pool' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-abc' },
          ],
        },
      ],
    })

    mockCognitoSend
      .mockResolvedValueOnce({}) // AdminCreateUser
      .mockResolvedValueOnce({}) // AdminSetUserPassword
      .mockResolvedValueOnce({ // InitiateAuth
        AuthenticationResult: {
          IdToken: 'new-id-tok',
          RefreshToken: 'new-ref-tok',
          ExpiresIn: 3600,
        },
      })

    mockPrompt.mockResolvedValueOnce('proj') // default project
    mockPrompt.mockResolvedValueOnce('dev') // default env
    mockConfirm.mockResolvedValueOnce(false) // don't save .sr.json

    await runInit(
      '--stack-name', 'TestStack',
      '--region', 'us-east-1',
      '--create-user',
      '--email', 'new@test.com',
      '--password', 'NewPass123!',
    )

    expect(mockCognitoSend).toHaveBeenCalledTimes(3)

    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    expect(config.email).toBe('new@test.com')
    expect(config.idToken).toBe('new-id-tok')
  })

  test('skips login with --skip-login flag', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.test.com' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-abc' },
          ],
        },
      ],
    })

    mockPrompt.mockResolvedValueOnce('proj')
    mockPrompt.mockResolvedValueOnce('dev')
    mockConfirm.mockResolvedValueOnce(false)

    await runInit(
      '--stack-name', 'TestStack',
      '--region', 'us-east-1',
      '--skip-login',
    )

    expect(mockCognitoSend).not.toHaveBeenCalled()
  })

  test('accepts all values via flags for non-interactive use', async () => {
    mockCfnSend.mockResolvedValue({
      Stacks: [
        {
          Outputs: [
            { OutputKey: 'ApiUrl', OutputValue: 'https://api.test.com' },
            { OutputKey: 'UserPoolId', OutputValue: 'pool-123' },
            { OutputKey: 'UserPoolClientId', OutputValue: 'client-456' },
          ],
        },
      ],
    })

    mockConfirm.mockResolvedValueOnce(true) // save .sr.json

    await runInit(
      '--stack-name', 'TestStack',
      '--region', 'us-east-1',
      '--skip-login',
      '--default-project', 'api',
      '--default-env', 'prod',
    )

    expect(mockPrompt).not.toHaveBeenCalled()

    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    expect(config.defaultProject).toBe('api')
    expect(config.defaultEnv).toBe('prod')
  })
})

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation'
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const getConfigDir = () =>
  process.env.SR_CONFIG_DIR ?? path.join(os.homedir(), '.cdk-gitify-secrets')
const getConfigFile = () => path.join(getConfigDir(), 'config.json')

export interface CliConfig {
  apiUrl?: string
  region?: string
  secretPrefix?: string
  userPoolId?: string
  clientId?: string
  idToken?: string
  refreshToken?: string
  email?: string
  tokenExpiresAt?: number
  defaultProject?: string
  defaultEnv?: string
}

export const loadConfig = (): CliConfig => {
  const configFile = getConfigFile()
  if (!fs.existsSync(configFile)) {
    return {}
  }

  try {
    const stats = fs.statSync(configFile)
    const mode = stats.mode & 0o777 // eslint-disable-line no-bitwise
    if (mode & 0o077) { // eslint-disable-line no-bitwise
      console.warn(
        `Warning: ${configFile} has permissions ${mode.toString(8)}. ` +
          'This file contains authentication tokens. ' +
          `Run: chmod 600 ${configFile}`,
      )
    }
  } catch {
    // Ignore stat errors -- proceed with load
  }

  const content = fs.readFileSync(configFile, 'utf-8')
  return JSON.parse(content) as CliConfig
}

export const saveConfig = (config: CliConfig): void => {
  const configDir = getConfigDir()
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config, null, 2), {
    mode: 0o600,
  })
}

export const getConfigPath = (): string => getConfigFile()

export const requireConfig = (fields: string[]): CliConfig => {
  const config = loadConfig()
  const missing = fields.filter((f) => !(config as Record<string, unknown>)[f])
  if (missing.length > 0) {
    console.error(`Missing config: ${missing.join(', ')}`)
    console.error(
      'Run: sr configure --api-url <URL> --region <REGION> --client-id <ID>',
    )
    process.exit(1)
  }
  return config
}

export const ensureValidToken = async (config: CliConfig): Promise<string> => {
  if (config.idToken && config.tokenExpiresAt) {
    const now = Date.now() / 1000
    if (now < config.tokenExpiresAt - 60) {
      return config.idToken
    }
  }

  if (config.refreshToken && config.clientId && config.region) {
    try {
      const client = new CognitoIdentityProviderClient({
        region: config.region,
      })
      const result = await client.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: config.clientId,
          AuthParameters: {
            REFRESH_TOKEN: config.refreshToken,
          },
        }),
      )

      if (result.AuthenticationResult?.IdToken) {
        const newToken = result.AuthenticationResult.IdToken
        config.idToken = newToken
        config.tokenExpiresAt =
          Math.floor(Date.now() / 1000) +
          (result.AuthenticationResult.ExpiresIn ?? 3600)
        saveConfig(config)
        return newToken
      }
    } catch {
      console.error('Token refresh failed. Please run: sr login')
    }
  }

  if (config.idToken) {
    return config.idToken
  }

  console.error('Not authenticated. Run: sr login')
  process.exit(1)
}

export const apiRequest = async (
  method: string,
  urlPath: string,
  config: CliConfig,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const token = await ensureValidToken(config)
  const url = `${config.apiUrl!.replace(/\/$/, '')}${urlPath}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  }

  const fetchOpts: RequestInit = {
    method,
    headers,
  }

  if (body) {
    fetchOpts.body = JSON.stringify(body)
  }

  const resp = await fetch(url, fetchOpts)

  if (resp.status === 401) {
    console.error('Authentication expired. Run: sr login')
    process.exit(1)
  }

  return (await resp.json()) as Record<string, unknown>
}

const OUTPUT_KEY_MAP: Record<string, keyof CliConfig> = {
  ApiUrl: 'apiUrl',
  UserPoolId: 'userPoolId',
  UserPoolClientId: 'clientId',
  SecretPrefix: 'secretPrefix',
}

export const configFromStack = async (
  stackName: string,
  region: string,
): Promise<Partial<CliConfig>> => {
  const cfn = new CloudFormationClient({ region })
  const { Stacks } = await cfn.send(
    new DescribeStacksCommand({ StackName: stackName }),
  )

  const stack = Stacks?.[0]
  if (!stack) {
    throw new Error(`Stack "${stackName}" not found in region ${region}`)
  }

  const result: Partial<CliConfig> = { region }

  for (const output of stack.Outputs ?? []) {
    const key = output.OutputKey
    const configKey = key ? OUTPUT_KEY_MAP[key] : undefined
    if (configKey && output.OutputValue) {
      (result as Record<string, string>)[configKey] = output.OutputValue
    }
  }

  if (!result.apiUrl) {
    throw new Error(
      `Stack "${stackName}" is missing the ApiUrl output. Is this a SecretReview stack?`,
    )
  }

  return result
}

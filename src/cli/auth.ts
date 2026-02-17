import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const CONFIG_DIR = path.join(os.homedir(), '.cdk-gitify-secrets')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

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
}

export function loadConfig(): CliConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {}
  }

  // Warn if config file has overly permissive permissions
  try {
    const stats = fs.statSync(CONFIG_FILE)
    // eslint-disable-next-line no-bitwise
    const mode = stats.mode & 0o777
    // eslint-disable-next-line no-bitwise
    if (mode & 0o077) {
      console.warn(
        `Warning: ${CONFIG_FILE} has permissions ${mode.toString(8)}. ` +
          'This file contains authentication tokens. ' +
          `Run: chmod 600 ${CONFIG_FILE}`,
      )
    }
  } catch {
    // Ignore stat errors -- proceed with load
  }

  const content = fs.readFileSync(CONFIG_FILE, 'utf-8')
  return JSON.parse(content) as CliConfig
}

export function saveConfig(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  })
}

export function getConfigPath(): string {
  return CONFIG_FILE
}

export function requireConfig(fields: string[]): CliConfig {
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

export async function ensureValidToken(config: CliConfig): Promise<string> {
  // Check if current token is still valid
  if (config.idToken && config.tokenExpiresAt) {
    const now = Date.now() / 1000
    if (now < config.tokenExpiresAt - 60) {
      return config.idToken
    }
  }

  // Try to refresh using refresh token
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
        config.idToken = result.AuthenticationResult.IdToken
        config.tokenExpiresAt =
          Math.floor(Date.now() / 1000) +
          (result.AuthenticationResult.ExpiresIn ?? 3600)
        saveConfig(config)
        return config.idToken
      }
    } catch (e) {
      console.error('Token refresh failed. Please run: sr login')
    }
  }

  if (config.idToken) {
    return config.idToken
  }

  console.error('Not authenticated. Run: sr login')
  process.exit(1)
}

export async function apiRequest(
  method: string,
  urlPath: string,
  config: CliConfig,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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

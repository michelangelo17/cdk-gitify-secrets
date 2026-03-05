import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import type { CliConfig } from './auth'
import { awsCredentials } from './auth'

export const resolveSecretPrefix = (config: CliConfig): string =>
  config.secretPrefix || 'secret-review/'

export const createSmClient = (config: CliConfig): SecretsManagerClient => {
  const credentials = awsCredentials()
  return new SecretsManagerClient({
    region: config.region!,
    ...(credentials ? { credentials } : {}),
  })
}

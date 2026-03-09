import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import type { CliConfig } from './auth'
import { awsCredentials } from './auth'

export const STAGING_TAG_KEY = 'secretReviewStaging'

export const resolveSecretPrefix = (config: CliConfig): string =>
  config.secretPrefix || 'secret-review/'

export const createSmClient = (config: CliConfig): SecretsManagerClient => {
  if (!config.region) {
    throw new Error('AWS region is not configured. Run: sr configure --region <region>')
  }
  const credentials = awsCredentials()
  return new SecretsManagerClient({
    region: config.region,
    ...(credentials ? { credentials } : {}),
  })
}

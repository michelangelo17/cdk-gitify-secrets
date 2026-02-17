import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  ResourceNotFoundException,
  TagResourceCommand,
} from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({})

const SECRETS_PREFIX = process.env.SECRETS_PREFIX ?? 'secret-review/'
const STAGING_PREFIX = `${SECRETS_PREFIX}pending/`
const KMS_KEY_ID = process.env.KMS_KEY_ID

export function getRealSecretName(project: string, env: string): string {
  return `${SECRETS_PREFIX}${project}/${env}`
}

export function getStagingSecretName(changeId: string): string {
  return `${STAGING_PREFIX}${changeId}`
}

export interface SecretValueWithVersion {
  values: Record<string, string>
  versionId?: string
}

export async function getCurrentSecretValue(
  project: string,
  env: string,
): Promise<SecretValueWithVersion> {
  const secretName = getRealSecretName(project, env)
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    )
    if (result.SecretString) {
      return {
        values: JSON.parse(result.SecretString),
        versionId: result.VersionId,
      }
    }
    return { values: {}, versionId: result.VersionId }
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return { values: {} }
    }
    throw e
  }
}

export async function getSecretByVersionStage(
  project: string,
  env: string,
  versionStage: string,
): Promise<Record<string, string> | undefined> {
  const secretName = getRealSecretName(project, env)
  try {
    const result = await client.send(
      new GetSecretValueCommand({
        SecretId: secretName,
        VersionStage: versionStage,
      }),
    )
    if (result.SecretString) {
      return JSON.parse(result.SecretString)
    }
    return undefined
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return undefined
    }
    throw e
  }
}

export async function putSecretValue(
  project: string,
  env: string,
  values: Record<string, string>,
): Promise<void> {
  const secretName = getRealSecretName(project, env)
  await client.send(
    new PutSecretValueCommand({
      SecretId: secretName,
      SecretString: JSON.stringify(values),
    }),
  )
}

export async function createStagingSecret(
  changeId: string,
  payload: {
    proposed: Record<string, string>
    previous: Record<string, string>
    project: string
    env: string
  },
): Promise<string> {
  const secretName = getStagingSecretName(changeId)
  const result = await client.send(
    new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify(payload),
      KmsKeyId: KMS_KEY_ID,
      Description: `Staging secret for change ${changeId} (${payload.project}/${payload.env})`,
    }),
  )

  if (result.ARN) {
    await client.send(
      new TagResourceCommand({
        SecretId: result.ARN,
        Tags: [
          { Key: 'createdAt', Value: new Date().toISOString() },
          { Key: 'changeId', Value: changeId },
          { Key: 'secretReviewStaging', Value: 'true' },
        ],
      }),
    )
  }

  return secretName
}

export async function getStagingSecretValue(changeId: string): Promise<
  | {
    proposed: Record<string, string>
    previous: Record<string, string>
    project: string
    env: string
  }
  | undefined
> {
  const secretName = getStagingSecretName(changeId)
  try {
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretName }),
    )
    if (result.SecretString) {
      return JSON.parse(result.SecretString)
    }
    return undefined
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return undefined
    }
    throw e
  }
}

export async function deleteStagingSecret(changeId: string): Promise<void> {
  const secretName = getStagingSecretName(changeId)
  try {
    await client.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        ForceDeleteWithoutRecovery: true,
      }),
    )
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      return
    }
    throw e
  }
}

export async function listStagingSecrets(): Promise<
  Array<{ name: string; arn: string; createdAt?: string; changeId?: string }>
> {
  const secrets: Array<{
    name: string
    arn: string
    createdAt?: string
    changeId?: string
  }> = []
  let nextToken: string | undefined

  do {
    const result = await client.send(
      new ListSecretsCommand({
        Filters: [
          { Key: 'name', Values: [STAGING_PREFIX] },
          { Key: 'tag-key', Values: ['secretReviewStaging'] },
        ],
        NextToken: nextToken,
      }),
    )

    for (const secret of result.SecretList ?? []) {
      const createdAtTag = secret.Tags?.find((t) => t.Key === 'createdAt')
      const changeIdTag = secret.Tags?.find((t) => t.Key === 'changeId')
      secrets.push({
        name: secret.Name!,
        arn: secret.ARN!,
        createdAt: createdAtTag?.Value,
        changeId: changeIdTag?.Value,
      })
    }

    nextToken = result.NextToken
  } while (nextToken)

  return secrets
}

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { getUserEmail } from './shared/auth'
import { buildPk, buildSk, putChange } from './shared/dynamo'
import { ok, error } from './shared/response'
import { getCurrentSecretValue, getStagingSecretValue } from './shared/secrets'
import type {
  ChangeRequest,
  DiffEntry,
  ProposeRequestBody,
} from './shared/types'

const PROJECTS_CONFIG: Record<string, string[]> = JSON.parse(
  process.env.PROJECTS_CONFIG ?? '{}',
)

function computeDiff(
  currentValues: Record<string, string>,
  proposedValues: Record<string, string>,
): DiffEntry[] {
  const diff: DiffEntry[] = []

  for (const key of Object.keys(proposedValues)) {
    if (!(key in currentValues)) {
      diff.push({ type: 'added', key })
    } else if (currentValues[key] !== proposedValues[key]) {
      diff.push({ type: 'modified', key })
    }
  }

  for (const key of Object.keys(currentValues)) {
    if (!(key in proposedValues)) {
      diff.push({ type: 'removed', key })
    }
  }

  return diff
}

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const body: ProposeRequestBody = JSON.parse(event.body ?? '{}')

    if (!body.project || !body.env || !body.stagingSecretName || !body.reason) {
      return error(
        400,
        'Missing required fields: project, env, stagingSecretName, reason',
      )
    }

    const allowedEnvs = PROJECTS_CONFIG[body.project]
    if (!allowedEnvs || !allowedEnvs.includes(body.env)) {
      return error(
        400,
        `Invalid project/environment: ${body.project}/${body.env}`,
      )
    }

    const proposedBy = getUserEmail(event)

    const prefix = process.env.SECRETS_PREFIX ?? 'secret-review/'
    const stagingPrefix = `${prefix}pending/`
    if (!body.stagingSecretName.startsWith(stagingPrefix)) {
      return error(400, 'Invalid staging secret name')
    }
    const changeId = body.stagingSecretName.slice(stagingPrefix.length)

    const stagingData = await getStagingSecretValue(changeId)
    if (!stagingData) {
      return error(
        400,
        'Staging secret not found. Ensure it was created before calling propose.',
      )
    }

    if (stagingData.project !== body.project || stagingData.env !== body.env) {
      return error(400, 'Staging secret project/env does not match request')
    }

    // Read current secret and capture VersionId for optimistic concurrency
    const { values: currentValues, versionId: secretVersionId } =
      await getCurrentSecretValue(body.project, body.env)
    const diff = computeDiff(currentValues, stagingData.proposed)

    if (diff.length === 0) {
      return ok({ message: 'No changes detected' })
    }

    const createdAt = new Date().toISOString()
    const pk = buildPk(body.project, body.env)
    const sk = buildSk(createdAt, changeId)

    const change: ChangeRequest = {
      pk,
      sk,
      changeId,
      project: body.project,
      env: body.env,
      status: 'pending',
      proposedBy,
      stagingSecretName: body.stagingSecretName,
      diff,
      diffCount: diff.length,
      reason: body.reason,
      createdAt,
      secretVersionId,
    }

    await putChange(change)

    return ok({
      changeId,
      diff,
      diffCount: diff.length,
      message: 'Change proposed successfully',
    })
  } catch (e) {
    console.error('Propose error:', e)
    return error(500, 'Internal server error')
  }
}

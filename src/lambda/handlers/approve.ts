import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { getUserEmail } from './shared/auth'
import { getChangeById, updateChangeStatus } from './shared/dynamo'
import { ok, error } from './shared/response'
import {
  getCurrentSecretValue,
  getStagingSecretValue,
  deleteStagingSecret,
  putSecretValue,
} from './shared/secrets'
import type { ApproveRejectBody } from './shared/types'

const PREVENT_SELF_APPROVAL = process.env.PREVENT_SELF_APPROVAL !== 'false'

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const changeId = event.pathParameters?.changeId
    if (!changeId) {
      return error(400, 'Missing changeId')
    }

    const body: ApproveRejectBody = JSON.parse(event.body ?? '{}')
    const reviewerEmail = getUserEmail(event)

    const change = await getChangeById(changeId)
    if (!change) {
      return error(404, 'Change not found')
    }

    if (change.status !== 'pending') {
      return error(409, `Change is already ${change.status}`)
    }

    if (PREVENT_SELF_APPROVAL && change.proposedBy === reviewerEmail) {
      return error(403, 'Cannot approve your own changes')
    }

    // Optimistic concurrency: verify the real secret hasn't changed since the proposal
    if (change.secretVersionId) {
      const { versionId: currentVersionId } = await getCurrentSecretValue(
        change.project,
        change.env,
      )
      if (currentVersionId && currentVersionId !== change.secretVersionId) {
        return error(
          409,
          'Conflict: the secret was modified since this change was proposed. Please reject and re-propose.',
        )
      }
    }

    // Read proposed values from staging secret
    const stagingData = await getStagingSecretValue(changeId)
    if (!stagingData) {
      return error(
        500,
        'Staging secret not found. The change may have expired.',
      )
    }

    // Capture the real secret's current VersionId before writing (for rollback)
    const { versionId: previousVersionId } = await getCurrentSecretValue(
      change.project,
      change.env,
    )

    // Write proposed values to the real secret
    await putSecretValue(change.project, change.env, stagingData.proposed)

    // Delete the staging secret
    await deleteStagingSecret(changeId)

    // Update DynamoDB status, including previousVersionId and currentKeys
    await updateChangeStatus(
      change.pk,
      change.sk,
      'approved',
      reviewerEmail,
      body.comment,
      {
        previousVersionId,
        currentKeys: Object.keys(stagingData.proposed),
      },
    )

    return ok({
      message: `Change ${changeId} approved and applied`,
      changeId,
      project: change.project,
      env: change.env,
    })
  } catch (e) {
    console.error('Approve error:', e)
    return error(500, 'Internal server error')
  }
}

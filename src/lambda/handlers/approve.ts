import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import {
  assertApproverAccess,
  assertProjectAccess,
  getUserEmail,
} from './shared/auth'
import { config } from './shared/config'
import { getChangeById, updateChangeStatus } from './shared/dynamo'
import { parseBody } from './shared/request'
import { ok, error } from './shared/response'
import {
  getCurrentSecretValue,
  getStagingSecretValue,
  deleteStagingSecret,
  putSecretValue,
} from './shared/secrets'
import type { ApproveRejectBody } from './shared/types'

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const changeId = event.pathParameters?.changeId
    if (!changeId) {
      return error(400, 'Missing changeId')
    }

    const parsed = parseBody<ApproveRejectBody>(event)
    if (!parsed.ok) return parsed.error
    const { body } = parsed
    const reviewerEmail = getUserEmail(event)

    const change = await getChangeById(changeId)
    if (!change) {
      return error(404, 'Change not found')
    }

    if (change.status !== 'pending') {
      return error(409, `Change is already ${change.status}`)
    }

    const accessError = assertProjectAccess(event, change.project)
    if (accessError) return error(403, accessError)

    const approverError = assertApproverAccess(event, change.project)
    if (approverError) return error(403, approverError)

    if (config.preventSelfApproval && change.proposedBy === reviewerEmail) {
      return error(403, 'Cannot approve your own changes')
    }

    const { versionId: previousVersionId } = await getCurrentSecretValue(
      change.project,
      change.env,
    )

    if (
      change.secretVersionId &&
      previousVersionId &&
      previousVersionId !== change.secretVersionId
    ) {
      return error(
        409,
        'Conflict: the secret was modified since this change was proposed. Please reject and re-propose.',
      )
    }

    const stagingData = await getStagingSecretValue(changeId)
    if (!stagingData) {
      return error(
        500,
        'Staging secret not found. The change may have expired.',
      )
    }

    try {
      await updateChangeStatus(
        change.pk,
        change.sk,
        'approved',
        'pending',
        reviewerEmail,
        body.comment,
        {
          previousVersionId,
          currentKeys: Object.keys(stagingData.proposed),
        },
      )
    } catch (e) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return error(409, 'Change was already reviewed by another user')
      }
      throw e
    }

    await putSecretValue(change.project, change.env, stagingData.proposed)
    await deleteStagingSecret(changeId)

    return ok({
      message: `Change ${changeId} approved and applied`,
      changeId,
      project: change.project,
      env: change.env,
    })
  } catch (e) {
    console.error(
      JSON.stringify({
        handler: 'approve',
        requestId: event.requestContext.requestId,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      }),
    )
    return error(500, 'Internal server error')
  }
}

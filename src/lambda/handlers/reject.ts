import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { assertApproverAccess, assertProjectAccess, getUserEmail } from './shared/auth'
import { getChangeById, updateChangeStatus } from './shared/dynamo'
import { parseBody } from './shared/request'
import { ok, error } from './shared/response'
import { deleteStagingSecret } from './shared/secrets'
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

    try {
      await updateChangeStatus(
        change.pk,
        change.sk,
        'rejected',
        'pending',
        reviewerEmail,
        body.comment,
      )
    } catch (e) {
      if (
        e instanceof Error &&
        e.name === 'ConditionalCheckFailedException'
      ) {
        return error(409, 'Change was already reviewed by another user')
      }
      throw e
    }

    await deleteStagingSecret(changeId)

    return ok({
      message: `Change ${changeId} rejected`,
      changeId,
    })
  } catch (e) {
    console.error('Reject error:', e)
    return error(500, 'Internal server error')
  }
}

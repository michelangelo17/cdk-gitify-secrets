import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { assertProjectAccess } from './shared/auth'
import { getChangeById } from './shared/dynamo'
import { ok, error } from './shared/response'

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const changeId = event.pathParameters?.changeId
    if (!changeId) {
      return error(400, 'Missing changeId')
    }

    const change = await getChangeById(changeId)
    if (!change) {
      return error(404, 'Change not found')
    }

    const accessError = assertProjectAccess(event, change.project)
    if (accessError) return error(403, accessError)

    return ok({
      changeId: change.changeId,
      project: change.project,
      env: change.env,
      status: change.status,
      proposedBy: change.proposedBy,
      reason: change.reason,
      createdAt: change.createdAt,
      diff: change.diff,
      diffCount: change.diffCount,
      reviewedBy: change.reviewedBy,
      reviewedAt: change.reviewedAt,
      comment: change.comment,
    })
  } catch (e) {
    console.error(JSON.stringify({
      handler: 'diff',
      requestId: event.requestContext.requestId,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    }))
    return error(500, 'Internal server error')
  }
}

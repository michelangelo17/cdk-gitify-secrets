import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { getUserGroups } from './shared/auth'
import { config } from './shared/config'
import { queryChangesByStatus } from './shared/dynamo'
import { encodeNextToken, parsePaginationParams } from './shared/request'
import { ok, error } from './shared/response'

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const statusFilter = event.queryStringParameters?.status
    const pagination = parsePaginationParams(event)
    if (pagination.parseError) return pagination.parseError
    const { limit, exclusiveStartKey } = pagination

    const validStatuses = ['pending', 'approved', 'rejected']
    let changes
    let lastEvaluatedKey: Record<string, unknown> | undefined

    if (statusFilter && validStatuses.includes(statusFilter)) {
      const result = await queryChangesByStatus(
        statusFilter,
        limit,
        exclusiveStartKey,
      )
      changes = result.items
      lastEvaluatedKey = result.lastEvaluatedKey
    } else {
      // Fetch a page-worth from each status and merge. Pagination tokens
      // are not supported in this mode -- use a status filter for paging.
      const perStatus = Math.ceil(limit / validStatuses.length)
      const [pending, approved, rejected] = await Promise.all([
        queryChangesByStatus('pending', perStatus),
        queryChangesByStatus('approved', perStatus),
        queryChangesByStatus('rejected', perStatus),
      ])
      changes = [...pending.items, ...approved.items, ...rejected.items]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
    }

    if (config.enableProjectScoping) {
      const groups = getUserGroups(event)
      changes = changes.filter((c) => groups.includes(c.project))
    }

    const summaries = changes.map((c) => ({
      changeId: c.changeId,
      project: c.project,
      env: c.env,
      status: c.status,
      proposedBy: c.proposedBy,
      diffCount: c.diffCount,
      reason: c.reason,
      createdAt: c.createdAt,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt,
    }))

    const responseNextToken = encodeNextToken(lastEvaluatedKey)

    return ok({
      changes: summaries,
      ...(responseNextToken ? { nextToken: responseNextToken } : {}),
    })
  } catch (e) {
    console.error(
      JSON.stringify({
        handler: 'list-changes',
        requestId: event.requestContext.requestId,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      }),
    )
    return error(500, 'Internal server error')
  }
}

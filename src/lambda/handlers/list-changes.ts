import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { queryChangesByStatus } from './shared/dynamo'
import { ok, error } from './shared/response'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const statusFilter = event.queryStringParameters?.status
    const limitParam = event.queryStringParameters?.limit
    const nextTokenParam = event.queryStringParameters?.nextToken

    let limit = limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT
    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    let exclusiveStartKey: Record<string, unknown> | undefined
    if (nextTokenParam) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(nextTokenParam, 'base64').toString('utf-8'),
        )
      } catch {
        return error(400, 'Invalid nextToken')
      }
    }

    let changes
    let lastEvaluatedKey: Record<string, unknown> | undefined

    if (
      statusFilter &&
      ['pending', 'approved', 'rejected'].includes(statusFilter)
    ) {
      const result = await queryChangesByStatus(
        statusFilter,
        limit,
        exclusiveStartKey,
      )
      changes = result.items
      lastEvaluatedKey = result.lastEvaluatedKey
    } else {
      // Without a status filter, query all statuses and merge
      // Note: pagination doesn't apply cleanly across multiple queries,
      // so we fetch `limit` from each and merge + sort + truncate
      const [pending, approved, rejected] = await Promise.all([
        queryChangesByStatus('pending', limit),
        queryChangesByStatus('approved', limit),
        queryChangesByStatus('rejected', limit),
      ])
      changes = [...pending.items, ...approved.items, ...rejected.items]
      changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      changes = changes.slice(0, limit)
      // Multi-status pagination is approximate; omit nextToken for simplicity
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

    const responseNextToken = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64')
      : undefined

    return ok({
      changes: summaries,
      ...(responseNextToken ? { nextToken: responseNextToken } : {}),
    })
  } catch (e) {
    console.error('List error:', e)
    return error(500, 'Internal server error')
  }
}

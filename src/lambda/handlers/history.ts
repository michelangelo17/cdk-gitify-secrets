import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { assertProjectAccess } from './shared/auth'
import { config } from './shared/config'
import { queryChangesByProject } from './shared/dynamo'
import { encodeNextToken, parsePaginationParams } from './shared/request'
import { ok, error } from './shared/response'

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const project = event.pathParameters?.project
    const env = event.pathParameters?.env

    if (!project || !env) {
      return error(400, 'Missing project or env')
    }

    const allowedEnvs = config.projectsConfig[project]
    if (!allowedEnvs || !allowedEnvs.includes(env)) {
      return error(400, `Invalid project/environment: ${project}/${env}`)
    }

    const accessError = assertProjectAccess(event, project)
    if (accessError) return error(403, accessError)

    const pagination = parsePaginationParams(event)
    if (pagination.parseError) return pagination.parseError
    const { limit, exclusiveStartKey } = pagination

    const { items: changes, lastEvaluatedKey } = await queryChangesByProject(
      project,
      env,
      limit,
      exclusiveStartKey,
    )

    const latestApproved = changes.find(
      (c) => c.status === 'approved' && c.currentKeys,
    )
    const currentKeys = latestApproved?.currentKeys ?? []

    const history = changes.map((c) => ({
      changeId: c.changeId,
      status: c.status,
      proposedBy: c.proposedBy,
      diffCount: c.diffCount,
      diff: c.diff,
      reason: c.reason,
      createdAt: c.createdAt,
      reviewedBy: c.reviewedBy,
      reviewedAt: c.reviewedAt,
      comment: c.comment,
    }))

    const responseNextToken = encodeNextToken(lastEvaluatedKey)

    return ok({
      history,
      currentKeys,
      ...(responseNextToken ? { nextToken: responseNextToken } : {}),
    })
  } catch (e) {
    console.error(JSON.stringify({
      handler: 'history',
      requestId: event.requestContext.requestId,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    }))
    return error(500, 'Internal server error')
  }
}

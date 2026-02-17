import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { queryChangesByProject } from './shared/dynamo';
import { ok, error } from './shared/response';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const project = event.pathParameters?.project;
    const env = event.pathParameters?.env;

    if (!project || !env) {
      return error(400, 'Missing project or env');
    }

    // Pagination params
    const limitParam = event.queryStringParameters?.limit;
    const nextTokenParam = event.queryStringParameters?.nextToken;

    let limit = limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT;
    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (nextTokenParam) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(nextTokenParam, 'base64').toString('utf-8'),
        );
      } catch {
        return error(400, 'Invalid nextToken');
      }
    }

    const { items: changes, lastEvaluatedKey } = await queryChangesByProject(
      project,
      env,
      limit,
      exclusiveStartKey,
    );

    // Get currentKeys from the most recent approved change (no Secrets Manager call)
    const latestApproved = changes.find(
      (c) => c.status === 'approved' && c.currentKeys,
    );
    const currentKeys = latestApproved?.currentKeys ?? [];

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
    }));

    const responseNextToken = lastEvaluatedKey
      ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64')
      : undefined;

    return ok({
      history,
      currentKeys,
      ...(responseNextToken ? { nextToken: responseNextToken } : {}),
    });
  } catch (e) {
    console.error('History error:', e);
    return error(500, 'Internal server error');
  }
}

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { getChangeById } from './shared/dynamo';
import { ok, error } from './shared/response';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const changeId = event.pathParameters?.changeId;
    if (!changeId) {
      return error(400, 'Missing changeId');
    }

    const change = await getChangeById(changeId);
    if (!change) {
      return error(404, 'Change not found');
    }

    // Returns key names and change types only -- never any secret values
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
    });
  } catch (e) {
    console.error('Diff error:', e);
    return error(500, 'Internal server error');
  }
}

import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { getUserEmail } from './shared/auth';
import { getChangeById, updateChangeStatus } from './shared/dynamo';
import { ok, error } from './shared/response';
import { deleteStagingSecret } from './shared/secrets';
import type { ApproveRejectBody } from './shared/types';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const changeId = event.pathParameters?.changeId;
    if (!changeId) {
      return error(400, 'Missing changeId');
    }

    const body: ApproveRejectBody = JSON.parse(event.body ?? '{}');
    const reviewerEmail = getUserEmail(event);

    const change = await getChangeById(changeId);
    if (!change) {
      return error(404, 'Change not found');
    }

    if (change.status !== 'pending') {
      return error(409, `Change is already ${change.status}`);
    }

    // Delete the staging secret
    await deleteStagingSecret(changeId);

    // Update DynamoDB status
    await updateChangeStatus(
      change.pk,
      change.sk,
      'rejected',
      reviewerEmail,
      body.comment,
    );

    return ok({
      message: `Change ${changeId} rejected`,
      changeId,
    });
  } catch (e) {
    console.error('Reject error:', e);
    return error(500, 'Internal server error');
  }
}

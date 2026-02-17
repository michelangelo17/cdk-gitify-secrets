import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getUserEmail } from './shared/auth';
import { getChangeById, buildPk, buildSk, putChange } from './shared/dynamo';
import { ok, error } from './shared/response';
import { getSecretByVersionStage, putSecretValue } from './shared/secrets';
import type { ChangeRequest, RollbackBody } from './shared/types';

export async function handler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> {
  try {
    const body: RollbackBody = JSON.parse(event.body ?? '{}');

    if (!body.changeId || !body.reason) {
      return error(400, 'Missing required fields: changeId, reason');
    }

    const userEmail = getUserEmail(event);

    const targetChange = await getChangeById(body.changeId);
    if (!targetChange) {
      return error(404, 'Change not found');
    }

    if (targetChange.status !== 'approved') {
      return error(400, 'Can only rollback approved changes');
    }

    // Use Secrets Manager's native AWSPREVIOUS version stage to get the
    // state of the real secret before the approval write
    const rollbackValues = await getSecretByVersionStage(
      targetChange.project,
      targetChange.env,
      'AWSPREVIOUS',
    );

    if (!rollbackValues) {
      return error(
        400,
        'Previous version not available in Secrets Manager. The secret may not have a prior version to roll back to.',
      );
    }

    // Write the previous values back to the real secret
    await putSecretValue(targetChange.project, targetChange.env, rollbackValues);

    // Create a rollback record in DynamoDB
    const rollbackId = uuidv4();
    const createdAt = new Date().toISOString();
    const pk = buildPk(targetChange.project, targetChange.env);
    const sk = buildSk(createdAt, rollbackId);

    const rollbackDiff = [
      { type: 'modified' as const, key: `[rollback of ${body.changeId}]` },
    ];

    const rollbackChange: ChangeRequest = {
      pk,
      sk,
      changeId: rollbackId,
      project: targetChange.project,
      env: targetChange.env,
      status: 'approved',
      proposedBy: userEmail,
      stagingSecretName: '',
      diff: rollbackDiff,
      diffCount: Object.keys(rollbackValues).length,
      reason: `Rollback: ${body.reason}`,
      reviewedBy: userEmail,
      reviewedAt: createdAt,
      createdAt,
      currentKeys: Object.keys(rollbackValues),
    };

    await putChange(rollbackChange);

    return ok({
      message: `Rolled back change ${body.changeId}`,
      rollbackId,
      project: targetChange.project,
      env: targetChange.env,
    });
  } catch (e) {
    console.error('Rollback error:', e);
    return error(500, 'Internal server error');
  }
}

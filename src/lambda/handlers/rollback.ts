import { randomUUID } from 'node:crypto'
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { assertApproverAccess, assertProjectAccess, getUserEmail } from './shared/auth'
import { getChangeById, buildPk, buildSk, putChange } from './shared/dynamo'
import { parseBody } from './shared/request'
import { ok, error } from './shared/response'
import { getSecretByVersionStage, putSecretValue } from './shared/secrets'
import type { ChangeRequest, RollbackBody } from './shared/types'

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const parsed = parseBody<RollbackBody>(event)
    if (!parsed.ok) return parsed.error
    const { body } = parsed

    if (!body.changeId || !body.reason) {
      return error(400, 'Missing required fields: changeId, reason')
    }

    const userEmail = getUserEmail(event)

    const targetChange = await getChangeById(body.changeId)
    if (!targetChange) {
      return error(404, 'Change not found')
    }

    if (targetChange.status !== 'approved') {
      return error(400, 'Can only rollback approved changes')
    }

    const accessError = assertProjectAccess(event, targetChange.project)
    if (accessError) return error(403, accessError)

    const approverError = assertApproverAccess(event, targetChange.project)
    if (approverError) return error(403, approverError)

    const rollbackValues = await getSecretByVersionStage(
      targetChange.project,
      targetChange.env,
      'AWSPREVIOUS',
    )

    if (!rollbackValues) {
      return error(
        400,
        'Previous version not available in Secrets Manager. The secret may not have a prior version to roll back to.',
      )
    }

    await putSecretValue(targetChange.project, targetChange.env, rollbackValues)

    const rollbackId = randomUUID()
    const createdAt = new Date().toISOString()
    const pk = buildPk(targetChange.project, targetChange.env)
    const sk = buildSk(createdAt, rollbackId)

    const rollbackDiff = [
      { type: 'modified' as const, key: `[rollback of ${body.changeId}]` },
    ]

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
    }

    await putChange(rollbackChange)

    return ok({
      message: `Rolled back change ${body.changeId}`,
      rollbackId,
      project: targetChange.project,
      env: targetChange.env,
    })
  } catch (e) {
    console.error('Rollback error:', e)
    return error(500, 'Internal server error')
  }
}

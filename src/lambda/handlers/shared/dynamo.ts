import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { ChangeRequest } from './types'

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

const TABLE_NAME = process.env.TABLE_NAME!

export function buildPk(project: string, env: string): string {
  return `PROJECT#${project}#ENV#${env}`
}

export function buildSk(createdAt: string, changeId: string): string {
  return `CHANGE#${createdAt}#${changeId}`
}

export async function putChange(change: ChangeRequest): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: change,
    }),
  )
}

export async function getChange(
  pk: string,
  sk: string,
): Promise<ChangeRequest | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
    }),
  )
  return result.Item as ChangeRequest | undefined
}

export async function getChangeById(
  changeId: string,
): Promise<ChangeRequest | undefined> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'changeId-index',
      KeyConditionExpression: 'changeId = :cid',
      ExpressionAttributeValues: { ':cid': changeId },
      Limit: 1,
    }),
  )
  return result.Items?.[0] as ChangeRequest | undefined
}

export interface PaginatedResult {
  items: ChangeRequest[]
  lastEvaluatedKey?: Record<string, unknown>
}

export async function queryChangesByProject(
  project: string,
  env: string,
  limit?: number,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<PaginatedResult> {
  const pk = buildPk(project, env)
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk },
      ScanIndexForward: false,
      ...(limit ? { Limit: limit } : {}),
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }),
  )
  return {
    items: (result.Items ?? []) as ChangeRequest[],
    lastEvaluatedKey: result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined,
  }
}

export async function queryChangesByStatus(
  status: string,
  limit?: number,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<PaginatedResult> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'status-index',
      KeyConditionExpression: '#s = :status',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ScanIndexForward: false,
      ...(limit ? { Limit: limit } : {}),
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }),
  )
  return {
    items: (result.Items ?? []) as ChangeRequest[],
    lastEvaluatedKey: result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined,
  }
}

export interface UpdateChangeStatusExtras {
  previousVersionId?: string
  currentKeys?: string[]
}

export async function updateChangeStatus(
  pk: string,
  sk: string,
  status: string,
  reviewedBy: string,
  comment?: string,
  extras?: UpdateChangeStatusExtras,
): Promise<void> {
  const now = new Date().toISOString()

  const expressionParts = [
    '#s = :status',
    'reviewedBy = :reviewedBy',
    'reviewedAt = :reviewedAt',
  ]
  const expressionValues: Record<string, unknown> = {
    ':status': status,
    ':reviewedBy': reviewedBy,
    ':reviewedAt': now,
  }

  if (comment) {
    expressionParts.push('comment = :comment')
    expressionValues[':comment'] = comment
  }

  if (extras?.previousVersionId) {
    expressionParts.push('previousVersionId = :prevVer')
    expressionValues[':prevVer'] = extras.previousVersionId
  }

  if (extras?.currentKeys) {
    expressionParts.push('currentKeys = :curKeys')
    expressionValues[':curKeys'] = extras.currentKeys
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: expressionValues,
    }),
  )
}

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { config } from './config'
import type { ChangeRequest } from './types'

const client = new DynamoDBClient({})
const docClient = DynamoDBDocumentClient.from(client)

const { tableName: TABLE_NAME } = config

export const buildPk = (project: string, env: string): string =>
  `PROJECT#${project}#ENV#${env}`

export const buildSk = (createdAt: string, changeId: string): string =>
  `CHANGE#${createdAt}#${changeId}`

export const putChange = async (change: ChangeRequest): Promise<void> => {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: change,
    }),
  )
}

export const getChangeById = async (
  changeId: string,
): Promise<ChangeRequest | undefined> => {
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

export const queryChangesByProject = async (
  project: string,
  env: string,
  limit?: number,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<PaginatedResult> => {
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

export const queryChangesByStatus = async (
  status: string,
  limit?: number,
  exclusiveStartKey?: Record<string, unknown>,
): Promise<PaginatedResult> => {
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

export const updateChangeStatus = async (
  pk: string,
  sk: string,
  status: string,
  expectedStatus: string,
  reviewedBy: string,
  comment?: string,
  extras?: UpdateChangeStatusExtras,
): Promise<void> => {
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
    ':expectedStatus': expectedStatus,
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
      ConditionExpression: '#s = :expectedStatus',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: expressionValues,
    }),
  )
}

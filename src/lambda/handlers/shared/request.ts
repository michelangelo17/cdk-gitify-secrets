import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from 'aws-lambda'
import { error } from './response'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export type ParseBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; error: APIGatewayProxyResultV2 }

export const parseBody = <T>(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): ParseBodyResult<T> => {
  try {
    return { ok: true, body: JSON.parse(event.body ?? '{}') as T }
  } catch {
    return { ok: false, error: error(400, 'Invalid JSON body') }
  }
}

export interface PaginationParams {
  limit: number
  exclusiveStartKey?: Record<string, unknown>
  parseError?: APIGatewayProxyResultV2
}

export const parsePaginationParams = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): PaginationParams => {
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
      return { limit, parseError: error(400, 'Invalid nextToken') }
    }
  }

  return { limit, exclusiveStartKey }
}

export const encodeNextToken = (
  lastEvaluatedKey?: Record<string, unknown>,
): string | undefined =>
  lastEvaluatedKey
    ? Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64')
    : undefined

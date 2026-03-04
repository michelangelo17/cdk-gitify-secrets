import type { APIGatewayProxyResultV2 } from 'aws-lambda'

export const ok = (body: Record<string, unknown>): APIGatewayProxyResultV2 => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const error = (
  statusCode: number,
  message: string,
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: message }),
})

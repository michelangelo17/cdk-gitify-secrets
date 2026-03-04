import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'

export const getUserEmail = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string => {
  const { claims } = event.requestContext.authorizer.jwt
  return (claims.email as string) ?? (claims.sub as string) ?? 'unknown'
}

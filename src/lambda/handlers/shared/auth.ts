import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

export function getUserEmail(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string {
  const claims = event.requestContext.authorizer.jwt.claims;
  const email = (claims.email as string) ?? (claims.sub as string) ?? 'unknown';
  return email;
}

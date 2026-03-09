import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { config } from './config'

export const getUserEmail = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string => {
  const { claims } = event.requestContext.authorizer.jwt
  const email = (claims.email as string) ?? (claims.sub as string)
  if (!email) {
    throw new Error('Missing user identity: neither email nor sub claim found in JWT')
  }
  return email
}

export const getUserGroups = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string[] => {
  const { claims } = event.requestContext.authorizer.jwt
  const groups = claims['cognito:groups']
  if (Array.isArray(groups)) return groups as string[]
  if (typeof groups === 'string') {
    try {
      return JSON.parse(groups) as string[]
    } catch {
      return [groups]
    }
  }
  return []
}

/**
 * Returns an error message if the caller lacks access, or undefined if allowed.
 */
export const assertProjectAccess = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  project: string,
): string | undefined => {
  if (!config.enableProjectScoping) return undefined
  const groups = getUserGroups(event)
  if (!groups.includes(project)) {
    return `Access denied: you are not a member of the '${project}' group`
  }
  return undefined
}

/**
 * Returns an error message if the caller is not in the project's approver group,
 * or undefined if the feature is disabled or the caller has access.
 */
export const assertApproverAccess = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  project: string,
): string | undefined => {
  if (!config.enableApproverRole) return undefined
  const groups = getUserGroups(event)
  if (!groups.includes(`${project}-approvers`)) {
    return `Access denied: you are not a member of the '${project}-approvers' group`
  }
  return undefined
}

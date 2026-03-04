const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  tableName: requireEnv('TABLE_NAME'),
  kmsKeyId: requireEnv('KMS_KEY_ID'),
  secretsPrefix: process.env.SECRETS_PREFIX ?? 'secret-review/',
  preventSelfApproval: process.env.PREVENT_SELF_APPROVAL !== 'false',
  projectsConfig: JSON.parse(process.env.PROJECTS_CONFIG ?? '{}') as Record<string, string[]>,
} as const

export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

export const handleApiError = (data: Record<string, unknown>): never => {
  const status = data.statusCode
  if (status === 403) {
    throw new CliError(`Access denied: ${data.error}`)
  } else if (status === 409) {
    throw new CliError(`Conflict: ${data.error}`)
  }
  throw new CliError(`Error: ${data.error}`)
}

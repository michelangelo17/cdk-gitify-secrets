import type { CliConfig } from './auth'
import { apiRequest } from './auth'
import { CliError } from './errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const shortId = (changeId: string): string => changeId.substring(0, 8)

interface ChangeIdOpts {
  readonly changeId?: string
  readonly latest?: boolean
}

export const resolveChangeId = async (
  opts: ChangeIdOpts,
  config: CliConfig,
): Promise<string> => {
  if (opts.changeId && opts.latest) {
    throw new CliError('Cannot use both --change-id and --latest')
  }

  if (!opts.changeId && !opts.latest) {
    throw new CliError('Specify --change-id <id> or --latest')
  }

  if (opts.latest) {
    const data = await apiRequest('GET', '/changes?status=pending&limit=1', config)
    const changes = data.changes as Array<Record<string, unknown>> | undefined
    if (!changes?.length) {
      throw new CliError('No pending changes found')
    }
    return String(changes[0].changeId)
  }

  const input = opts.changeId!
  if (UUID_RE.test(input)) return input

  const data = await apiRequest('GET', '/changes', config)
  const changes = (data.changes ?? []) as Array<Record<string, unknown>>
  const matches = changes.filter((c) =>
    String(c.changeId ?? '').startsWith(input),
  )

  if (matches.length === 0) {
    throw new CliError(`No change found matching "${input}"`)
  }

  if (matches.length > 1) {
    const lines = matches.map((c) =>
      `  ${shortId(String(c.changeId))}  ${c.project}/${c.env}  ${c.status}`,
    )
    throw new CliError(
      `Ambiguous ID "${input}" matches ${matches.length} changes:\n` +
      `${lines.join('\n')}\n` +
      'Provide more characters to narrow it down.',
    )
  }

  return String(matches[0].changeId)
}

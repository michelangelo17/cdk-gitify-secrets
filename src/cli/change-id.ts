import type { CliConfig } from './auth'
import { apiRequest } from './auth'
import { CliError } from './errors'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const shortId = (changeId: string): string => changeId.substring(0, 8)

interface ChangeIdOpts {
  readonly id?: string
  readonly latest?: boolean
  readonly latestStatus?: string
}

export const resolveChangeId = async (
  opts: ChangeIdOpts,
  config: CliConfig,
): Promise<string> => {
  if (opts.id && opts.latest) {
    throw new CliError('Cannot use both --id and --latest')
  }

  if (!opts.id && !opts.latest) {
    throw new CliError('Specify --id <id> or --latest')
  }

  if (opts.latest) {
    const status = opts.latestStatus ?? 'pending'
    const data = await apiRequest('GET', `/changes?status=${encodeURIComponent(status)}&limit=1`, config)
    const changes = data.changes as Array<Record<string, unknown>> | undefined
    if (!changes?.length) {
      throw new CliError(`No ${status} changes found`)
    }
    return String(changes[0].changeId)
  }

  const input = opts.id!
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

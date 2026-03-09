import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { shortId } from '../change-id'
import { BOLD, DIM, RESET, formatTimestamp, colorizeStatus, truncate, getFlexColumnWidth } from '../formatting'
import { resolveProjectEnv } from '../resolve-defaults'

const printQuickActions = (
  changes: Array<Record<string, unknown>>,
): void => {
  const pending = changes.filter((c) => c.status === 'pending')
  if (pending.length === 0) return

  console.log(`\n${DIM}Quick actions:${RESET}`)
  for (const c of pending) {
    const sid = shortId(String(c.changeId ?? ''))
    console.log(`  sr approve --id ${sid}`)
    console.log(`  sr review  --id ${sid}`)
  }
}

export const registerHistoryCommand = (program: Command): void => {
  program
    .command('history')
    .description('View change history (scoped or cross-project)')
    .option('-p, --project <project>', 'Project name')
    .option('-e, --env <env>', 'Environment name')
    .option('--all', 'Show all changes across projects')
    .option('--status <status>', 'Filter by status (pending, approved, rejected)')
    .option('--limit <n>', 'Max results (default 20)', '20')
    .option('--next-token <token>', 'Pagination token from a previous call')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])

      const crossProject = opts.all || (!opts.project && !opts.env)
      const limit = parseInt(opts.limit, 10) || 20

      if (!crossProject) {
        const { project, env } = resolveProjectEnv(opts, config)
        const data = await apiRequest(
          'GET',
          `/history/${project}/${env}`,
          config,
        )

        const history = data.history as Array<Record<string, unknown>>
        if (!history || history.length === 0) {
          console.log(`No history for ${project}/${env}`)
          return
        }

        const reasonWidth = getFlexColumnWidth(61)

        console.log(`\n${BOLD}History for ${project}/${env}${RESET}\n`)
        console.log(
          `  ${'ID'.padEnd(10)} ${'Status'.padEnd(10)} ${'Proposed'.padEnd(12)} ${'By'.padEnd(25)} Reason`,
        )
        console.log(
          `  ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(25)} ${'─'.repeat(reasonWidth)}`,
        )

        for (const h of history) {
          const sid = shortId(String(h.changeId ?? '?'))
          const status = colorizeStatus(String(h.status ?? '?'), 10)
          const proposed = h.createdAt ? formatTimestamp(String(h.createdAt)) : ''
          const by = String(h.proposedBy ?? '?').substring(0, 24)
          const reason = truncate(String(h.reason ?? ''), reasonWidth)
          console.log(
            `  ${sid.padEnd(10)} ${status} ${proposed.padEnd(12)} ${by.padEnd(25)} ${reason}`,
          )
        }

        printQuickActions(history)
        console.log()
        return
      }

      let queryPath = '/changes'
      const params: string[] = []
      if (opts.status) params.push(`status=${encodeURIComponent(opts.status)}`)
      params.push(`limit=${limit}`)
      if (opts.nextToken) params.push(`nextToken=${encodeURIComponent(opts.nextToken)}`)
      if (params.length > 0) queryPath += `?${params.join('&')}`

      const data = await apiRequest('GET', queryPath, config)
      let changes = data.changes as Array<Record<string, unknown>>

      if (!changes || changes.length === 0) {
        console.log('No changes found.')
        return
      }

      if (opts.project && !opts.env) {
        changes = changes.filter((c) => c.project === opts.project)
      }

      const reasonWidth = getFlexColumnWidth(82)

      console.log(`\n${BOLD}Changes${opts.project ? ` for project ${opts.project}` : ''}${RESET}\n`)
      console.log(
        `  ${'ID'.padEnd(10)} ${'Project'.padEnd(20)} ${'Status'.padEnd(10)} ${'Proposed'.padEnd(12)} ${'By'.padEnd(25)} Reason`,
      )
      console.log(
        `  ${'─'.repeat(10)} ${'─'.repeat(20)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(25)} ${'─'.repeat(reasonWidth)}`,
      )

      for (const c of changes) {
        const sid = shortId(String(c.changeId ?? '?'))
        const projEnv = `${c.project}/${c.env}`
        const status = colorizeStatus(String(c.status ?? '?'), 10)
        const proposed = c.createdAt ? formatTimestamp(String(c.createdAt)) : ''
        const by = String(c.proposedBy ?? '?').substring(0, 24)
        const reason = truncate(String(c.reason ?? ''), reasonWidth)
        console.log(
          `  ${sid.padEnd(10)} ${projEnv.padEnd(20)} ${status} ${proposed.padEnd(12)} ${by.padEnd(25)} ${reason}`,
        )
      }

      const nextToken = data.nextToken as string | undefined
      if (nextToken) {
        const parts = ['sr history --all']
        if (opts.status) parts.push(`--status ${opts.status}`)
        if (opts.project) parts.push(`-p ${opts.project}`)
        parts.push(`--next-token ${nextToken}`)
        console.log(`\n  Next page: ${parts.join(' ')}`)
      }

      printQuickActions(changes)
      console.log()
    })
}

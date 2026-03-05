import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { BOLD, RESET } from '../formatting'
import { resolveProjectEnv } from '../resolve-defaults'

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

        console.log(`\n${BOLD}History for ${project}/${env}${RESET}\n`)
        console.log(
          `  ${'ID'.padEnd(14)} ${'Status'.padEnd(10)} ${'By'.padEnd(25)} Reason`,
        )
        console.log(
          `  ${'─'.repeat(14)} ${'─'.repeat(10)} ${'─'.repeat(25)} ${'─'.repeat(30)}`,
        )

        for (const h of history) {
          const cid = String(h.changeId ?? '?').substring(0, 12)
          const status = String(h.status ?? '?')
          const by = String(h.proposedBy ?? '?').substring(0, 24)
          const reason = String(h.reason ?? '').substring(0, 40)
          console.log(
            `  ${cid.padEnd(14)} ${status.padEnd(10)} ${by.padEnd(25)} ${reason}`,
          )
        }
        console.log()
        return
      }

      let queryPath = '/changes'
      const params: string[] = []
      if (opts.status) params.push(`status=${opts.status}`)
      params.push(`limit=${limit}`)
      if (opts.nextToken) params.push(`nextToken=${opts.nextToken}`)
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

      console.log(`\n${BOLD}Changes${opts.project ? ` for project ${opts.project}` : ''}${RESET}\n`)
      console.log(
        `  ${'ID'.padEnd(14)} ${'Project'.padEnd(20)} ${'Status'.padEnd(10)} ${'By'.padEnd(25)} Reason`,
      )
      console.log(
        `  ${'─'.repeat(14)} ${'─'.repeat(20)} ${'─'.repeat(10)} ${'─'.repeat(25)} ${'─'.repeat(30)}`,
      )

      for (const c of changes) {
        const cid = String(c.changeId ?? '?').substring(0, 12)
        const projEnv = `${c.project}/${c.env}`
        const status = String(c.status ?? '?')
        const by = String(c.proposedBy ?? '?').substring(0, 24)
        const reason = String(c.reason ?? '').substring(0, 30)
        console.log(
          `  ${cid.padEnd(14)} ${projEnv.padEnd(20)} ${status.padEnd(10)} ${by.padEnd(25)} ${reason}`,
        )
      }

      const nextToken = data.nextToken as string | undefined
      if (nextToken) {
        console.log(`\n  Next page: sr history --all --next-token ${nextToken}`)
      }
      console.log()
    })
}

import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { resolveProjectEnv } from '../resolve-defaults'

export const registerHistoryCommand = (program: Command): void => {
  program
    .command('history')
    .description('View change history for a project/environment')
    .option('-p, --project <project>', 'Project name')
    .option('-e, --env <env>', 'Environment name')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])
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

      console.log(`History for ${project}/${env}\n`)
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
    })
}

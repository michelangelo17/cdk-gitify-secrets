import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { formatDiffSymbol } from '../env-parser'
import { CliError } from '../errors'
import { BOLD, RESET, printChangeSummary } from '../formatting'

export const registerStatusCommand = (program: Command): void => {
  program
    .command('status')
    .description('Check pending changes or inspect a specific change')
    .option('--change-id <id>', 'Specific change ID to inspect')
    .option('-p, --project <project>', 'Filter by project')
    .option('-e, --env <env>', 'Filter by environment')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])

      if (opts.changeId) {
        const data = await apiRequest(
          'GET',
          `/changes/${opts.changeId}/diff`,
          config,
        )

        if (data.error) {
          throw new CliError(String(data.error))
        }

        printChangeSummary(data)

        const diff = data.diff as Array<{ type: string; key: string }>
        if (diff && diff.length > 0) {
          console.log('\nChanges:')
          for (const d of diff) {
            console.log(`  ${formatDiffSymbol(d.type)} ${d.key}`)
          }
        }
        console.log()
      } else {
        const data = await apiRequest('GET', '/changes?status=pending', config)
        let changes = data.changes as Array<Record<string, unknown>>

        if (!changes || changes.length === 0) {
          console.log('No pending changes.')
          return
        }

        if (opts.project) {
          changes = changes.filter((c) => c.project === opts.project)
        }
        if (opts.env) {
          changes = changes.filter((c) => c.env === opts.env)
        }

        if (changes.length === 0) {
          const scope = [opts.project, opts.env].filter(Boolean).join('/')
          console.log(`No pending changes for ${scope}.`)
          return
        }

        console.log(`\n${BOLD}${changes.length} pending change(s)${RESET}\n`)
        for (const c of changes) {
          const cid = String(c.changeId ?? '').substring(0, 12)
          console.log(
            `  ${cid}  ${c.project}/${c.env}  ${String(c.reason ?? '').substring(0, 40)}`,
          )
        }
        console.log()
      }
    })
}

import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { resolveChangeId, shortId } from '../change-id'
import { formatDiffSymbol } from '../env-parser'
import { CliError } from '../errors'
import { BOLD, DIM, RESET, formatTimestamp, printChangeSummary, truncate, getFlexColumnWidth } from '../formatting'

const showChangeDetail = async (
  changeId: string,
  config: Parameters<typeof apiRequest>[2],
): Promise<void> => {
  const data = await apiRequest('GET', `/changes/${changeId}/diff`, config)

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
}

export const registerStatusCommand = (program: Command): void => {
  program
    .command('status')
    .description('Check pending changes or inspect a specific change')
    .option('--id <id>', 'Specific change ID to inspect (accepts short prefix)')
    .option('--latest', 'Inspect the most recent pending change')
    .option('-p, --project <project>', 'Filter by project')
    .option('-e, --env <env>', 'Filter by environment')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])

      if (opts.id || opts.latest) {
        const changeId = await resolveChangeId(opts, config)
        await showChangeDetail(changeId, config)
        return
      }

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

      const reasonWidth = getFlexColumnWidth(45)

      console.log(`\n${BOLD}${changes.length} pending change(s)${RESET}\n`)
      console.log(
        `  ${'ID'.padEnd(10)} ${'Project'.padEnd(20)} ${'Proposed'.padEnd(12)} Reason`,
      )
      console.log(
        `  ${'─'.repeat(10)} ${'─'.repeat(20)} ${'─'.repeat(12)} ${'─'.repeat(reasonWidth)}`,
      )

      for (const c of changes) {
        const sid = shortId(String(c.changeId ?? ''))
        const projEnv = `${c.project}/${c.env}`
        const proposed = c.createdAt ? formatTimestamp(String(c.createdAt)) : ''
        const reason = truncate(String(c.reason ?? ''), reasonWidth)
        console.log(
          `  ${sid.padEnd(10)} ${projEnv.padEnd(20)} ${proposed.padEnd(12)} ${reason}`,
        )
      }

      console.log(`\n${DIM}Quick actions:${RESET}`)
      console.log('  sr approve --latest')
      for (const c of changes) {
        const sid = shortId(String(c.changeId ?? ''))
        console.log(`  sr review  --id ${sid}`)
      }
      console.log()
    })
}

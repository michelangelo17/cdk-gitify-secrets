import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { resolveChangeId } from '../change-id'
import { CliError, handleApiError } from '../errors'
import { printChangeSummary } from '../formatting'
import { confirm } from '../prompt'

export const registerRollbackCommand = (program: Command): void => {
  program
    .command('rollback')
    .description('Roll back an approved change to the previous secret version')
    .option('--id <id>', 'Change ID to roll back (accepts short prefix)')
    .option('--latest', 'Roll back the most recent approved change')
    .requiredOption(
      '-r, --reason <reason>',
      'Reason for the rollback (required)',
    )
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])
      const changeId = await resolveChangeId(
        { ...opts, latestStatus: 'approved' },
        config,
      )

      const meta = await apiRequest('GET', `/changes/${changeId}/diff`, config)
      if (meta.error) handleApiError(meta)

      printChangeSummary(meta)

      if (meta.status !== 'approved') {
        throw new CliError(
          `Change is ${meta.status}. Can only roll back approved changes.`,
        )
      }

      console.log()

      if (!opts.yes) {
        const proceed = await confirm('Roll back this change?', false)
        if (!proceed) {
          console.log('Aborted.')
          return
        }
      }

      const data = await apiRequest('POST', '/rollback', config, {
        changeId,
        reason: opts.reason,
      })

      if (data.error) handleApiError(data)

      console.log(data.message ?? `Rolled back change ${changeId}.`)
    })
}

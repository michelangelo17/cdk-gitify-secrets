import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { resolveChangeId } from '../change-id'
import { CliError, handleApiError } from '../errors'
import { confirm } from '../prompt'
import { reviewChange, printReview } from './review'

export const registerApproveCommand = (program: Command): void => {
  program
    .command('approve')
    .description('Approve a pending change')
    .option('--id <id>', 'Change ID to approve (accepts short prefix)')
    .option('--latest', 'Approve the most recent pending change')
    .option('-c, --comment <text>', 'Approval comment')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--skip-review', 'Skip showing the diff before approval')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])
      const changeId = await resolveChangeId(opts, config)

      if (!opts.skipReview) {
        const result = await reviewChange(changeId, config)
        printReview(result)

        if (result.status !== 'pending') {
          throw new CliError(
            `Change is already ${result.status}. Cannot approve.`,
          )
        }
      }

      if (!opts.yes) {
        const proceed = await confirm('Approve this change?', false)
        if (!proceed) {
          console.log('Aborted.')
          return
        }
      }

      const body: Record<string, unknown> = {}
      if (opts.comment) body.comment = opts.comment

      const data = await apiRequest(
        'POST',
        `/changes/${changeId}/approve`,
        config,
        body,
      )

      if (data.error) handleApiError(data)

      console.log(data.message ?? `Change ${changeId} approved.`)
    })
}

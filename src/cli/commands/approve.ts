import { Command } from 'commander'
import { requireConfig, apiRequest } from '../auth'
import { CliError, handleApiError } from '../errors'
import { confirm } from '../prompt'
import { reviewChange, printReview } from './review'

export const registerApproveCommand = (program: Command): void => {
  program
    .command('approve')
    .description('Approve a pending change')
    .requiredOption('--change-id <id>', 'Change ID to approve')
    .option('-c, --comment <text>', 'Approval comment')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--skip-review', 'Skip showing the diff before approval')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])

      if (!opts.skipReview) {
        const result = await reviewChange(opts.changeId, config)
        if (!result) return
        printReview(result)

        if (result.status !== 'pending') {
          throw new CliError(`Change is already ${result.status}. Cannot approve.`)
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
        `/changes/${opts.changeId}/approve`,
        config,
        body,
      )

      if (data.error) handleApiError(data)

      console.log(data.message ?? `Change ${opts.changeId} approved.`)
    })
}

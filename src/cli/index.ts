#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Command } from 'commander'
import { registerApproveCommand } from './commands/approve'
import { registerConfigureCommand } from './commands/configure'
import { registerHistoryCommand } from './commands/history'
import { registerInitCommand } from './commands/init'
import { registerLoginCommand } from './commands/login'
import { registerProposeCommand } from './commands/propose'
import { registerPullCommand } from './commands/pull'
import { registerRejectCommand } from './commands/reject'
import { registerReviewCommand } from './commands/review'
import { registerRollbackCommand } from './commands/rollback'
import { registerStatusCommand } from './commands/status'
import { CliError } from './errors'

const program = new Command()

program
  .name('sr')
  .description(
    'cdk-gitify-secrets CLI -- propose, review, and manage environment secrets',
  )
  .version(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version)

registerInitCommand(program)
registerConfigureCommand(program)
registerLoginCommand(program)
registerProposeCommand(program)
registerPullCommand(program)
registerReviewCommand(program)
registerApproveCommand(program)
registerRejectCommand(program)
registerRollbackCommand(program)
registerHistoryCommand(program)
registerStatusCommand(program)

const main = async () => {
  try {
    await program.parseAsync()
  } catch (err) {
    if (err instanceof CliError) {
      console.error(err.message)
      process.exitCode = 1
    } else {
      throw err
    }
  }
}

void main()

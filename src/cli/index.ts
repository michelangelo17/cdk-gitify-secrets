#!/usr/bin/env node
import { Command } from 'commander'
import { registerConfigureCommand } from './commands/configure'
import { registerHistoryCommand } from './commands/history'
import { registerInitCommand } from './commands/init'
import { registerLoginCommand } from './commands/login'
import { registerProposeCommand } from './commands/propose'
import { registerPullCommand } from './commands/pull'
import { registerStatusCommand } from './commands/status'

const program = new Command()

program
  .name('sr')
  .description(
    'cdk-gitify-secrets CLI -- propose, review, and manage environment secrets',
  )
  .version('0.1.0')

registerInitCommand(program)
registerConfigureCommand(program)
registerLoginCommand(program)
registerProposeCommand(program)
registerPullCommand(program)
registerHistoryCommand(program)
registerStatusCommand(program)

program.parse()

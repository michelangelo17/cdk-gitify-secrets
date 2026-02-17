import { Command } from 'commander'
import { loadConfig, saveConfig, getConfigPath } from '../auth'

export function registerConfigureCommand(program: Command): void {
  program
    .command('configure')
    .description(
      'Configure the CLI with API URL, region, and Cognito client info',
    )
    .option('--api-url <url>', 'Secret Review API URL')
    .option('--region <region>', 'AWS region')
    .option('--client-id <id>', 'Cognito User Pool Client ID')
    .option('--user-pool-id <id>', 'Cognito User Pool ID')
    .option(
      '--secret-prefix <prefix>',
      'Secret name prefix (default: secret-review/)',
    )
    .action((opts) => {
      const config = loadConfig()

      if (opts.apiUrl) config.apiUrl = opts.apiUrl
      if (opts.region) config.region = opts.region
      if (opts.clientId) config.clientId = opts.clientId
      if (opts.userPoolId) config.userPoolId = opts.userPoolId
      if (opts.secretPrefix) config.secretPrefix = opts.secretPrefix

      saveConfig(config)
      console.log(`Config saved to ${getConfigPath()}`)
    })
}

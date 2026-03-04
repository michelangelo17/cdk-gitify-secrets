import { Command } from 'commander'
import { loadConfig, saveConfig, getConfigPath, configFromStack } from '../auth'

export const registerConfigureCommand = (program: Command): void => {
  program
    .command('configure')
    .description(
      'Configure the CLI with API URL, region, and Cognito client info',
    )
    .option('--from-stack <name>', 'Read config from a CloudFormation stack')
    .option('--api-url <url>', 'Secret Review API URL')
    .option('--region <region>', 'AWS region')
    .option('--client-id <id>', 'Cognito User Pool Client ID')
    .option('--user-pool-id <id>', 'Cognito User Pool ID')
    .option(
      '--secret-prefix <prefix>',
      'Secret name prefix (default: secret-review/)',
    )
    .option('--default-project <project>', 'Default project name')
    .option('--default-env <env>', 'Default environment name')
    .action(async (opts) => {
      const config = loadConfig()

      if (opts.fromStack) {
        const region =
          opts.region ?? config.region ?? process.env.AWS_REGION ?? 'us-east-1'

        try {
          const stackConfig = await configFromStack(opts.fromStack, region)
          Object.assign(config, stackConfig)
          console.log(`Loaded config from stack "${opts.fromStack}"`)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`Failed to read stack: ${msg}`)
          process.exit(1)
        }
      }

      if (opts.apiUrl) config.apiUrl = opts.apiUrl
      if (opts.region) config.region = opts.region
      if (opts.clientId) config.clientId = opts.clientId
      if (opts.userPoolId) config.userPoolId = opts.userPoolId
      if (opts.secretPrefix) config.secretPrefix = opts.secretPrefix
      if (opts.defaultProject) config.defaultProject = opts.defaultProject
      if (opts.defaultEnv) config.defaultEnv = opts.defaultEnv

      saveConfig(config)
      console.log(`Config saved to ${getConfigPath()}`)
    })
}

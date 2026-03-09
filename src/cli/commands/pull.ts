import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager'
import { Command } from 'commander'
import { requireConfig, awsCredentials } from '../auth'
import { writeEnvFile } from '../env-parser'
import { CliError } from '../errors'
import { resolveProjectEnv } from '../resolve-defaults'

export const registerPullCommand = (program: Command): void => {
  program
    .command('pull')
    .description(
      'Pull current secrets into a .env file (reads Secrets Manager directly via AWS SDK)',
    )
    .option('-p, --project <project>', 'Project name')
    .option('-e, --env <env>', 'Environment name')
    .option('-o, --output <file>', 'Output .env file path', '.env')
    .option('--keys-only', 'Only show variable keys, not values')
    .action(async (opts) => {
      const config = requireConfig(['region'])
      const { project, env } = resolveProjectEnv(opts, config)
      const region = config.region || process.env.AWS_REGION || 'us-east-1'
      const prefix = config.secretPrefix || 'secret-review/'
      const secretName = `${prefix}${project}/${env}`

      console.log(`Reading secrets from: ${secretName}`)
      console.log('Using AWS SDK directly (IAM credentials)\n')

      try {
        const credentials = awsCredentials()
        const client = new SecretsManagerClient({
          region,
          ...(credentials ? { credentials } : {}),
        })
        const result = await client.send(
          new GetSecretValueCommand({ SecretId: secretName }),
        )

        if (!result.SecretString) {
          console.log('Secret is empty.')
          return
        }

        let values: Record<string, string>
        try {
          values = JSON.parse(result.SecretString)
        } catch {
          throw new CliError('Secret value is not valid JSON. Expected key-value format.')
        }
        const keys = Object.keys(values)

        if (keys.length === 0) {
          console.log(`No variables found for ${project}/${env}`)
          return
        }

        if (opts.keysOnly) {
          console.log(`Variables in ${project}/${env}:`)
          for (const key of keys.sort()) {
            console.log(`  ${key}`)
          }
          console.log(`\n  Total: ${keys.length} variable(s)`)
        } else {
          writeEnvFile(values, opts.output)
          console.log(`Wrote ${keys.length} variable(s) to ${opts.output}`)
          console.log('  Variables:')
          for (const key of keys.sort()) {
            console.log(`    ${key}`)
          }
        }
      } catch (e) {
        if (e instanceof ResourceNotFoundException) {
          throw new CliError(
            `Secret not found: ${secretName}\n` +
            'This project/environment may not have been initialized yet.',
          )
        }
        throw e
      }
    })
}

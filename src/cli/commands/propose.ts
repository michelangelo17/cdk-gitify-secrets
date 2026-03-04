import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  TagResourceCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager'
import { Command } from 'commander'
import { requireConfig, apiRequest, awsCredentials } from '../auth'
import { formatDiffSymbol, parseEnvFile } from '../env-parser'
import { resolveProjectEnv } from '../resolve-defaults'

export const registerProposeCommand = (program: Command): void => {
  program
    .command('propose')
    .description('Propose a change from a .env file')
    .option('-p, --project <project>', 'Project name')
    .option('-e, --env <env>', 'Environment name')
    .option('-r, --reason <reason>', 'Reason for the change')
    .option('-f, --file <file>', 'Path to .env file', '.env')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])
      const { project, env } = resolveProjectEnv(opts, config)
      const reason = opts.reason ?? `Update ${project}/${env}`

      if (!fs.existsSync(opts.file)) {
        console.error(`File not found: ${opts.file}`)
        process.exit(1)
      }

      const variables = parseEnvFile(opts.file)

      if (Object.keys(variables).length === 0) {
        console.error('No variables found in the file.')
        process.exit(1)
      }

      const region = config.region!
      const prefix = config.secretPrefix || 'secret-review/'
      const realSecretName = `${prefix}${project}/${env}`

      console.log(
        `Proposing ${Object.keys(variables).length} variable(s) for ${project}/${env}`,
      )
      console.log(`  Reason: ${reason}`)
      console.log(
        '  Using AWS SDK to create staging secret (IAM credentials)\n',
      )

      const credentials = awsCredentials()
      const smClient = new SecretsManagerClient({
        region,
        ...(credentials ? { credentials } : {}),
      })

      let currentValues: Record<string, string> = {}
      try {
        const current = await smClient.send(
          new GetSecretValueCommand({ SecretId: realSecretName }),
        )
        if (current.SecretString) {
          currentValues = JSON.parse(current.SecretString)
        }
      } catch (e) {
        if (!(e instanceof ResourceNotFoundException)) {
          throw e
        }
      }

      const changeId = randomUUID()
      const stagingSecretName = `${prefix}pending/${changeId}`

      const payload = {
        proposed: variables,
        previous: currentValues,
        project,
        env,
      }

      const createResult = await smClient.send(
        new CreateSecretCommand({
          Name: stagingSecretName,
          SecretString: JSON.stringify(payload),
          Description: `Staging secret for change ${changeId} (${project}/${env})`,
        }),
      )

      if (createResult.ARN) {
        await smClient.send(
          new TagResourceCommand({
            SecretId: createResult.ARN,
            Tags: [
              { Key: 'createdAt', Value: new Date().toISOString() },
              { Key: 'changeId', Value: changeId },
              { Key: 'secretReviewStaging', Value: 'true' },
            ],
          }),
        )
      }

      console.log(`  Staging secret created: ${stagingSecretName}`)

      const data = await apiRequest('POST', '/changes', config, {
        project,
        env,
        stagingSecretName,
        reason,
      })

      if (data.changeId) {
        console.log(`\n  Change proposed: ${data.changeId}\n`)

        const diff = data.diff as Array<{ type: string; key: string }>
        if (diff && diff.length > 0) {
          console.log('  Changes detected:')
          for (const d of diff) {
            console.log(`    ${formatDiffSymbol(d.type)} ${d.key}`)
          }
          console.log()
        }
        console.log('  Waiting for approval in the review dashboard.')
      } else if (data.message === 'No changes detected') {
        console.log('\n  No changes detected. Everything is up to date.')
      } else {
        console.error(data.error || 'Unknown error')
        process.exit(1)
      }
    })
}

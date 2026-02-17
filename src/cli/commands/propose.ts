import * as fs from 'fs'
import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  TagResourceCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager'
import { Command } from 'commander'
import { v4 as uuidv4 } from 'uuid'
import { requireConfig, apiRequest } from '../auth'
import { parseEnvFile } from '../env-parser'

export function registerProposeCommand(program: Command): void {
  program
    .command('propose')
    .description('Propose a change from a .env file')
    .requiredOption('-p, --project <project>', 'Project name')
    .requiredOption('-e, --env <env>', 'Environment name')
    .requiredOption('-r, --reason <reason>', 'Reason for the change')
    .option('-f, --file <file>', 'Path to .env file', '.env')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])

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
      const realSecretName = `${prefix}${opts.project}/${opts.env}`

      console.log(
        `Proposing ${Object.keys(variables).length} variable(s) for ${opts.project}/${opts.env}`,
      )
      console.log(`  Reason: ${opts.reason}`)
      console.log(
        '  Using AWS SDK to create staging secret (IAM credentials)\n',
      )

      const smClient = new SecretsManagerClient({ region })

      // Read current secret values for the staging payload
      let currentValues: Record<string, string> = {}
      try {
        const current = await smClient.send(
          new GetSecretValueCommand({ SecretId: realSecretName }),
        )
        if (current.SecretString) {
          currentValues = JSON.parse(current.SecretString)
        }
      } catch (e) {
        if (e instanceof ResourceNotFoundException) {
          // Secret doesn't exist yet -- that's fine, empty baseline
        } else {
          throw e
        }
      }

      // Create the staging secret directly via AWS SDK
      const changeId = uuidv4()
      const stagingSecretName = `${prefix}pending/${changeId}`

      const payload = {
        proposed: variables,
        previous: currentValues,
        project: opts.project,
        env: opts.env,
      }

      const createResult = await smClient.send(
        new CreateSecretCommand({
          Name: stagingSecretName,
          SecretString: JSON.stringify(payload),
          Description: `Staging secret for change ${changeId} (${opts.project}/${opts.env})`,
        }),
      )

      // Tag for cleanup
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

      // Call the API with metadata only -- no secret values in the HTTP request
      const data = await apiRequest('POST', '/changes', config, {
        project: opts.project,
        env: opts.env,
        stagingSecretName,
        reason: opts.reason,
      })

      if (data.changeId) {
        console.log(`\n  Change proposed: ${data.changeId}\n`)

        const diff = data.diff as Array<{ type: string; key: string }>
        if (diff && diff.length > 0) {
          console.log('  Changes detected:')
          for (const d of diff) {
            const sym =
              { added: '+', removed: '-', modified: '~' }[d.type] ?? '?'
            console.log(`    ${sym} ${d.key}`)
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

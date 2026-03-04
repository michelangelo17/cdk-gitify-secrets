import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { Command } from 'commander'
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  configFromStack,
} from '../auth'
import type { CliConfig } from '../auth'
import { prompt, confirm } from '../prompt'
import { saveLocalConfig } from '../resolve-defaults'

const loginFlow = async (config: CliConfig, opts: {
  email?: string
  password?: string
}): Promise<void> => {
  const email = opts.email ?? await prompt('  Email: ')
  const password = opts.password ?? await prompt('  Password: ', true)

  const client = new CognitoIdentityProviderClient({
    region: config.region!,
  })

  const result = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId!,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  )

  if (result.ChallengeName) {
    console.error(
      `\n  Authentication challenge required: ${result.ChallengeName}`,
    )
    console.error(
      '  Please complete the challenge in the AWS Console first (e.g., set a new password).',
    )
    process.exit(1)
  }

  if (!result.AuthenticationResult) {
    console.error('\n  Authentication failed.')
    process.exit(1)
  }

  config.idToken = result.AuthenticationResult.IdToken
  config.refreshToken = result.AuthenticationResult.RefreshToken
  config.email = email
  config.tokenExpiresAt =
    Math.floor(Date.now() / 1000) +
    (result.AuthenticationResult.ExpiresIn ?? 3600)

  saveConfig(config)
  console.log(`\n  Logged in as ${email}`)
}

export const registerInitCommand = (program: Command): void => {
  program
    .command('init')
    .description(
      'Interactive setup wizard -- configure, login, and set project defaults',
    )
    .option('--stack-name <name>', 'CloudFormation stack name to read config from')
    .option('--region <region>', 'AWS region')
    .option('--email <email>', 'Login email')
    .option('--password <password>', 'Login password')
    .option('--default-project <project>', 'Default project name')
    .option('--default-env <env>', 'Default environment name')
    .option('--skip-login', 'Skip the login step')
    .action(async (opts) => {
      console.log('\n  Welcome to cdk-gitify-secrets!\n')

      const config = loadConfig()
      const region =
        opts.region ??
        config.region ??
        process.env.AWS_REGION ??
        'us-east-1'

      // ── Step 1: Configure from stack or manually ──────────────
      let stackName: string | undefined = opts.stackName

      if (!stackName) {
        const useStack = await confirm(
          '  Configure from a deployed CloudFormation stack?',
        )

        if (useStack) {
          stackName = await prompt('  Stack name: ')
        }
      }

      if (stackName) {
        try {
          console.log(`\n  Reading outputs from stack "${stackName}"...\n`)
          const stackConfig = await configFromStack(stackName, region)
          Object.assign(config, stackConfig)

          console.log(`    API URL:        ${config.apiUrl}`)
          console.log(`    User Pool ID:   ${config.userPoolId}`)
          console.log(`    Client ID:      ${config.clientId}`)
          if (config.secretPrefix) {
            console.log(`    Secret Prefix:  ${config.secretPrefix}`)
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`\n  Failed to read stack: ${msg}`)
          console.error('  Falling back to manual configuration.\n')
          stackName = undefined
        }
      }

      if (!stackName) {
        config.region = region
        config.apiUrl =
          config.apiUrl ?? (await prompt('  API URL: '))
        config.userPoolId =
          config.userPoolId ?? (await prompt('  User Pool ID: '))
        config.clientId =
          config.clientId ?? (await prompt('  Client ID: '))

        const prefix = await prompt(
          `  Secret prefix [${config.secretPrefix ?? 'secret-review/'}]: `,
        )
        if (prefix.trim()) config.secretPrefix = prefix.trim()
      }

      saveConfig(config)
      console.log(`\n  Config saved to ${getConfigPath()}`)

      // ── Step 2: Login ─────────────────────────────────────────
      if (!opts.skipLogin) {
        console.log('\n  Log in to continue.\n')

        try {
          await loginFlow(config, {
            email: opts.email,
            password: opts.password,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`\n  Login failed: ${msg}`)
          console.error('  You can log in later with: sr login\n')
        }
      }

      // ── Step 3: Project defaults ──────────────────────────────
      const project =
        opts.defaultProject ?? (await prompt('\n  Default project: '))
      const env =
        opts.defaultEnv ?? (await prompt('  Default environment: '))

      if (project.trim() && env.trim()) {
        const saveLocal = await confirm(
          '\n  Save project defaults to .sr.json in this directory?',
        )

        if (saveLocal) {
          const filePath = saveLocalConfig({
            project: project.trim(),
            env: env.trim(),
          })
          console.log(
            `  Created ${filePath} (project: ${project.trim()}, env: ${env.trim()})`,
          )
        }

        config.defaultProject = project.trim()
        config.defaultEnv = env.trim()
        saveConfig(config)
      }

      console.log('\n  Ready! Try: sr propose\n')
    })
}

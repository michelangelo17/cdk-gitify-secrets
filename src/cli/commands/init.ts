import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { Command } from 'commander'
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  configFromStack,
  awsCredentials,
} from '../auth'
import type { CliConfig } from '../auth'
import { CliError } from '../errors'
import { prompt, confirm } from '../prompt'
import { loadLocalConfig, saveLocalConfig } from '../resolve-defaults'

const cognitoClient = (config: CliConfig) => {
  const credentials = awsCredentials()
  return new CognitoIdentityProviderClient({
    region: config.region!,
    ...(credentials ? { credentials } : {}),
  })
}

const createUserFlow = async (
  config: CliConfig,
  opts: {
    email?: string
    password?: string
  },
): Promise<void> => {
  const email = opts.email ?? (await prompt('  Email: '))
  const password =
    opts.password ??
    process.env.SR_PASSWORD ??
    (await prompt('  Choose a password: ', true))

  const client = cognitoClient(config)

  console.log('\n  Creating user...')
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: config.userPoolId!,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
      MessageAction: 'SUPPRESS',
      TemporaryPassword: password,
    }),
  )

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: config.userPoolId!,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  )

  console.log(`  Created user: ${email}`)

  const authResult = await client.send(
    new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: config.clientId!,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  )

  if (!authResult.AuthenticationResult) {
    console.error('\n  User created but login failed. Run: npx sr login')
    return
  }

  config.idToken = authResult.AuthenticationResult.IdToken
  config.refreshToken = authResult.AuthenticationResult.RefreshToken
  config.email = email
  config.tokenExpiresAt =
    Math.floor(Date.now() / 1000) +
    (authResult.AuthenticationResult.ExpiresIn ?? 3600)

  saveConfig(config)
  console.log(`  Logged in as ${email}`)
}

const loginFlow = async (
  config: CliConfig,
  opts: {
    email?: string
    password?: string
  },
): Promise<void> => {
  const email = opts.email ?? (await prompt('  Email: '))
  const password =
    opts.password ??
    process.env.SR_PASSWORD ??
    (await prompt('  Password: ', true))

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
    throw new CliError(
      `Authentication challenge required: ${result.ChallengeName}\n` +
        'Please complete the challenge in the AWS Console first (e.g., set a new password).',
    )
  }

  if (!result.AuthenticationResult) {
    throw new CliError('Authentication failed.')
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
    .option(
      '--stack-name <name>',
      'CloudFormation stack name to read config from',
    )
    .option('--region <region>', 'AWS region')
    .option('--email <email>', 'Login email')
    .option('--password <password>', 'Login password')
    .option('--default-project <project>', 'Default project name')
    .option('--default-env <env>', 'Default environment name')
    .option('--skip-login', 'Skip the login step')
    .option(
      '--create-user',
      'Create a new Cognito user (requires IAM admin access)',
    )
    .action(async (opts) => {
      console.log('\n  Welcome to cdk-gitify-secrets!\n')

      const config = loadConfig()
      const region =
        opts.region ??
        process.env.AWS_REGION ??
        process.env.AWS_DEFAULT_REGION ??
        config.region

      if (!region) {
        throw new CliError(
          'Could not determine AWS region.\n' +
            'Pass --region or set the AWS_REGION environment variable.',
        )
      }

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
          console.error(`  (searched in region: ${region})`)
          console.error('  Falling back to manual configuration.\n')
          stackName = undefined
        }
      }

      if (!stackName) {
        config.region = region
        config.apiUrl = config.apiUrl ?? (await prompt('  API URL: '))
        config.userPoolId =
          config.userPoolId ?? (await prompt('  User Pool ID: '))
        config.clientId = config.clientId ?? (await prompt('  Client ID: '))

        const prefix = await prompt(
          `  Secret prefix [${config.secretPrefix ?? 'secret-review/'}]: `,
        )
        if (prefix.trim()) config.secretPrefix = prefix.trim()
      }

      saveConfig(config)
      console.log(`\n  Config saved to ${getConfigPath()}`)

      // ── Step 2: Create user and/or login ────────────────────
      if (!opts.skipLogin) {
        let createUser = opts.createUser as boolean | undefined

        if (createUser === undefined) {
          createUser = await confirm(
            '\n  Create your first Cognito user? (requires IAM admin access)',
          )
        }

        if (createUser) {
          try {
            console.log('')
            await createUserFlow(config, {
              email: opts.email,
              password: opts.password,
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`\n  Failed to create user: ${msg}`)
            console.error('  You can create a user manually:')
            console.error(
              `    aws cognito-idp admin-create-user --user-pool-id ${config.userPoolId} --username <email> --user-attributes Name=email,Value=<email> Name=email_verified,Value=true`,
            )
            console.error('  Then run: npx sr login\n')
          }
        } else {
          const wantsLogin = await confirm('  Log in with an existing account?')

          if (wantsLogin) {
            try {
              console.log('')
              await loginFlow(config, {
                email: opts.email,
                password: opts.password,
              })
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              console.error(`\n  Login failed: ${msg}`)
              console.error('  You can log in later with: npx sr login\n')
            }
          }
        }
      }

      // ── Step 3: Project defaults ──────────────────────────────
      const existing = loadLocalConfig()
      const defaultProject =
        opts.defaultProject ?? existing.project ?? config.defaultProject
      const defaultEnv = opts.defaultEnv ?? existing.env ?? config.defaultEnv

      const projectLabel = defaultProject
        ? `\n  Default project [${defaultProject}]: `
        : '\n  Default project: '
      const envLabel = defaultEnv
        ? `  Default environment [${defaultEnv}]: `
        : '  Default environment: '

      const projectInput = opts.defaultProject ?? (await prompt(projectLabel))
      const envInput = opts.defaultEnv ?? (await prompt(envLabel))

      const project = projectInput.trim() || defaultProject || ''
      const env = envInput.trim() || defaultEnv || ''

      if (project && env) {
        const saveLocal = await confirm(
          '\n  Save project defaults to .sr.json in this directory?',
        )

        if (saveLocal) {
          const filePath = saveLocalConfig({ project, env })
          console.log(
            `  Created ${filePath} (project: ${project}, env: ${env})`,
          )
        }

        config.defaultProject = project
        config.defaultEnv = env
        saveConfig(config)
      }

      console.log('\n  Ready! Try: npx sr propose\n')
    })
}

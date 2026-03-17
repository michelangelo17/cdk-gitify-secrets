import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { Command } from 'commander'
import { requireConfig, saveConfig, getConfigPath } from '../auth'
import { CliError } from '../errors'
import { prompt } from '../prompt'

export const registerLoginCommand = (program: Command): void => {
  program
    .command('login')
    .description('Authenticate with Cognito and store tokens')
    .option('--email <email>', 'Email address')
    .option('--password <password>', 'Password (prompted if not provided)')
    .action(async (opts) => {
      const config = requireConfig(['region', 'clientId'])

      const email = opts.email || (await prompt('Email: '))
      const password =
        opts.password ??
        process.env.SR_PASSWORD ??
        (await prompt('Password: ', true))

      try {
        const client = new CognitoIdentityProviderClient({
          region: config.region!,
        })
        const result = await client.send(
          new InitiateAuthCommand({
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: config.clientId!,
            AuthParameters: {
              USERNAME: email,
              PASSWORD: password,
            },
          }),
        )

        if (result.AuthenticationResult) {
          config.idToken = result.AuthenticationResult.IdToken
          config.refreshToken = result.AuthenticationResult.RefreshToken
          config.email = email
          config.tokenExpiresAt =
            Math.floor(Date.now() / 1000) +
            (result.AuthenticationResult.ExpiresIn ?? 3600)

          saveConfig(config)
          console.log(`Logged in as ${email}`)
          console.log(`Token stored at ${getConfigPath()}`)
        } else if (result.ChallengeName) {
          throw new CliError(
            `Authentication challenge required: ${result.ChallengeName}\n` +
              'Please complete the challenge in the AWS Console first (e.g., set a new password).',
          )
        } else {
          throw new CliError('Authentication failed.')
        }
      } catch (e) {
        if (e instanceof CliError) throw e
        const message = e instanceof Error ? e.message : String(e)
        throw new CliError(`Login failed: ${message}`)
      }
    })
}

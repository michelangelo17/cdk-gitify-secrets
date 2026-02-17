import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { Command } from 'commander';
import { requireConfig } from '../auth';
import { writeEnvFile } from '../env-parser';

export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description(
      'Pull current secrets into a .env file (reads Secrets Manager directly via AWS SDK)',
    )
    .requiredOption('-p, --project <project>', 'Project name')
    .requiredOption('-e, --env <env>', 'Environment name')
    .option('-o, --output <file>', 'Output .env file path', '.env')
    .option('--keys-only', 'Only show variable keys, not values')
    .action(async (opts) => {
      const config = requireConfig([]);
      const region = config.region || process.env.AWS_REGION || 'us-east-1';
      const prefix = config.secretPrefix || 'secret-review/';
      const secretName = `${prefix}${opts.project}/${opts.env}`;

      console.log(`Reading secrets from: ${secretName}`);
      console.log('Using AWS SDK directly (IAM credentials)\n');

      try {
        const client = new SecretsManagerClient({ region });
        const result = await client.send(
          new GetSecretValueCommand({ SecretId: secretName }),
        );

        if (!result.SecretString) {
          console.log('Secret is empty.');
          return;
        }

        const values: Record<string, string> = JSON.parse(result.SecretString);
        const keys = Object.keys(values);

        if (keys.length === 0) {
          console.log(`No variables found for ${opts.project}/${opts.env}`);
          return;
        }

        if (opts.keysOnly) {
          console.log(`Variables in ${opts.project}/${opts.env}:`);
          for (const key of keys.sort()) {
            console.log(`  ${key}`);
          }
          console.log(`\n  Total: ${keys.length} variable(s)`);
        } else {
          writeEnvFile(values, opts.output);
          console.log(`Wrote ${keys.length} variable(s) to ${opts.output}`);
          console.log('  Variables:');
          for (const key of keys.sort()) {
            console.log(`    ${key}`);
          }
        }
      } catch (e) {
        if (e instanceof ResourceNotFoundException) {
          console.error(`Secret not found: ${secretName}`);
          console.error(
            'This project/environment may not have been initialized yet.',
          );
          process.exit(1);
        }
        throw e;
      }
    });
}

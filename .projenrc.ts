import { awscdk, javascript } from 'projen'

const project = new awscdk.AwsCdkConstructLibrary({
  name: 'cdk-gitify-secrets',
  description:
    'GitOps-style secret management with review workflows, built on AWS Secrets Manager. Deploy as a CDK construct.',
  author: 'Michelangelo Markus',
  authorAddress: 'https://github.com/michelangelo17',
  repositoryUrl: 'https://github.com/michelangelo17/cdk-gitify-secrets',

  packageManager: javascript.NodePackageManager.NPM,

  cdkVersion: '2.170.0',
  defaultReleaseBranch: 'main',
  jsiiVersion: '~5.9.0',
  projenrcTs: true,

  // Runtime deps bundled into the package
  bundledDeps: [
    'commander',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    'uuid',
  ],

  // Dev-only deps
  devDeps: ['esbuild', '@types/aws-lambda', '@types/uuid'],

  // npm discoverability
  keywords: [
    'aws',
    'cdk',
    'secrets-manager',
    'secrets',
    'gitops',
    'review-workflow',
    'environment-variables',
    'infrastructure-as-code',
    'security',
  ],

  // Stability
  stability: 'experimental',

  // License
  license: 'MIT',

  // Publish to npm via OIDC trusted publishing (no NPM_TOKEN needed)
  npmTrustedPublishing: true,

  // Don't auto-approve PRs
  autoApproveUpgrades: false,
  autoApproveOptions: undefined,
})

// Match Prettier style: no semicolons, consistent interface member delimiters
project.eslint?.addOverride({
  files: ['*.ts'],
  rules: {
    '@stylistic/semi': ['error', 'never'],
    '@stylistic/member-delimiter-style': [
      'error',
      {
        multiline: { delimiter: 'none' },
        singleline: { delimiter: 'semi', requireLast: false },
      },
    ],
  },
})

// Add CLI bin entry
project.addBins({ sr: 'lib/cli/index.js' })

// Ensure Lambda source and frontend are included in the npm package
// NodejsFunction needs the TS source at synth time
project.npmignore?.addPatterns('!/src/lambda/', '!/src/frontend/')

project.synth()

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
  majorVersion: 1,
  jsiiVersion: '~5.9.0',
  projenrcTs: true,

  tsconfig: {
    compilerOptions: {
      lib: ['es2023'],
    },
  },
  tsconfigDev: {
    compilerOptions: {
      lib: ['es2023'],
    },
  },

  // Runtime deps bundled into the package
  bundledDeps: [
    'commander',
    '@aws-sdk/client-cloudformation',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-secrets-manager',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
  ],

  devDeps: ['esbuild', '@types/aws-lambda'],

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
  stability: 'stable',

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

// Pre-bundle Lambda handlers so consumers don't need esbuild or Docker
const bundleTask = project.addTask('bundle-lambdas', {
  description: 'Bundle Lambda handlers with esbuild',
})

const handlers = [
  'propose',
  'approve',
  'reject',
  'list-changes',
  'history',
  'rollback',
  'diff',
  'cleanup',
]

for (const handler of handlers) {
  bundleTask.exec(
    `esbuild src/lambda/handlers/${handler}.ts --bundle --platform=node --target=node22 --minify --sourcemap --outfile=lib/lambda-bundles/${handler}/index.js`,
  )
}

project.preCompileTask.spawn(bundleTask)

// Add CLI bin entry and ensure the file is executable after jsii compile
project.addBins({ sr: 'lib/cli/index.js' })
project.postCompileTask.exec('chmod +x lib/cli/index.js')

project.synth()

# cdk-gitify-secrets

**GitOps-style secret management with review workflows, built on AWS Secrets Manager.**

Deploy as a CDK construct. No extra vendors, no SaaS -- everything stays in your AWS account.

## The Problem

Your CDK stack needs secrets. Today you either:

1. **Hardcode values in CDK** -- they end up in CloudFormation, CI logs, source control
2. **Manage via AWS CLI** -- awkward JSON strings, no review process, easy to fat-finger production

cdk-gitify-secrets fixes this by adding a **review workflow** between your `.env` file and Secrets Manager -- like a pull request for secrets.

## How It Works

```
Developer                          AWS Secrets Manager        cdk-gitify-secrets API
    |                                     |                          |
    |  sr propose                         |                          |
    |  (1) CreateSecret (staging)  ------>|                          |
    |  (2) POST /changes (metadata only) --------------------------->|
    |                                     |     compute diff,        |
    |                                     |     store in DynamoDB    |
    |                                     |                          |
    |         Reviewer opens dashboard, sees key-level diff          |
    |         (no values shown), clicks "Approve"                    |
    |                                     |                          |
    |                                     |<--- approve handler ----|
    |                                     |  copies staging -> real   |
    |                                     |  deletes staging secret  |
    |                                     |                          |
    |  sr pull                            |                          |
    |  (reads via AWS SDK directly) ----->|                          |
    |<------ .env file written -----------|                          |
```

**Key principle: secret values never transit through the custom API.** Both `sr propose` and `sr pull` interact with Secrets Manager directly via the AWS SDK. The API only handles workflow metadata (who proposed what, approvals, rejections).

## Install

```bash
npm install cdk-gitify-secrets
```

## Usage (CDK)

```typescript
import { SecretReview } from "cdk-gitify-secrets"

// In your CDK stack
const sr = new SecretReview(this, "SecretReview", {
  projects: [
    { name: "backend-api", environments: ["dev", "staging", "production"] },
    { name: "payment-service", environments: ["dev", "production"] },
  ],
})

// Reference secrets in your application stacks
const secret = sr.getSecret("backend-api", "production")
secret.grantRead(myLambda)
myLambda.addEnvironment("SECRET_ARN", secret.secretArn)
```

### Deploy

```bash
npx cdk deploy
```

The output gives you:

- `ApiUrl` -- the API endpoint
- `FrontendUrl` -- the review dashboard
- `UserPoolId` / `UserPoolClientId` -- for auth configuration
- `SecretPrefix` -- for CLI configuration

### Adding Users

Self-signup is disabled by default -- users must be created by an admin. Use the AWS CLI:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username alice@company.com \
  --user-attributes Name=email,Value=alice@company.com Name=email_verified,Value=true \
  --temporary-password 'TempPass123!@#'
```

The user will be prompted to set a permanent password on first login.

If `requireMfa` is enabled, users will additionally be prompted to set up a TOTP authenticator app (e.g. Google Authenticator, Authy, 1Password) during their first sign-in.

### Construct Props

| Prop                     | Type                      | Default                             | Description                                                         |
| ------------------------ | ------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| `projects`               | `ProjectConfig[]`         | _required_                          | Projects and their environments                                     |
| `userPool`               | `cognito.IUserPool`       | auto-created                        | Bring your own Cognito user pool                                    |
| `userPoolClient`         | `cognito.IUserPoolClient` | auto-created                        | Bring your own client (only used with `userPool`)                   |
| `deployFrontend`         | `boolean`                 | `true`                              | Deploy the web review dashboard via S3 + CloudFront                 |
| `allowedOrigins`         | `string[]`                | CloudFront URL (or `["*"]` if frontend disabled) | CORS allowed origins                                     |
| `preventSelfApproval`    | `boolean`                 | `true`                              | Block self-approval of changes                                      |
| `enableProjectScoping`   | `boolean`                 | `false`                             | Per-project access control via Cognito groups (see Security Model)  |
| `removalPolicy`          | `RemovalPolicy`           | `RETAIN`                            | Removal policy for stateful resources (DynamoDB, KMS, Secrets)      |
| `vpc`                    | `ec2.IVpc`                | none                                | Place Lambdas in VPC with PrivateLink endpoints                     |
| `throttle`               | `ThrottleConfig`          | `{ rateLimit: 10, burstLimit: 20 }` | API Gateway rate limiting                                           |
| `crossAccountReadAccess` | `string[]`                | none                                | Account IDs with read-only access to managed secrets                |
| `replicaRegions`         | `ReplicaRegion[]`         | none                                | Regions to replicate secrets to via native SM replication           |
| `requireMfa`             | `boolean`                 | `false`                             | Require TOTP MFA for Cognito users (only when pool is auto-created) |

Project and environment names must match `^[a-zA-Z0-9_-]+$` (alphanumeric, hyphens, underscores only). Invalid names throw an error at synth time.

### VPC Mode (for regulated environments)

For PCI, HIPAA, or environments that require all traffic to stay on AWS's private network:

```typescript
import { Vpc } from "aws-cdk-lib/aws-ec2"

const vpc = new Vpc(this, "Vpc", { maxAzs: 2 })

const sr = new SecretReview(this, "SecretReview", {
  projects: [{ name: "api", environments: ["dev", "prod"] }],
  vpc,
})
```

When `vpc` is provided, the construct:

- Places all Lambda functions in the VPC's private subnets
- Creates VPC Interface Endpoints (PrivateLink) for Secrets Manager and KMS
- Creates a VPC Gateway Endpoint for DynamoDB
- All AWS API calls stay on AWS's internal backbone -- never traverse the public internet

### MFA (Multi-Factor Authentication)

Enable TOTP-based MFA for dashboard and workflow users:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [{ name: "api", environments: ["dev", "prod"] }],
  requireMfa: true,
})
```

When enabled:

- MFA is **required** for all Cognito users (not optional)
- Users must configure a TOTP authenticator app (Google Authenticator, Authy, 1Password, etc.)
- SMS-based MFA is not used -- only software tokens

This only applies when the construct creates its own user pool. If you bring your own (`userPool` prop), configure MFA on it directly.

**When to enable:** Recommended for environments where dashboard users can approve, reject, or rollback secret changes and an unauthorized approval could have significant operational impact. Even though the API never touches secret values, a compromised Cognito account can approve malicious changes or trigger rollbacks.

### Cross-Account Secret Access

For organizations with a central "security" or "shared services" account that manages secrets, and application accounts that consume them:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [{ name: "api", environments: ["dev", "prod"] }],
  crossAccountReadAccess: ["222222222222", "333333333333"],
})
```

This adds:

- A **resource policy** on each secret allowing `GetSecretValue` and `DescribeSecret` from the listed accounts
- A **KMS key policy** granting `kms:Decrypt` to each account

The review workflow (API, dashboard, DynamoDB, Cognito) stays entirely in the central account. Consuming accounts only read the final approved secret values. In the consuming account's CDK stack:

```typescript
import { Secret } from "aws-cdk-lib/aws-secretsmanager"

// Reference the secret from the central account by ARN
const secret = Secret.fromSecretCompleteArn(
  this,
  "ApiProdSecret",
  "arn:aws:secretsmanager:us-east-1:111111111111:secret:secret-review/api/prod-AbCdEf",
)

// Grant read to your application
secret.grantRead(myLambda)
```

### Multi-Region Replication

For applications deployed across multiple regions, Secrets Manager can automatically replicate secrets:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [{ name: "api", environments: ["dev", "prod"] }],
  replicaRegions: [{ region: "eu-west-1" }, { region: "ap-southeast-1" }],
})
```

When the approve Lambda writes to the primary secret, Secrets Manager syncs the value to all replica regions automatically (typically within seconds). Applications in those regions read the local replica with lower latency. No changes needed in your application code -- just point to the same secret name in any region.

You can also combine both features:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [{ name: "api", environments: ["dev", "prod"] }],
  crossAccountReadAccess: ["222222222222"],
  replicaRegions: [{ region: "eu-west-1" }],
})
```

Account `222222222222` can read the secret in either region. The review workflow remains centralized.

### Public API

```typescript
sr.getSecret("project", "env") // Get ISecret for use in other stacks
sr.grantSecretRead("project", "env", grantee) // Grant read access (secret + KMS)
sr.grantCliPropose(grantee) // Grant CLI propose permissions
sr.grantCliPull(grantee) // Grant CLI pull-only permissions
sr.apiUrl // API Gateway URL
sr.frontendUrl // CloudFront dashboard URL (undefined if frontend disabled)
sr.userPool // Cognito User Pool
sr.userPoolClient // Cognito User Pool Client
sr.encryptionKey // KMS Key
sr.table // DynamoDB Table
sr.secretPrefix // Secret name prefix (default: "secret-review/")
```

## IAM Requirements

The CLI needs IAM credentials (from `~/.aws/credentials`, environment variables, or SSO) to interact with Secrets Manager directly. The construct provides helper methods to grant exactly the right permissions.

### Propose-capable users (`sr propose` + `sr pull`)

```typescript
import { User } from "aws-cdk-lib/aws-iam"

// Grant to an IAM user
const devUser = User.fromUserName(this, "DevUser", "alice")
sr.grantCliPropose(devUser)
```

This grants the following scoped policy:

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:CreateSecret", "secretsmanager:TagResource"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:secret-review/pending/*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": ["arn:aws:secretsmanager:*:*:secret:secret-review/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "<KMS key ARN>"
    }
  ]
}
```

**Why this is safe:** `CreateSecret` only creates new secrets (staging prefix). It does NOT grant `PutSecretValue` or `DeleteSecret` -- so a developer with these permissions physically cannot modify existing production secrets. The only path to modify a production secret is through the approve Lambda, which enforces the review workflow.

### Pull-only users (`sr pull` only)

```typescript
import { User } from "aws-cdk-lib/aws-iam"

const readOnlyUser = User.fromUserName(this, "ReadOnlyUser", "bob")
sr.grantCliPull(readOnlyUser)
```

This grants only:

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:secret-review/<project>/<env>-*"
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "<KMS key ARN>"
    }
  ]
}
```

## Usage (CLI)

### Install

The `sr` command is available via `npx` from any project that has `cdk-gitify-secrets` as a dependency -- no global install required:

```bash
npx sr <command>
```

If you prefer a global install:

```bash
npm install -g cdk-gitify-secrets
sr <command>
```

### Quick Start

After deploying the CDK stack, run the interactive setup wizard:

```bash
npx sr init --stack-name MySecretReviewStack
```

This single command:

1. Reads API URL, User Pool, Client ID, and Secret Prefix from the CloudFormation stack outputs
2. Prompts you to log in with your Cognito credentials
3. Asks for default project and environment, then optionally saves them to a local `.sr.json`

For CI or non-interactive environments, pass all flags to skip prompts:

```bash
npx sr init --stack-name MyStack --email ci@company.com --password "$SR_PASSWORD" \
  --default-project backend-api --default-env production
```

After init, every CLI command works with zero flags:

```bash
npx sr propose                         # reads .sr.json, defaults reason, reads .env
npx sr propose -r "Add Stripe key"    # override just the reason
npx sr pull                            # reads .sr.json, writes to .env
npx sr pull -e staging -o staging.env  # override env and output
npx sr history                         # reads .sr.json
```

### Project Defaults (`.sr.json`)

The CLI resolves project and environment using a priority chain:

1. **CLI flags** (`-p`, `-e`) -- highest priority
2. **Local `.sr.json`** in the current working directory
3. **Global config** (`defaultProject`, `defaultEnv` in `~/.cdk-gitify-secrets/config.json`)

Create a `.sr.json` in your repo root (like `.nvmrc` or `.node-version`):

```json
{
  "project": "backend-api",
  "env": "dev"
}
```

This means `sr propose`, `sr pull`, and `sr history` all work with zero flags from that directory.

### Configure

For users who prefer manual setup over `sr init`:

```bash
# Auto-configure from a deployed stack (recommended)
npx sr configure --from-stack MySecretReviewStack --region us-east-1

# Or set values individually
npx sr configure --api-url https://xxxxx.execute-api.us-east-1.amazonaws.com
npx sr configure --region us-east-1
npx sr configure --client-id <UserPoolClientId>
npx sr configure --user-pool-id <UserPoolId>

# Set default project/env (used when flags are omitted)
npx sr configure --default-project backend-api --default-env dev
```

An optional `--secret-prefix` flag overrides the default prefix (`secret-review/`). Only change this if you've customized the prefix in your construct.

Configuration is saved to `~/.cdk-gitify-secrets/config.json` with `0600` permissions. The CLI warns if the file has overly permissive permissions.

### Login

```bash
npx sr login
# Email: you@company.com
# Password: ********
# Logged in. Token stored at ~/.cdk-gitify-secrets/config.json
```

For CI/automation, use the `SR_PASSWORD` environment variable (avoids leaking credentials to shell history):

```bash
SR_PASSWORD='YourPassword123!' npx sr login --email you@company.com
```

You can also pass `--password` directly, but be aware this is visible in shell history and `ps` output.

Tokens are automatically refreshed when they expire. If refresh fails, run `sr login` again.

### Propose a change

```bash
# Zero flags -- uses .sr.json defaults, reads .env, auto-generates reason
npx sr propose

# Override specific values
npx sr propose -r "Add Stripe API key"
npx sr propose -p backend-api -e production -r "Initial secrets" -f ./secrets/prod.env
```

This does two things:

1. Creates a staging secret in Secrets Manager via the AWS SDK (using your IAM credentials)
2. Calls the API with metadata only (project, environment, reason, staging secret name -- no values)

### Review and approve

Open the `FrontendUrl` in your browser, sign in with your Cognito credentials, and approve the change. The dashboard shows which keys changed (added/modified/removed) but never displays actual secret values.

### Pull secrets for local development

```bash
# Zero flags -- uses .sr.json defaults, writes to .env
npx sr pull

# Override specific values
npx sr pull -e staging -o ./secrets/staging.env
npx sr pull -p backend-api -e dev --keys-only
```

Pull reads Secrets Manager directly via the AWS SDK (IAM credentials). The custom API is not involved.

### View history

```bash
# Zero flags -- uses .sr.json defaults
npx sr history

# Override project/env
npx sr history -p backend-api -e production
```

Displays a table of past changes with change ID, status, proposer, and reason.

### Check status

```bash
# List all pending changes
npx sr status

# Inspect a specific change
npx sr status --change-id abc-123-def
```

### CLI Reference

| Command | Description |
| --- | --- |
| `npx sr init [--stack-name NAME] [--region REGION] [--email EMAIL] [--password PASS] [--default-project P] [--default-env E] [--skip-login]` | Interactive setup wizard (config + login + defaults) |
| `npx sr configure [--from-stack NAME] [options]` | Set up API URL, region, Cognito config, project defaults |
| `npx sr login [--email EMAIL] [--password PASS]` | Authenticate with Cognito |
| `npx sr propose [-p PROJECT] [-e ENV] [-r "reason"] [-f FILE]` | Propose changes from a .env file |
| `npx sr pull [-p PROJECT] [-e ENV] [-o FILE] [--keys-only]` | Pull secrets via AWS SDK |
| `npx sr history [-p PROJECT] [-e ENV]` | View change history |
| `npx sr status [--change-id ID]` | Check pending changes / inspect a change |

## Security Model

### The custom API never touches secret values

This is the core design principle. The API Gateway + Lambda handlers handle **only workflow metadata**: who proposed a change, which keys changed, approval status, reviewer comments.

- **`sr propose`** creates a staging secret directly in Secrets Manager via the AWS SDK (using the developer's IAM credentials). Then it calls the API with only the staging secret name, project, env, and reason -- no values in the HTTP request.
- **`sr pull`** reads Secrets Manager directly via the AWS SDK. The custom API is not involved at all.
- **The dashboard** shows key names and change types (added/modified/removed) only. There is no reveal button, no partial values, no masked values. Reviewing actual values requires IAM access to Secrets Manager (AWS Console or CLI).
- **The diff Lambda** only reads DynamoDB metadata. It has no `secretsmanager:GetSecretValue` permission.

### Where secret values live

- **DynamoDB stores only metadata**: who proposed what, when, status, which keys changed. Never stores actual secret values.
- **Proposed values** are stored as temporary "staging" secrets in Secrets Manager (`secret-review/pending/{changeId}`), encrypted with the same KMS key.
- **On approval**, the approve Lambda copies values from the staging secret to the real secret, then deletes the staging secret.
- **On rejection**, the staging secret is deleted immediately.

### Authorization model

By default, all authenticated Cognito users are peers with equal access to all projects. This is suitable for small/medium teams where every developer should be able to propose, review, and view history for any project.

For larger teams or environments that require per-project isolation, enable the `enableProjectScoping` prop:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [
    { name: "backend-api", environments: ["dev", "production"] },
    { name: "payment-service", environments: ["dev", "production"] },
  ],
  enableProjectScoping: true,
});
```

When enabled:

- A **Cognito group** is created for each project (named after the project).
- All API endpoints enforce group membership -- users can only propose, approve, reject, rollback, view diffs, and read history for projects they belong to.
- The `list-changes` endpoint filters results to only show changes for the caller's groups.

**Managing group membership** via the AWS CLI:

```bash
# Add a user to the backend-api project
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <UserPoolId> \
  --username alice@company.com \
  --group-name backend-api

# List groups for a user
aws cognito-idp admin-list-groups-for-user \
  --user-pool-id <UserPoolId> \
  --username alice@company.com
```

### Dual authentication model

The CLI uses two different auth mechanisms:

- **Cognito JWT** (for workflow): `sr propose` (metadata only), `sr history`, `sr status` go through the API Gateway, authenticated via Cognito JWT.
- **IAM credentials** (for secret values): `sr propose` (staging secret creation) and `sr pull` interact with Secrets Manager directly using the developer's IAM credentials from `~/.aws/credentials`, env vars, or SSO.

This means even if a Cognito account is compromised, the attacker cannot read or write secret values without also having valid IAM credentials with the right Secrets Manager permissions.

### Optimistic concurrency

When a change is proposed, the propose Lambda records the Secrets Manager `VersionId` of the real secret. When an approver approves, the approve Lambda verifies the `VersionId` hasn't changed. If another change was approved in between, the approval fails with a `409 Conflict`, preventing silent overwrites.

Status transitions (pending -> approved/rejected) are enforced atomically via DynamoDB condition expressions, preventing race conditions where two reviewers approve the same change simultaneously.

### Rollback

Rollback uses Secrets Manager's native `AWSPREVIOUS` version stage to retrieve the state of the secret before the last write. No staging secret needed -- rollback works even after staging secrets are cleaned up.

### API rate limiting

The HTTP API has throttling enabled by default (10 requests/second steady-state, 20 burst). Override via the `throttle` prop:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [...],
  throttle: { rateLimit: 50, burstLimit: 100 },
});
```

### CORS

When the frontend dashboard is deployed (default), CORS is automatically scoped to the CloudFront distribution URL. When the frontend is disabled, or if you provide a custom `allowedOrigins` prop, those values are used instead. This prevents third-party websites from making authenticated requests to your API.

### CLI credential safety

- **Config file permissions**: The CLI writes `~/.cdk-gitify-secrets/config.json` with `0600` permissions (owner read/write only) and warns if the file has overly permissive permissions.
- **HTTPS enforcement**: The CLI refuses to send credentials to non-HTTPS API URLs (except `http://localhost` for local development).
- **`SR_PASSWORD` env var**: For CI/automation, use the `SR_PASSWORD` environment variable instead of the `--password` flag. Environment variables don't appear in shell history or `ps` output.

### Cleanup Lambda IAM note

The cleanup Lambda requires `secretsmanager:ListSecrets` with `Resource: "*"` -- this is an [AWS IAM limitation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_iam-permissions.html) as `ListSecrets` does not support resource-level restrictions. The `DeleteSecret` action is scoped to the staging prefix (`secret-review/pending/*`) and further restricted by an IAM tag condition (`secretReviewStaging: "true"`).

### Other security features

- **KMS encryption** with key rotation enabled by default
- **Self-approval prevention** -- can't approve your own changes (configurable via `preventSelfApproval`)
- **Cognito authentication** for the API and dashboard (self-signup disabled by default)
- **Optional TOTP MFA** for Cognito users via `requireMfa` prop
- **CloudTrail auditing** -- every Secrets Manager access is logged
- **Scoped IAM** -- each Lambda handler gets only the permissions it needs (e.g., the list, diff, and history Lambdas have zero Secrets Manager access)
- **Orphan cleanup** -- a daily scheduled Lambda deletes stale staging secrets
- **Optional VPC mode** -- PrivateLink endpoints for regulated environments
- **Project/env validation** -- all handlers validate project and environment names against the deployed configuration, rejecting unknown combinations

### Known limitations

These are conscious design trade-offs, not bugs:

- **No per-project RBAC by default** -- without `enableProjectScoping`, all authenticated users can see and act on all projects. Enable project scoping for team isolation.
- **Rollback is available to all authenticated users** -- there is no separate "admin" role for rollback. Any authenticated user (or any user in the project group, if scoping is enabled) can roll back an approved change.
- **CLI password masking is best-effort** -- Node.js does not provide a built-in way to suppress terminal echo. The password prompt shows `*` characters but the underlying terminal may briefly display real characters depending on platform and timing. This is cosmetic; passwords are never logged or stored insecurely.
- **`--password` flag is visible in shell history** -- use the `SR_PASSWORD` environment variable or the interactive prompt instead.

## Using Secrets in Your Application

The secrets follow the naming convention `secret-review/{project}/{env}`. In your application code:

```typescript
// Lambda / Node.js
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager"

const client = new SecretsManagerClient({})
const result = await client.send(
  new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN }),
)
const vars = JSON.parse(result.SecretString!)
console.log(vars.DATABASE_URL)
```

```typescript
// CDK: Pass secret to ECS
import { ContainerDefinition, Secret as EcsSecret } from "aws-cdk-lib/aws-ecs"

new ContainerDefinition(this, "Container", {
  secrets: {
    DATABASE_URL: EcsSecret.fromSecretsManager(
      sr.getSecret("backend-api", "production"),
      "DATABASE_URL",
    ),
  },
})
```

Values are resolved at runtime -- they never appear in CloudFormation templates or CDK output.

## Architecture

```
+--------------+     +------------------+     +-----------------+
|  CLI (sr)    |---->|  API Gateway     |---->|  Lambda          |
|  metadata    |     |  + Cognito JWT   |     |  handlers (x8)   |
|  only        |     |  + throttling    |     |  metadata only   |
+------+-------+     +------------------+     +--------+--------+
       |                                               |
       | (propose + pull:                      +-------+--------+
       |  direct AWS SDK)                      |  DynamoDB      |
       |                                       |  (metadata)    |
       v                                       +----------------+
+--------------+     +------------------+
|  Secrets     |     |  Frontend        |
|  Manager     |     |  S3 + CloudFront |
|  + KMS       |     |  (key names only)|
+--------------+     +------------------+
```

## Future Work

- **Frontend framework migration**: The current dashboard is a single HTML file. As features grow, it may be migrated to a lightweight framework (e.g., Preact or Svelte) for better maintainability. The current SPA approach works well for the current feature set.
- **Slack / Teams notifications**: A future release will add webhook notifications on propose/approve/reject events, with the webhook URL stored in Secrets Manager (not as a Lambda env var) and scoped to only the Lambdas that send notifications.

## License

MIT

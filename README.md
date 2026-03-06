# cdk-gitify-secrets

**GitOps-style secret management with review workflows, built on AWS Secrets Manager.**

Deploy as a CDK construct. No extra vendors, no SaaS -- everything stays in your AWS account.

## Why

Your app reads secrets from AWS Secrets Manager at runtime. The question is how those secrets get _into_ Secrets Manager in the first place. Common approaches:

1. **AWS Console / CLI** — click through the UI or run `aws secretsmanager put-secret-value`. Works fine for one-off setup, but there's no review step, no change history beyond CloudTrail, and it's easy to fat-finger a value in production.
2. **Deploy scripts** — a shell script reads `.env` and calls the AWS SDK. Fast, but whoever runs the script has full write access. No approval gate, no diff, no audit trail you can query without digging through CloudTrail.
3. **CDK `Secret` construct** — reference `.env` values in your CDK code and create secrets at deploy time. Convenient, but the secret values end up in your CloudFormation template (visible in the AWS console and in deployment artifacts). Low-risk if your account is locked down, but it's still plaintext in places you might not expect.

All three share the same gap: **there's no review workflow and no easy rollback**. A typo, a wrong environment, or a copy-paste mistake goes straight to production with no second pair of eyes — and undoing it means manually figuring out what the previous values were.

cdk-gitify-secrets adds that missing step — a **propose → review → approve** cycle between your `.env` file and Secrets Manager, like a pull request for secrets. Secrets never pass through the API (they're written directly via the AWS SDK), and every change is tracked with diffs, approvals, and audit history. If something goes wrong, `sr rollback` restores the previous secret version in one command — using Secrets Manager's native version staging, so it works even after staging secrets are cleaned up.

**When to use this:** teams where more than one person touches secrets, or where you want an auditable change history without relying solely on CloudTrail.

**When NOT to use this:** solo projects where the overhead of a review cycle isn't worth it, or environments where secrets are fully managed by CI/CD pipelines you already trust.

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
    |  sr review --id <id>         |                          |
    |  (reads staging + live via SDK) --->|                          |
    |  shows colored value-level diff     |                          |
    |                                     |                          |
    |  sr approve --id <id>        |                          |
    |  POST /changes/{id}/approve  --------------------------->      |
    |                                     |<--- approve handler ----|
    |                                     |  copies staging -> real   |
    |                                     |  deletes staging secret  |
    |                                     |                          |
    |  sr pull                            |                          |
    |  (reads via AWS SDK directly) ----->|                          |
    |<------ .env file written -----------|                          |
```

**Key principle: secret values never transit through the custom API.** Both `sr propose` and `sr pull` interact with Secrets Manager directly via the AWS SDK. The API only handles workflow metadata (who proposed what, approvals, rejections). `sr review` reads secrets directly via the SDK to show diffs locally.

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
- `UserPoolId` / `UserPoolClientId` -- for auth configuration
- `SecretPrefix` -- for CLI configuration

### Adding Users

Self-signup is disabled by default -- users must be created by an admin. The `sr init` wizard can create the first user for you. For additional users, use the AWS CLI:

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
| `preventSelfApproval`    | `boolean`                 | `true`                              | Block self-approval of changes                                      |
| `enableProjectScoping`   | `boolean`                 | `false`                             | Per-project access control via Cognito groups (see Security Model)  |
| `enableApproverRole`     | `boolean`                 | `false`                             | Require approver group membership for approve/reject/rollback       |
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

Enable TOTP-based MFA for workflow users:

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

**When to enable:** Recommended for environments where users can approve, reject, or rollback secret changes and an unauthorized approval could have significant operational impact. Even though the API never touches secret values, a compromised Cognito account can approve malicious changes or trigger rollbacks.

### Approver Role

For teams that want to separate who can propose changes from who can approve them:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [
    { name: "backend-api", environments: ["dev", "production"] },
  ],
  enableApproverRole: true,
})
```

When enabled:

- A `<project>-approvers` Cognito group is created for each project
- Only members of the approver group can approve, reject, or rollback changes
- All authenticated users can still propose changes and view history

This is independent of `enableProjectScoping` -- both can be used together for maximum control.

**Managing approver membership** via the AWS CLI:

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <UserPoolId> \
  --username alice@company.com \
  --group-name backend-api-approvers
```

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

The review workflow (API, DynamoDB, Cognito) stays entirely in the central account. Consuming accounts only read the final approved secret values. In the consuming account's CDK stack:

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
sr.userPool // Cognito User Pool
sr.userPoolClient // Cognito User Pool Client
sr.encryptionKey // KMS Key
sr.table // DynamoDB Table
sr.secretPrefix // Secret name prefix (default: "secret-review/")
```

## IAM Requirements

The CLI needs IAM credentials (from `~/.aws/credentials`, environment variables, or SSO) to interact with Secrets Manager directly. The construct provides helper methods to grant exactly the right permissions.

### Propose-capable users (`sr propose` + `sr pull` + `sr review`)

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
2. Optionally creates the first Cognito user
3. Prompts you to log in with your Cognito credentials
4. Asks for default project and environment, then optionally saves them to a local `.sr.json`

For CI or non-interactive environments, pass all flags to skip prompts:

```bash
npx sr init --stack-name MyStack --email ci@company.com --password "$SR_PASSWORD" \
  --default-project backend-api --default-env production
```

After init, every CLI command works with zero flags:

```bash
npx sr propose -r "Add Stripe key"    # reason is required
npx sr propose -r "Initial setup"     # reads .sr.json defaults for project/env
npx sr pull                            # reads .sr.json, writes to .env
npx sr pull -e staging -o staging.env  # override env and output
npx sr history                         # reads .sr.json
npx sr review --id <id>        # full value-level diff
npx sr approve --id <id>       # review + approve in one step
```

### Full Workflow Walkthrough

Here's an end-to-end example: adding a new API key to the `backend-api/production` environment.

**1. Propose a change** from your `.env` file:

```bash
$ npx sr propose -r "Add Stripe API key"
Proposing 3 variable(s) for backend-api/production
  Staging secret created: secret-review/pending/a1b2c3d4-...
  Change proposed: a1b2c3d4-...

  Changes detected:
    + STRIPE_API_KEY

  Run: sr review --id a1b2c3d4
```

**2. Review the diff** (reads secrets via AWS SDK, never through the API):

```bash
$ npx sr review --latest

Change:  a1b2c3d4-...
Status:  pending
Project: backend-api/production
By:      alice@company.com
Reason:  Add Stripe API key
Date:    just now

  1 change(s): +1 -0 ~0

  + STRIPE_API_KEY=sk_live_abc123
```

**3. Approve** (a teammate, or the same user if `preventSelfApproval: false`):

```bash
$ npx sr approve --latest
# Shows the review diff, then prompts:
# Approve this change? (y/N): y
Change a1b2c3d4-... approved and applied
```

**4. Pull the updated secrets** into your local `.env`:

```bash
$ npx sr pull
Pulled 3 variable(s) to .env
```

**5. Roll back** if something goes wrong:

```bash
$ npx sr rollback --latest -r "Stripe key was for wrong environment"
Change:  a1b2c3d4-...
Status:  approved
Project: backend-api/production
By:      alice@company.com
Reason:  Add Stripe API key

Roll back this change? (y/N): y
Rolled back change a1b2c3d4-...
```

You can check pending changes at any time with `sr status`:

```
$ npx sr status
2 pending change(s)

  ID         Project              Proposed     Reason
  ────────── ──────────────────── ──────────── ────────────────────────────
  a1b2c3d4   backend-api/prod     2h ago       Add Stripe API key
  e5f6a7b8   payment-svc/staging  3d ago       Rotate DB password

Quick actions:
  sr approve --id a1b2c3d4
  sr review  --id a1b2c3d4
  sr approve --id e5f6a7b8
  sr review  --id e5f6a7b8
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

### Propose a Change

```bash
# Reason is required -- like a commit message
npx sr propose -r "Add Stripe API key"
npx sr propose -p backend-api -e production -r "Initial secrets" -f ./secrets/prod.env
```

This does two things:

1. Creates a staging secret in Secrets Manager via the AWS SDK (using your IAM credentials)
2. Calls the API with metadata only (project, environment, reason, staging secret name -- no values)

### Review a Change

```bash
# Full value-level diff (reads staging + live secrets via AWS SDK)
npx sr review --id <id>

# Include unchanged keys in the output
npx sr review --id <id> --show-all

# Machine-readable output
npx sr review --id <id> --json
```

The review command reads both the staging and live secrets directly from Secrets Manager using your IAM credentials, then displays a colored diff:

- **Green `+ KEY=value`** -- added
- **Red `- KEY=value`** -- removed
- **Yellow `~ KEY: old → new`** -- modified

### Approve or Reject

```bash
# Approve: shows the full review diff, then asks for confirmation
npx sr approve --id <id>
npx sr approve --id <id> -c "Looks good" -y  # skip confirmation

# Reject: shows change summary, then asks for confirmation
npx sr reject --id <id>
npx sr reject --id <id> -c "Wrong values" -y  # skip confirmation
```

When approving, the API handler copies values from the staging secret to the production secret, then deletes the staging secret. On rejection, the staging secret is deleted without applying.

### Pull Secrets for Local Development

```bash
# Zero flags -- uses .sr.json defaults, writes to .env
npx sr pull

# Override specific values
npx sr pull -e staging -o ./secrets/staging.env
npx sr pull -p backend-api -e dev --keys-only
```

Pull reads Secrets Manager directly via the AWS SDK (IAM credentials). The custom API is not involved.

### View History

```bash
# Scoped -- uses .sr.json defaults
npx sr history

# Cross-project -- all changes across all projects
npx sr history --all
npx sr history --all --status approved --limit 50

# Filter by project (client-side)
npx sr history -p backend-api --all

# Override project/env for scoped view
npx sr history -p backend-api -e production
```

### Check Status

```bash
# List all pending changes
npx sr status

# Filter by project/env
npx sr status -p backend-api
npx sr status -p backend-api -e production

# Inspect a specific change
npx sr status --id abc-123-def
```

### CLI Reference

| Command | Description |
| --- | --- |
| `sr init [--stack-name NAME] [--region REGION] [--email EMAIL] [--password PASS] [--default-project P] [--default-env E] [--skip-login]` | Interactive setup wizard |
| `sr configure [--from-stack NAME] [options]` | Set up API URL, region, Cognito config, project defaults |
| `sr login [--email EMAIL] [--password PASS]` | Authenticate with Cognito |
| `sr propose -r "reason" [-p PROJECT] [-e ENV] [-f FILE]` | Propose changes from a .env file |
| `sr pull [-p PROJECT] [-e ENV] [-o FILE] [--keys-only]` | Pull secrets via AWS SDK |
| `sr review --id ID [--show-all] [--json]` | Review a change with full value-level diff |
| `sr approve --id ID [-c COMMENT] [-y] [--skip-review]` | Approve a pending change |
| `sr reject --id ID [-c COMMENT] [-y]` | Reject a pending change |
| `sr rollback --id ID -r "reason" [-y]` | Roll back an approved change |
| `sr history [-p PROJECT] [-e ENV] [--all] [--status S] [--limit N]` | View change history |
| `sr status [--id ID] [-p PROJECT] [-e ENV]` | Check pending changes / inspect a change |

## Security Model

### The custom API never touches secret values

This is the core design principle. The API Gateway + Lambda handlers handle **only workflow metadata**: who proposed a change, which keys changed, approval status, reviewer comments.

- **`sr propose`** creates a staging secret directly in Secrets Manager via the AWS SDK (using the developer's IAM credentials). Then it calls the API with only the staging secret name, project, env, and reason -- no values in the HTTP request.
- **`sr review`** reads both the staging and live secrets directly from Secrets Manager via the AWS SDK (using your IAM credentials). The diff is computed and displayed locally in your terminal. The custom API is only used to fetch change metadata (status, proposer, reason).
- **`sr pull`** reads Secrets Manager directly via the AWS SDK. The custom API is not involved at all.
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

### Approver role (optional)

When `enableApproverRole` is true, approve/reject/rollback operations require membership in the `<project>-approvers` Cognito group. All authenticated users can still propose changes and view history. See the [Approver Role](#approver-role) section for setup details.

### Dual authentication model

The CLI uses two different auth mechanisms:

- **Cognito JWT** (for workflow): `sr propose` (metadata only), `sr approve`, `sr reject`, `sr history`, `sr status` go through the API Gateway, authenticated via Cognito JWT.
- **IAM credentials** (for secret values): `sr propose` (staging secret creation), `sr review` (reading secrets for diff), and `sr pull` interact with Secrets Manager directly using the developer's IAM credentials from `~/.aws/credentials`, env vars, or SSO.

This means even if a Cognito account is compromised, the attacker cannot read or write secret values without also having valid IAM credentials with the right Secrets Manager permissions.

### Optimistic concurrency

When a change is proposed, the propose Lambda records the Secrets Manager `VersionId` of the real secret. When an approver approves, the approve Lambda verifies the `VersionId` hasn't changed. If another change was approved in between, the approval fails with a `409 Conflict`, preventing silent overwrites.

Status transitions (pending -> approved/rejected) are enforced atomically via DynamoDB condition expressions, preventing race conditions where two reviewers approve the same change simultaneously.

### Rollback

Roll back an approved change to restore the previous secret version:

```bash
# Roll back a specific change
npx sr rollback --id <id> -r "Broke payment processing"

# Roll back the most recent approved change
npx sr rollback --latest -r "Wrong API key for production"

# Skip confirmation
npx sr rollback --id <id> -r "Revert" -y
```

Under the hood, rollback uses Secrets Manager's native `AWSPREVIOUS` version stage to retrieve the state of the secret before the last write. No staging secret needed -- rollback works even after staging secrets are cleaned up. The rollback itself is recorded in change history with its own audit trail.

### API rate limiting

The HTTP API has throttling enabled by default (10 requests/second steady-state, 20 burst). Override via the `throttle` prop:

```typescript
const sr = new SecretReview(this, "SecretReview", {
  projects: [...],
  throttle: { rateLimit: 50, burstLimit: 100 },
});
```

### CORS

CORS is set to allow all origins (`*`). Since the API is authenticated via Cognito JWT tokens and never handles secret values, this is safe. The JWT token in the `Authorization` header provides the actual access control.

### CLI credential safety

- **Config file permissions**: The CLI writes `~/.cdk-gitify-secrets/config.json` with `0600` permissions (owner read/write only) and warns if the file has overly permissive permissions.
- **HTTPS enforcement**: The CLI refuses to send credentials to non-HTTPS API URLs (except `http://localhost` for local development).
- **`SR_PASSWORD` env var**: For CI/automation, use the `SR_PASSWORD` environment variable instead of the `--password` flag. Environment variables don't appear in shell history or `ps` output.

### Cleanup Lambda IAM note

The cleanup Lambda requires `secretsmanager:ListSecrets` with `Resource: "*"` -- this is an [AWS IAM limitation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/reference_iam-permissions.html) as `ListSecrets` does not support resource-level restrictions. The `DeleteSecret` action is scoped to the staging prefix (`secret-review/pending/*`) and further restricted by an IAM tag condition (`secretReviewStaging: "true"`).

### Other security features

- **KMS encryption** with key rotation enabled by default
- **Self-approval prevention** -- can't approve your own changes (configurable via `preventSelfApproval`)
- **Cognito authentication** for the API (self-signup disabled by default)
- **Optional TOTP MFA** for Cognito users via `requireMfa` prop
- **Optional approver role** for separating proposer and approver permissions
- **CloudTrail auditing** -- every Secrets Manager access is logged
- **Scoped IAM** -- each Lambda handler gets only the permissions it needs (e.g., the list, diff, and history Lambdas have zero Secrets Manager access)
- **Orphan cleanup** -- a daily scheduled Lambda deletes stale staging secrets
- **Optional VPC mode** -- PrivateLink endpoints for regulated environments
- **Project/env validation** -- all handlers validate project and environment names against the deployed configuration, rejecting unknown combinations

### Known limitations

These are conscious design trade-offs, not bugs:

- **No per-project RBAC by default** -- without `enableProjectScoping`, all authenticated users can see and act on all projects. Enable project scoping for team isolation.
- **Rollback is available to all authenticated users** -- unless `enableApproverRole` is enabled, there is no separate role for rollback. Any authenticated user (or any user in the project group, if scoping is enabled) can roll back an approved change.
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
       | (propose + pull + review:              +------+--------+
       |  direct AWS SDK)                       |  DynamoDB     |
       |                                        |  (metadata)   |
       v                                        +---------------+
+--------------+
|  Secrets     |
|  Manager     |
|  + KMS       |
+--------------+
```

## Future Work

- **Slack / Teams notifications**: A future release will add webhook notifications on propose/approve/reject events, with the webhook URL stored in Secrets Manager (not as a Lambda env var) and scoped to only the Lambdas that send notifications.

## License

MIT

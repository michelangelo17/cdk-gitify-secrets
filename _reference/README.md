# Secret Review

**GitOps-style secret management with review workflows.**  
Built on AWS Secrets Manager, deployed with CDK. No extra vendors, no SaaS, everything stays in your AWS account.

## The Problem

Your CDK stack needs secrets. Today you either:

1. **Hardcode values in CDK** → they end up in CloudFormation, CI logs, source control
2. **Manage via AWS CLI** → awkward JSON strings, no review process, easy to fat-finger production

Secret Review fixes this by adding a **review workflow** between your `.env` file and Secrets Manager — like a pull request for secrets.

## How It Works

```
Developer                    Secret Review                  AWS Secrets Manager
    │                              │                                │
    │  sr propose -p api -e prod   │                                │
    │  -r "rotated Stripe keys"    │                                │
    │─────────────────────────────>│                                │
    │                              │  stores diff as pending        │
    │                              │  change in DynamoDB            │
    │                              │                                │
    │         Reviewer opens web dashboard                          │
    │         sees diff, clicks "Approve"                           │
    │                              │                                │
    │                              │  PutSecretValue ──────────────>│
    │                              │                                │
    │                              │  ✅ encrypted, versioned,      │
    │                              │     audit-trailed              │
```

## What You Get

- **Propose/approve workflow** — no one writes to production secrets unreviewed
- **Diff view** — see exactly what's changing, with masked values by default
- **Version history** — who changed what, when, and why
- **One-click rollback** — revert to any previous state
- **Self-approval guard** — can't approve your own changes
- **KMS encryption** — with key rotation enabled by default
- **CloudTrail auditing** — every access and mutation logged
- **IAM access control** — scoped per project/environment/role
- **Cognito auth** — for the web dashboard, tied to your AWS org
- **Zero extra vendors** — everything runs in your AWS account

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  CLI (sr)    │────>│  API Gateway     │────>│  Lambda          │
│  .env → diff │     │  + Cognito JWT   │     │  handlers        │
└──────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
┌──────────────┐                              ┌────────┴────────┐
│  Frontend    │     ┌──────────────────┐     │                 │
│  S3 + CF     │────>│  DynamoDB        │<────│  Secrets Manager│
│  (review UI) │     │  (change reqs)   │     │  + KMS          │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

All deployed as a single CDK stack. Total infrastructure cost: pennies/month for typical usage (DynamoDB on-demand, Lambda invocations, S3 static hosting).

## Quick Start

### 1. Configure your projects

Edit `bin/app.ts`:

```typescript
new SecretReviewStack(this, "SecretReviewStack", {
  projects: {
    "backend-api": ["dev", "staging", "production"],
    "payment-service": ["dev", "production"],
  },
  // approverArns: ["arn:aws:iam::123456789:role/DevOpsLead"],
  // slackWebhookUrl: "https://hooks.slack.com/services/...",
});
```

### 2. Deploy

```bash
npm install
npx cdk bootstrap   # first time only
npx cdk deploy
```

The output gives you:
- `ApiUrl` — the API endpoint
- `FrontendUrl` — the review dashboard
- `UserPoolId` / `UserPoolClientId` — for auth configuration

### 3. Create a Cognito user

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username you@company.com \
  --temporary-password 'TempPass123!' \
  --user-attributes Name=email,Value=you@company.com
```

### 4. Install the CLI

```bash
pip install requests
# Copy cli/sr.py somewhere on your PATH, or:
alias sr="python3 /path/to/secret-review/cli/sr.py"
```

### 5. Configure the CLI

```bash
sr configure --api-url https://xxxxx.execute-api.us-east-1.amazonaws.com --token <YOUR_COGNITO_TOKEN>
```

### 6. Propose your first change

```bash
echo "DATABASE_URL=postgres://prod-db:5432/app" > .env
echo "STRIPE_KEY=sk_live_abc123" >> .env

sr propose -p backend-api -e production -r "Initial production secrets"
```

### 7. Review and approve

Open the `FrontendUrl` in your browser, sign in, and approve the change.

## CLI Reference

| Command | Description |
|---------|-------------|
| `sr configure --api-url URL --token TOKEN` | Set up the CLI |
| `sr propose -p PROJECT -e ENV -r "reason" [-f .env]` | Propose changes from a .env file |
| `sr pull -p PROJECT -e ENV` | View current variable keys |
| `sr history -p PROJECT -e ENV` | View change history |
| `sr status [--change-id ID]` | Check pending changes |

## Using With CDK

The secrets created by this stack follow the naming convention `secret-review/{project}/{env}`. Reference them in your other CDK stacks:

```typescript
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

// In your application stack
const dbSecret = secretsmanager.Secret.fromSecretNameV2(
  this, "DbSecret", "secret-review/backend-api/production"
);

// Pass to Lambda
myFunction.addEnvironment("DB_SECRET_ARN", dbSecret.secretArn);
dbSecret.grantRead(myFunction);

// Pass to ECS
new ecs.ContainerDefinition(this, "Container", {
  secrets: {
    DATABASE_URL: ecs.Secret.fromSecretsManager(dbSecret, "DATABASE_URL"),
  },
});
```

The values are resolved at runtime by the consuming service — they never appear in CloudFormation templates or CDK output.

## Project Structure

```
secret-review/
├── bin/app.ts                    # CDK app entry point — configure projects here
├── lib/secret-review-stack.ts    # CDK stack — all infrastructure
├── lambda/handlers/              # API Lambda handlers (Python)
│   ├── utils.py                  #   shared utilities
│   ├── propose.py                #   POST /changes
│   ├── approve.py                #   POST /changes/{id}/approve
│   ├── reject.py                 #   POST /changes/{id}/reject
│   ├── list_changes.py           #   GET /changes
│   ├── history.py                #   GET /history/{project}/{env}
│   ├── rollback.py               #   POST /rollback
│   └── diff.py                   #   GET /changes/{id}/diff
├── frontend/index.html           # Review dashboard (plain HTML/JS)
├── cli/sr.py                     # Developer CLI tool
├── cdk.json
├── package.json
└── tsconfig.json
```

## What This Doesn't Do (Yet)

- **RBAC per project/env** — currently all authenticated users can see all projects. Add Cognito groups + Lambda authorizer checks for fine-grained access.
- **Slack/Teams notifications** — the `slackWebhookUrl` prop is wired but the Lambda notification code isn't implemented yet.
- **CLI pull with values** — the CLI currently shows keys only for security. Add a `/secrets/{project}/{env}` endpoint if you want full `sr pull -o .env` support.
- **Automatic CI integration** — a GitHub Action that runs `sr propose` on `.env.example` changes would close the loop nicely.

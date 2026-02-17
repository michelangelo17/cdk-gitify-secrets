# API Reference <a name="API Reference" id="api-reference"></a>

## Constructs <a name="Constructs" id="Constructs"></a>

### SecretReview <a name="SecretReview" id="cdk-gitify-secrets.SecretReview"></a>

A CDK construct that deploys a GitOps-style secret management workflow built on AWS Secrets Manager, with review/approval, audit trail, and a web dashboard.

DynamoDB stores only metadata (who, when, status, key names).
All secret values live exclusively in Secrets Manager, encrypted with a custom KMS key.

#### Initializers <a name="Initializers" id="cdk-gitify-secrets.SecretReview.Initializer"></a>

```typescript
import { SecretReview } from 'cdk-gitify-secrets'

new SecretReview(scope: Construct, id: string, props: SecretReviewProps)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#cdk-gitify-secrets.SecretReview.Initializer.parameter.scope">scope</a></code> | <code>constructs.Construct</code> | *No description.* |
| <code><a href="#cdk-gitify-secrets.SecretReview.Initializer.parameter.id">id</a></code> | <code>string</code> | *No description.* |
| <code><a href="#cdk-gitify-secrets.SecretReview.Initializer.parameter.props">props</a></code> | <code><a href="#cdk-gitify-secrets.SecretReviewProps">SecretReviewProps</a></code> | *No description.* |

---

##### `scope`<sup>Required</sup> <a name="scope" id="cdk-gitify-secrets.SecretReview.Initializer.parameter.scope"></a>

- *Type:* constructs.Construct

---

##### `id`<sup>Required</sup> <a name="id" id="cdk-gitify-secrets.SecretReview.Initializer.parameter.id"></a>

- *Type:* string

---

##### `props`<sup>Required</sup> <a name="props" id="cdk-gitify-secrets.SecretReview.Initializer.parameter.props"></a>

- *Type:* <a href="#cdk-gitify-secrets.SecretReviewProps">SecretReviewProps</a>

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#cdk-gitify-secrets.SecretReview.toString">toString</a></code> | Returns a string representation of this construct. |
| <code><a href="#cdk-gitify-secrets.SecretReview.getSecret">getSecret</a></code> | Get an ISecret reference for a project/environment, for use in other stacks. |
| <code><a href="#cdk-gitify-secrets.SecretReview.grantCliPropose">grantCliPropose</a></code> | Grant CLI propose permissions to a grantee (IAM user, role, etc.). |
| <code><a href="#cdk-gitify-secrets.SecretReview.grantCliPull">grantCliPull</a></code> | Grant CLI pull (read-only) permissions to a grantee. |
| <code><a href="#cdk-gitify-secrets.SecretReview.grantSecretRead">grantSecretRead</a></code> | Grant read access on a project/env secret to a grantee (Lambda, ECS task, etc.). |

---

##### `toString` <a name="toString" id="cdk-gitify-secrets.SecretReview.toString"></a>

```typescript
public toString(): string
```

Returns a string representation of this construct.

##### `getSecret` <a name="getSecret" id="cdk-gitify-secrets.SecretReview.getSecret"></a>

```typescript
public getSecret(project: string, env: string): ISecret
```

Get an ISecret reference for a project/environment, for use in other stacks.

###### `project`<sup>Required</sup> <a name="project" id="cdk-gitify-secrets.SecretReview.getSecret.parameter.project"></a>

- *Type:* string

---

###### `env`<sup>Required</sup> <a name="env" id="cdk-gitify-secrets.SecretReview.getSecret.parameter.env"></a>

- *Type:* string

---

##### `grantCliPropose` <a name="grantCliPropose" id="cdk-gitify-secrets.SecretReview.grantCliPropose"></a>

```typescript
public grantCliPropose(grantee: IGrantable): void
```

Grant CLI propose permissions to a grantee (IAM user, role, etc.).

This grants:
- `secretsmanager:CreateSecret` + `secretsmanager:TagResource` on the staging prefix
- `secretsmanager:GetSecretValue` on all managed secrets (real + staging, for pull and propose diff)
- `kms:Decrypt` on the encryption key

This does NOT grant `PutSecretValue` or `DeleteSecret` -- the review workflow
(approve Lambda) is the only path to write to production secrets.

###### `grantee`<sup>Required</sup> <a name="grantee" id="cdk-gitify-secrets.SecretReview.grantCliPropose.parameter.grantee"></a>

- *Type:* aws-cdk-lib.aws_iam.IGrantable

---

##### `grantCliPull` <a name="grantCliPull" id="cdk-gitify-secrets.SecretReview.grantCliPull"></a>

```typescript
public grantCliPull(grantee: IGrantable): void
```

Grant CLI pull (read-only) permissions to a grantee.

This grants:
- `secretsmanager:GetSecretValue` on real secrets only
- `kms:Decrypt` on the encryption key

###### `grantee`<sup>Required</sup> <a name="grantee" id="cdk-gitify-secrets.SecretReview.grantCliPull.parameter.grantee"></a>

- *Type:* aws-cdk-lib.aws_iam.IGrantable

---

##### `grantSecretRead` <a name="grantSecretRead" id="cdk-gitify-secrets.SecretReview.grantSecretRead"></a>

```typescript
public grantSecretRead(project: string, env: string, grantee: IGrantable): Grant
```

Grant read access on a project/env secret to a grantee (Lambda, ECS task, etc.).

###### `project`<sup>Required</sup> <a name="project" id="cdk-gitify-secrets.SecretReview.grantSecretRead.parameter.project"></a>

- *Type:* string

---

###### `env`<sup>Required</sup> <a name="env" id="cdk-gitify-secrets.SecretReview.grantSecretRead.parameter.env"></a>

- *Type:* string

---

###### `grantee`<sup>Required</sup> <a name="grantee" id="cdk-gitify-secrets.SecretReview.grantSecretRead.parameter.grantee"></a>

- *Type:* aws-cdk-lib.aws_iam.IGrantable

---

#### Static Functions <a name="Static Functions" id="Static Functions"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#cdk-gitify-secrets.SecretReview.isConstruct">isConstruct</a></code> | Checks if `x` is a construct. |

---

##### ~~`isConstruct`~~ <a name="isConstruct" id="cdk-gitify-secrets.SecretReview.isConstruct"></a>

```typescript
import { SecretReview } from 'cdk-gitify-secrets'

SecretReview.isConstruct(x: any)
```

Checks if `x` is a construct.

###### `x`<sup>Required</sup> <a name="x" id="cdk-gitify-secrets.SecretReview.isConstruct.parameter.x"></a>

- *Type:* any

Any object.

---

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.node">node</a></code> | <code>constructs.Node</code> | The tree node. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.api">api</a></code> | <code>aws-cdk-lib.aws_apigatewayv2.HttpApi</code> | The HTTP API Gateway. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.apiUrl">apiUrl</a></code> | <code>string</code> | The API URL. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.encryptionKey">encryptionKey</a></code> | <code>aws-cdk-lib.aws_kms.IKey</code> | The KMS encryption key used for all secrets. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.secretPrefix">secretPrefix</a></code> | <code>string</code> | The secret name prefix used for Secrets Manager naming. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.table">table</a></code> | <code>aws-cdk-lib.aws_dynamodb.ITable</code> | The DynamoDB table for change request metadata. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.userPool">userPool</a></code> | <code>aws-cdk-lib.aws_cognito.IUserPool</code> | The Cognito user pool (created or provided). |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.userPoolClient">userPoolClient</a></code> | <code>aws-cdk-lib.aws_cognito.IUserPoolClient</code> | The Cognito user pool client. |
| <code><a href="#cdk-gitify-secrets.SecretReview.property.frontendUrl">frontendUrl</a></code> | <code>string</code> | The CloudFront URL for the review dashboard. |

---

##### `node`<sup>Required</sup> <a name="node" id="cdk-gitify-secrets.SecretReview.property.node"></a>

```typescript
public readonly node: Node;
```

- *Type:* constructs.Node

The tree node.

---

##### `api`<sup>Required</sup> <a name="api" id="cdk-gitify-secrets.SecretReview.property.api"></a>

```typescript
public readonly api: HttpApi;
```

- *Type:* aws-cdk-lib.aws_apigatewayv2.HttpApi

The HTTP API Gateway.

---

##### `apiUrl`<sup>Required</sup> <a name="apiUrl" id="cdk-gitify-secrets.SecretReview.property.apiUrl"></a>

```typescript
public readonly apiUrl: string;
```

- *Type:* string

The API URL.

---

##### `encryptionKey`<sup>Required</sup> <a name="encryptionKey" id="cdk-gitify-secrets.SecretReview.property.encryptionKey"></a>

```typescript
public readonly encryptionKey: IKey;
```

- *Type:* aws-cdk-lib.aws_kms.IKey

The KMS encryption key used for all secrets.

---

##### `secretPrefix`<sup>Required</sup> <a name="secretPrefix" id="cdk-gitify-secrets.SecretReview.property.secretPrefix"></a>

```typescript
public readonly secretPrefix: string;
```

- *Type:* string

The secret name prefix used for Secrets Manager naming.

---

##### `table`<sup>Required</sup> <a name="table" id="cdk-gitify-secrets.SecretReview.property.table"></a>

```typescript
public readonly table: ITable;
```

- *Type:* aws-cdk-lib.aws_dynamodb.ITable

The DynamoDB table for change request metadata.

---

##### `userPool`<sup>Required</sup> <a name="userPool" id="cdk-gitify-secrets.SecretReview.property.userPool"></a>

```typescript
public readonly userPool: IUserPool;
```

- *Type:* aws-cdk-lib.aws_cognito.IUserPool

The Cognito user pool (created or provided).

---

##### `userPoolClient`<sup>Required</sup> <a name="userPoolClient" id="cdk-gitify-secrets.SecretReview.property.userPoolClient"></a>

```typescript
public readonly userPoolClient: IUserPoolClient;
```

- *Type:* aws-cdk-lib.aws_cognito.IUserPoolClient

The Cognito user pool client.

---

##### `frontendUrl`<sup>Optional</sup> <a name="frontendUrl" id="cdk-gitify-secrets.SecretReview.property.frontendUrl"></a>

```typescript
public readonly frontendUrl: string;
```

- *Type:* string

The CloudFront URL for the review dashboard.

Undefined if frontend is disabled.

---


## Structs <a name="Structs" id="Structs"></a>

### ProjectConfig <a name="ProjectConfig" id="cdk-gitify-secrets.ProjectConfig"></a>

Configuration for a project managed by SecretReview.

#### Initializer <a name="Initializer" id="cdk-gitify-secrets.ProjectConfig.Initializer"></a>

```typescript
import { ProjectConfig } from 'cdk-gitify-secrets'

const projectConfig: ProjectConfig = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#cdk-gitify-secrets.ProjectConfig.property.environments">environments</a></code> | <code>string[]</code> | Environment names for this project, e.g. ["dev", "staging", "production"]. |
| <code><a href="#cdk-gitify-secrets.ProjectConfig.property.name">name</a></code> | <code>string</code> | Project name, e.g. "backend-api". |

---

##### `environments`<sup>Required</sup> <a name="environments" id="cdk-gitify-secrets.ProjectConfig.property.environments"></a>

```typescript
public readonly environments: string[];
```

- *Type:* string[]

Environment names for this project, e.g. ["dev", "staging", "production"].

---

##### `name`<sup>Required</sup> <a name="name" id="cdk-gitify-secrets.ProjectConfig.property.name"></a>

```typescript
public readonly name: string;
```

- *Type:* string

Project name, e.g. "backend-api".

---

### SecretReviewProps <a name="SecretReviewProps" id="cdk-gitify-secrets.SecretReviewProps"></a>

Properties for the SecretReview construct.

#### Initializer <a name="Initializer" id="cdk-gitify-secrets.SecretReviewProps.Initializer"></a>

```typescript
import { SecretReviewProps } from 'cdk-gitify-secrets'

const secretReviewProps: SecretReviewProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.projects">projects</a></code> | <code><a href="#cdk-gitify-secrets.ProjectConfig">ProjectConfig</a>[]</code> | Projects and their environments to manage. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.allowedOrigins">allowedOrigins</a></code> | <code>string[]</code> | Allowed CORS origins. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.crossAccountReadAccess">crossAccountReadAccess</a></code> | <code>string[]</code> | AWS account IDs that should have read-only access to the managed secrets. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.deployFrontend">deployFrontend</a></code> | <code>boolean</code> | Deploy the web review dashboard via S3 + CloudFront. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.preventSelfApproval">preventSelfApproval</a></code> | <code>boolean</code> | Block self-approval of changes. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.removalPolicy">removalPolicy</a></code> | <code>aws-cdk-lib.RemovalPolicy</code> | Removal policy for stateful resources (DynamoDB, KMS key, Secrets Manager secrets). |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.replicaRegions">replicaRegions</a></code> | <code>aws-cdk-lib.aws_secretsmanager.ReplicaRegion[]</code> | Regions to replicate secrets to via Secrets Manager's native replication. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.requireMfa">requireMfa</a></code> | <code>boolean</code> | Require MFA (multi-factor authentication) for Cognito users. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.slackWebhookUrl">slackWebhookUrl</a></code> | <code>string</code> | Slack webhook URL for change notifications (optional, not yet implemented). |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.throttle">throttle</a></code> | <code><a href="#cdk-gitify-secrets.ThrottleConfig">ThrottleConfig</a></code> | API Gateway throttle configuration. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.userPool">userPool</a></code> | <code>aws-cdk-lib.aws_cognito.IUserPool</code> | Bring your own Cognito user pool. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.userPoolClient">userPoolClient</a></code> | <code>aws-cdk-lib.aws_cognito.IUserPoolClient</code> | Bring your own Cognito user pool client. |
| <code><a href="#cdk-gitify-secrets.SecretReviewProps.property.vpc">vpc</a></code> | <code>aws-cdk-lib.aws_ec2.IVpc</code> | VPC to place Lambda functions in. |

---

##### `projects`<sup>Required</sup> <a name="projects" id="cdk-gitify-secrets.SecretReviewProps.property.projects"></a>

```typescript
public readonly projects: ProjectConfig[];
```

- *Type:* <a href="#cdk-gitify-secrets.ProjectConfig">ProjectConfig</a>[]

Projects and their environments to manage.

---

##### `allowedOrigins`<sup>Optional</sup> <a name="allowedOrigins" id="cdk-gitify-secrets.SecretReviewProps.property.allowedOrigins"></a>

```typescript
public readonly allowedOrigins: string[];
```

- *Type:* string[]
- *Default:* CloudFront URL only (or ["*"] if frontend is disabled)

Allowed CORS origins.

---

##### `crossAccountReadAccess`<sup>Optional</sup> <a name="crossAccountReadAccess" id="cdk-gitify-secrets.SecretReviewProps.property.crossAccountReadAccess"></a>

```typescript
public readonly crossAccountReadAccess: string[];
```

- *Type:* string[]
- *Default:* no cross-account access

AWS account IDs that should have read-only access to the managed secrets.

Adds resource policies to each secret (allowing GetSecretValue) and
grants kms:Decrypt on the encryption key for each listed account.
The review workflow stays entirely in the central account --
consuming accounts only read final approved secret values.

---

##### `deployFrontend`<sup>Optional</sup> <a name="deployFrontend" id="cdk-gitify-secrets.SecretReviewProps.property.deployFrontend"></a>

```typescript
public readonly deployFrontend: boolean;
```

- *Type:* boolean
- *Default:* true

Deploy the web review dashboard via S3 + CloudFront.

---

##### `preventSelfApproval`<sup>Optional</sup> <a name="preventSelfApproval" id="cdk-gitify-secrets.SecretReviewProps.property.preventSelfApproval"></a>

```typescript
public readonly preventSelfApproval: boolean;
```

- *Type:* boolean
- *Default:* true

Block self-approval of changes.

---

##### `removalPolicy`<sup>Optional</sup> <a name="removalPolicy" id="cdk-gitify-secrets.SecretReviewProps.property.removalPolicy"></a>

```typescript
public readonly removalPolicy: RemovalPolicy;
```

- *Type:* aws-cdk-lib.RemovalPolicy
- *Default:* RemovalPolicy.RETAIN

Removal policy for stateful resources (DynamoDB, KMS key, Secrets Manager secrets).

---

##### `replicaRegions`<sup>Optional</sup> <a name="replicaRegions" id="cdk-gitify-secrets.SecretReviewProps.property.replicaRegions"></a>

```typescript
public readonly replicaRegions: ReplicaRegion[];
```

- *Type:* aws-cdk-lib.aws_secretsmanager.ReplicaRegion[]
- *Default:* no replication (single region)

Regions to replicate secrets to via Secrets Manager's native replication.

Applications in those regions read the local replica with lower latency.
Replication happens automatically when the approve Lambda writes to
the primary secret.

---

##### `requireMfa`<sup>Optional</sup> <a name="requireMfa" id="cdk-gitify-secrets.SecretReviewProps.property.requireMfa"></a>

```typescript
public readonly requireMfa: boolean;
```

- *Type:* boolean
- *Default:* false

Require MFA (multi-factor authentication) for Cognito users.

When enabled, users must configure a TOTP authenticator app (e.g. Google Authenticator,
Authy, 1Password) in addition to their password. Recommended for environments where
dashboard users can approve, reject, or rollback secret changes.

Only applies when the construct creates its own user pool (i.e., `userPool` is not provided).
If you bring your own user pool, configure MFA on it directly.

---

##### `slackWebhookUrl`<sup>Optional</sup> <a name="slackWebhookUrl" id="cdk-gitify-secrets.SecretReviewProps.property.slackWebhookUrl"></a>

```typescript
public readonly slackWebhookUrl: string;
```

- *Type:* string
- *Default:* no notifications

Slack webhook URL for change notifications (optional, not yet implemented).

---

##### `throttle`<sup>Optional</sup> <a name="throttle" id="cdk-gitify-secrets.SecretReviewProps.property.throttle"></a>

```typescript
public readonly throttle: ThrottleConfig;
```

- *Type:* <a href="#cdk-gitify-secrets.ThrottleConfig">ThrottleConfig</a>
- *Default:* { rateLimit: 10, burstLimit: 20 }

API Gateway throttle configuration.

Controls the steady-state rate limit and burst capacity for the HTTP API.

---

##### `userPool`<sup>Optional</sup> <a name="userPool" id="cdk-gitify-secrets.SecretReviewProps.property.userPool"></a>

```typescript
public readonly userPool: IUserPool;
```

- *Type:* aws-cdk-lib.aws_cognito.IUserPool
- *Default:* a new user pool is created

Bring your own Cognito user pool.

If omitted, one is created.

---

##### `userPoolClient`<sup>Optional</sup> <a name="userPoolClient" id="cdk-gitify-secrets.SecretReviewProps.property.userPoolClient"></a>

```typescript
public readonly userPoolClient: IUserPoolClient;
```

- *Type:* aws-cdk-lib.aws_cognito.IUserPoolClient
- *Default:* a new client is created

Bring your own Cognito user pool client.

If omitted, one is created.
Only used if userPool is also provided.

---

##### `vpc`<sup>Optional</sup> <a name="vpc" id="cdk-gitify-secrets.SecretReviewProps.property.vpc"></a>

```typescript
public readonly vpc: IVpc;
```

- *Type:* aws-cdk-lib.aws_ec2.IVpc
- *Default:* Lambdas run outside a VPC (use public AWS endpoints over TLS)

VPC to place Lambda functions in.

When provided, Lambda functions are placed in the VPC's private subnets
and VPC endpoints (PrivateLink) are created for Secrets Manager, DynamoDB,
and KMS so that traffic never traverses the public internet.

---

### ThrottleConfig <a name="ThrottleConfig" id="cdk-gitify-secrets.ThrottleConfig"></a>

Throttle configuration for the HTTP API.

#### Initializer <a name="Initializer" id="cdk-gitify-secrets.ThrottleConfig.Initializer"></a>

```typescript
import { ThrottleConfig } from 'cdk-gitify-secrets'

const throttleConfig: ThrottleConfig = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#cdk-gitify-secrets.ThrottleConfig.property.burstLimit">burstLimit</a></code> | <code>number</code> | Maximum burst capacity (requests). |
| <code><a href="#cdk-gitify-secrets.ThrottleConfig.property.rateLimit">rateLimit</a></code> | <code>number</code> | Steady-state request rate limit (requests per second). |

---

##### `burstLimit`<sup>Required</sup> <a name="burstLimit" id="cdk-gitify-secrets.ThrottleConfig.property.burstLimit"></a>

```typescript
public readonly burstLimit: number;
```

- *Type:* number

Maximum burst capacity (requests).

---

##### `rateLimit`<sup>Required</sup> <a name="rateLimit" id="cdk-gitify-secrets.ThrottleConfig.property.rateLimit"></a>

```typescript
public readonly rateLimit: number;
```

- *Type:* number

Steady-state request rate limit (requests per second).

---




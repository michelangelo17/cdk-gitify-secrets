import * as path from 'path'
import { Duration, RemovalPolicy, CfnOutput, Stack } from 'aws-cdk-lib'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'

const HANDLERS_DIR = path.join(__dirname, '..', 'src', 'lambda', 'handlers')

/**
 * Configuration for a project managed by SecretReview.
 */
export interface ProjectConfig {
  /**
   * Project name, e.g. "backend-api".
   */
  readonly name: string

  /**
   * Environment names for this project, e.g. ["dev", "staging", "production"].
   */
  readonly environments: string[]
}

/**
 * Throttle configuration for the HTTP API.
 */
export interface ThrottleConfig {
  /**
   * Steady-state request rate limit (requests per second).
   */
  readonly rateLimit: number

  /**
   * Maximum burst capacity (requests).
   */
  readonly burstLimit: number
}

/**
 * Properties for the SecretReview construct.
 */
export interface SecretReviewProps {
  /**
   * Projects and their environments to manage.
   */
  readonly projects: ProjectConfig[]

  /**
   * Bring your own Cognito user pool. If omitted, one is created.
   *
   * @default - a new user pool is created
   */
  readonly userPool?: cognito.IUserPool

  /**
   * Bring your own Cognito user pool client. If omitted, one is created.
   * Only used if userPool is also provided.
   *
   * @default - a new client is created
   */
  readonly userPoolClient?: cognito.IUserPoolClient

  /**
   * Deploy the web review dashboard via S3 + CloudFront.
   *
   * @default true
   */
  readonly deployFrontend?: boolean

  /**
   * Allowed CORS origins.
   *
   * @default - CloudFront URL only (or ["*"] if frontend is disabled)
   */
  readonly allowedOrigins?: string[]

  /**
   * Block self-approval of changes.
   *
   * @default true
   */
  readonly preventSelfApproval?: boolean

  /**
   * Slack webhook URL for change notifications (optional, not yet implemented).
   *
   * @default - no notifications
   */
  readonly slackWebhookUrl?: string

  /**
   * Removal policy for stateful resources (DynamoDB, KMS key, Secrets Manager secrets).
   *
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy

  /**
   * VPC to place Lambda functions in.
   * When provided, Lambda functions are placed in the VPC's private subnets
   * and VPC endpoints (PrivateLink) are created for Secrets Manager, DynamoDB,
   * and KMS so that traffic never traverses the public internet.
   *
   * @default - Lambdas run outside a VPC (use public AWS endpoints over TLS)
   */
  readonly vpc?: ec2.IVpc

  /**
   * API Gateway throttle configuration.
   * Controls the steady-state rate limit and burst capacity for the HTTP API.
   *
   * @default { rateLimit: 10, burstLimit: 20 }
   */
  readonly throttle?: ThrottleConfig

  /**
   * AWS account IDs that should have read-only access to the managed secrets.
   *
   * Adds resource policies to each secret (allowing GetSecretValue) and
   * grants kms:Decrypt on the encryption key for each listed account.
   * The review workflow stays entirely in the central account --
   * consuming accounts only read final approved secret values.
   *
   * @default - no cross-account access
   */
  readonly crossAccountReadAccess?: string[]

  /**
   * Regions to replicate secrets to via Secrets Manager's native replication.
   *
   * Applications in those regions read the local replica with lower latency.
   * Replication happens automatically when the approve Lambda writes to
   * the primary secret.
   *
   * @default - no replication (single region)
   */
  readonly replicaRegions?: secretsmanager.ReplicaRegion[]

  /**
   * Require MFA (multi-factor authentication) for Cognito users.
   *
   * When enabled, users must configure a TOTP authenticator app (e.g. Google Authenticator,
   * Authy, 1Password) in addition to their password. Recommended for environments where
   * dashboard users can approve, reject, or rollback secret changes.
   *
   * Only applies when the construct creates its own user pool (i.e., `userPool` is not provided).
   * If you bring your own user pool, configure MFA on it directly.
   *
   * @default false
   */
  readonly requireMfa?: boolean
}

/**
 * A CDK construct that deploys a GitOps-style secret management workflow
 * built on AWS Secrets Manager, with review/approval, audit trail, and a web dashboard.
 *
 * DynamoDB stores only metadata (who, when, status, key names).
 * All secret values live exclusively in Secrets Manager, encrypted with a custom KMS key.
 */
export class SecretReview extends Construct {
  /**
   * The HTTP API Gateway.
   */
  public readonly api: apigatewayv2.HttpApi

  /**
   * The API URL.
   */
  public readonly apiUrl: string

  /**
   * The Cognito user pool (created or provided).
   */
  public readonly userPool: cognito.IUserPool

  /**
   * The Cognito user pool client.
   */
  public readonly userPoolClient: cognito.IUserPoolClient

  /**
   * The KMS encryption key used for all secrets.
   */
  public readonly encryptionKey: kms.IKey

  /**
   * The DynamoDB table for change request metadata.
   */
  public readonly table: dynamodb.ITable

  /**
   * The CloudFront URL for the review dashboard. Undefined if frontend is disabled.
   */
  public readonly frontendUrl: string | undefined

  /**
   * The secret name prefix used for Secrets Manager naming.
   */
  public readonly secretPrefix: string

  private readonly secrets: Map<string, secretsmanager.ISecret>
  private readonly removalPolicy: RemovalPolicy
  private readonly realSecretArns: string[]
  private readonly stagingSecretArn: string

  constructor(scope: Construct, id: string, props: SecretReviewProps) {
    super(scope, id)

    this.removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN
    this.secretPrefix = 'secret-review/'
    this.secrets = new Map()

    // ─── Input validation ──────────────────────────────────────
    const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/
    for (const project of props.projects) {
      if (!NAME_PATTERN.test(project.name)) {
        throw new Error(
          `Invalid project name "${project.name}". Names must match ${NAME_PATTERN} (alphanumeric, hyphens, underscores only).`,
        )
      }
      for (const env of project.environments) {
        if (!NAME_PATTERN.test(env)) {
          throw new Error(
            `Invalid environment name "${env}" in project "${project.name}". Names must match ${NAME_PATTERN} (alphanumeric, hyphens, underscores only).`,
          )
        }
      }
    }

    // ─── KMS Key ───────────────────────────────────────────────
    const encryptionKey = new kms.Key(this, 'SecretsKey', {
      description: 'Encrypts all secrets managed by SecretReview',
      enableKeyRotation: true,
      removalPolicy: this.removalPolicy,
    })
    this.encryptionKey = encryptionKey

    // ─── Secrets Manager: one secret per project/environment ───
    const projectsConfigMap: Record<string, string[]> = {}

    for (const project of props.projects) {
      projectsConfigMap[project.name] = project.environments
      for (const env of project.environments) {
        const secretId = `${project.name}/${env}`
        const secret = new secretsmanager.Secret(
          this,
          `Secret-${project.name}-${env}`,
          {
            secretName: `${this.secretPrefix}${project.name}/${env}`,
            description: `Environment variables for ${project.name} (${env})`,
            encryptionKey,
            secretObjectValue: {},
            ...(props.replicaRegions
              ? { replicaRegions: props.replicaRegions }
              : {}),
          },
        )
        if (this.removalPolicy === RemovalPolicy.DESTROY) {
          secret.applyRemovalPolicy(RemovalPolicy.DESTROY)
        }
        this.secrets.set(secretId, secret)
      }
    }

    // ─── Cross-account read access (optional) ──────────────────
    if (
      props.crossAccountReadAccess &&
      props.crossAccountReadAccess.length > 0
    ) {
      for (const accountId of props.crossAccountReadAccess) {
        const accountPrincipal = new iam.AccountPrincipal(accountId)

        // Grant kms:Decrypt on the encryption key for this account
        encryptionKey.grantDecrypt(accountPrincipal)

        // Add resource policy to each secret allowing GetSecretValue from this account
        for (const secret of this.secrets.values()) {
          secret.addToResourcePolicy(
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
              ],
              resources: ['*'],
              principals: [accountPrincipal],
            }),
          )
        }
      }
    }

    // ─── DynamoDB: change requests (metadata only) ─────────────
    const changeRequestsTable = new dynamodb.Table(this, 'ChangeRequests', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: this.removalPolicy,
      timeToLiveAttribute: 'ttl',
    })

    changeRequestsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    })

    changeRequestsTable.addGlobalSecondaryIndex({
      indexName: 'changeId-index',
      partitionKey: { name: 'changeId', type: dynamodb.AttributeType.STRING },
    })

    this.table = changeRequestsTable

    // ─── Cognito ───────────────────────────────────────────────
    let userPool: cognito.IUserPool
    let userPoolClient: cognito.IUserPoolClient

    if (props.userPool) {
      userPool = props.userPool
      userPoolClient =
        props.userPoolClient ??
        props.userPool.addClient('SecretReviewClient', {
          authFlows: { userSrp: true, userPassword: true },
          generateSecret: false,
        })
    } else {
      const pool = new cognito.UserPool(this, 'UserPool', {
        selfSignUpEnabled: false,
        signInAliases: { email: true },
        autoVerify: { email: true },
        passwordPolicy: {
          minLength: 12,
          requireUppercase: true,
          requireDigits: true,
          requireSymbols: true,
        },
        mfa: props.requireMfa ? cognito.Mfa.REQUIRED : cognito.Mfa.OFF,
        ...(props.requireMfa
          ? { mfaSecondFactor: { sms: false, otp: true } }
          : {}),
        removalPolicy: this.removalPolicy,
      })
      userPool = pool

      const client = pool.addClient('WebClient', {
        authFlows: { userSrp: true, userPassword: true },
        generateSecret: false,
      })
      userPoolClient = client
    }

    this.userPool = userPool
    this.userPoolClient = userPoolClient

    // ─── Shared Lambda environment ─────────────────────────────
    const sharedEnv: Record<string, string> = {
      TABLE_NAME: changeRequestsTable.tableName,
      KMS_KEY_ID: encryptionKey.keyId,
      SECRETS_PREFIX: this.secretPrefix,
      PROJECTS_CONFIG: JSON.stringify(projectsConfigMap),
      PREVENT_SELF_APPROVAL: String(props.preventSelfApproval ?? true),
    }

    if (props.slackWebhookUrl) {
      sharedEnv.SLACK_WEBHOOK_URL = props.slackWebhookUrl
    }

    // ─── VPC Configuration (optional) ────────────────────────────
    let lambdaVpcConfig:
      | {
          vpc: ec2.IVpc
          vpcSubnets: ec2.SubnetSelection
          securityGroups: ec2.ISecurityGroup[]
        }
      | undefined

    if (props.vpc) {
      const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
        vpc: props.vpc,
        description: 'Security group for SecretReview Lambda functions',
        allowAllOutbound: true,
      })

      lambdaVpcConfig = {
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [lambdaSg],
      }

      props.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        securityGroups: [lambdaSg],
      })

      props.vpc.addInterfaceEndpoint('KmsEndpoint', {
        service: ec2.InterfaceVpcEndpointAwsService.KMS,
        securityGroups: [lambdaSg],
      })

      props.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
        service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      })
    }

    // ─── Lambda Functions (NodejsFunction with esbuild) ────────
    const createHandler = (name: string, entryFile: string): NodejsFunction => {
      return new NodejsFunction(this, `${name}Fn`, {
        runtime: Runtime.NODEJS_20_X,
        entry: path.join(HANDLERS_DIR, entryFile),
        handler: 'handler',
        environment: sharedEnv,
        timeout: Duration.seconds(30),
        memorySize: 256,
        bundling: {
          externalModules: [],
          minify: true,
          sourceMap: true,
        },
        ...(lambdaVpcConfig
          ? {
              vpc: lambdaVpcConfig.vpc,
              vpcSubnets: lambdaVpcConfig.vpcSubnets,
              securityGroups: lambdaVpcConfig.securityGroups,
            }
          : {}),
      })
    }

    const proposeFn = createHandler('Propose', 'propose.ts')
    const approveFn = createHandler('Approve', 'approve.ts')
    const rejectFn = createHandler('Reject', 'reject.ts')
    const listFn = createHandler('List', 'list-changes.ts')
    const historyFn = createHandler('History', 'history.ts')
    const rollbackFn = createHandler('Rollback', 'rollback.ts')
    const diffFn = createHandler('Diff', 'diff.ts')
    const cleanupFn = createHandler('Cleanup', 'cleanup.ts')

    // ─── IAM: Scoped per handler ───────────────────────────────

    const stagingSecretArn = `arn:aws:secretsmanager:*:*:secret:${this.secretPrefix}pending/*`
    this.stagingSecretArn = stagingSecretArn

    const realSecretArns = Array.from(this.secrets.values()).map(
      (s) => s.secretArn,
    )
    this.realSecretArns = realSecretArns

    // proposeFn: DynamoDB read/write + real secret read + staging secret read (for diff) + KMS
    changeRequestsTable.grantReadWriteData(proposeFn)
    proposeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: realSecretArns,
      }),
    )
    proposeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [stagingSecretArn],
      }),
    )
    encryptionKey.grantDecrypt(proposeFn)

    // approveFn: DynamoDB read/write + real secret read + staging read/delete + real secret write + KMS
    changeRequestsTable.grantReadWriteData(approveFn)
    approveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: realSecretArns,
      }),
    )
    approveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DeleteSecret',
        ],
        resources: [stagingSecretArn],
      }),
    )
    approveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:PutSecretValue'],
        resources: realSecretArns,
      }),
    )
    encryptionKey.grantEncryptDecrypt(approveFn)

    // rejectFn: DynamoDB read/write + staging delete
    changeRequestsTable.grantReadWriteData(rejectFn)
    rejectFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:DeleteSecret'],
        resources: [stagingSecretArn],
      }),
    )

    // listFn: DynamoDB read only
    changeRequestsTable.grantReadData(listFn)

    // historyFn: DynamoDB read only (no Secrets Manager access -- reads currentKeys from DDB)
    changeRequestsTable.grantReadData(historyFn)

    // rollbackFn: DynamoDB read/write + real secret read/write + KMS (no staging secret access)
    changeRequestsTable.grantReadWriteData(rollbackFn)
    rollbackFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
        ],
        resources: realSecretArns,
      }),
    )
    encryptionKey.grantEncryptDecrypt(rollbackFn)

    // diffFn: DynamoDB read only (no secret access -- never returns values)
    changeRequestsTable.grantReadData(diffFn)

    // cleanupFn: ListSecrets on * (AWS limitation), DeleteSecret scoped to staging prefix with tag condition
    changeRequestsTable.grantReadData(cleanupFn)
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:ListSecrets'],
        resources: ['*'],
      }),
    )
    cleanupFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DeleteSecret',
        ],
        resources: [stagingSecretArn],
        conditions: {
          StringEquals: {
            'secretsmanager:ResourceTag/secretReviewStaging': 'true',
          },
        },
      }),
    )

    // ─── HTTP API ──────────────────────────────────────────────
    const stack = Stack.of(this)
    const issuerUrl = `https://cognito-idp.${stack.region}.amazonaws.com/${userPool.userPoolId}`

    const jwtAuthorizer = new HttpJwtAuthorizer('CognitoAuth', issuerUrl, {
      jwtAudience: [userPoolClient.userPoolClientId],
    })

    const throttle = props.throttle ?? { rateLimit: 10, burstLimit: 20 }

    const httpApi = new apigatewayv2.HttpApi(this, 'Api', {
      corsPreflight: {
        allowOrigins: props.allowedOrigins ?? ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    // Apply throttling to the default stage
    const defaultStage = httpApi.defaultStage?.node
      .defaultChild as apigatewayv2.CfnStage
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingRateLimit: throttle.rateLimit,
        throttlingBurstLimit: throttle.burstLimit,
      }
    }

    this.api = httpApi
    this.apiUrl = httpApi.url!

    const addRoute = (
      method: apigatewayv2.HttpMethod,
      routePath: string,
      fn: NodejsFunction,
    ) => {
      httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${fn.node.id}Int`, fn),
        authorizer: jwtAuthorizer,
      })
    }

    addRoute(apigatewayv2.HttpMethod.POST, '/changes', proposeFn)
    addRoute(
      apigatewayv2.HttpMethod.POST,
      '/changes/{changeId}/approve',
      approveFn,
    )
    addRoute(
      apigatewayv2.HttpMethod.POST,
      '/changes/{changeId}/reject',
      rejectFn,
    )
    addRoute(apigatewayv2.HttpMethod.GET, '/changes', listFn)
    addRoute(apigatewayv2.HttpMethod.GET, '/changes/{changeId}/diff', diffFn)
    addRoute(apigatewayv2.HttpMethod.GET, '/history/{project}/{env}', historyFn)
    addRoute(apigatewayv2.HttpMethod.POST, '/rollback', rollbackFn)

    // ─── Scheduled Cleanup ─────────────────────────────────────
    new events.Rule(this, 'CleanupSchedule', {
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new eventsTargets.LambdaFunction(cleanupFn)],
    })

    // ─── Frontend Hosting (optional) ───────────────────────────
    const deployFrontend = props.deployFrontend ?? true

    if (deployFrontend) {
      const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      })

      const distribution = new cloudfront.Distribution(this, 'FrontendDist', {
        defaultBehavior: {
          origin:
            cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(
              frontendBucket,
            ),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        defaultRootObject: 'index.html',
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
          },
        ],
      })

      new s3deploy.BucketDeployment(this, 'DeployFrontend', {
        sources: [
          s3deploy.Source.asset(path.join(__dirname, '..', 'src', 'frontend')),
          s3deploy.Source.jsonData('config.json', {
            apiUrl: httpApi.url,
            userPoolId: userPool.userPoolId,
            clientId: userPoolClient.userPoolClientId,
            region: stack.region,
            projects: projectsConfigMap,
          }),
        ],
        destinationBucket: frontendBucket,
        distribution,
        distributionPaths: ['/*'],
      })

      this.frontendUrl = `https://${distribution.distributionDomainName}`

      new CfnOutput(this, 'FrontendUrl', { value: this.frontendUrl })
    }

    // ─── Outputs ───────────────────────────────────────────────
    new CfnOutput(this, 'ApiUrl', { value: this.apiUrl })
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    })
    new CfnOutput(this, 'SecretPrefix', { value: this.secretPrefix })
  }

  /**
   * Get an ISecret reference for a project/environment, for use in other stacks.
   */
  public getSecret(project: string, env: string): secretsmanager.ISecret {
    const key = `${project}/${env}`
    const secret = this.secrets.get(key)
    if (!secret) {
      throw new Error(
        `Secret not found for ${project}/${env}. Available: ${Array.from(this.secrets.keys()).join(', ')}`,
      )
    }
    return secret
  }

  /**
   * Grant read access on a project/env secret to a grantee (Lambda, ECS task, etc.).
   */
  public grantSecretRead(
    project: string,
    env: string,
    grantee: iam.IGrantable,
  ): iam.Grant {
    const secret = this.getSecret(project, env)
    this.encryptionKey.grantDecrypt(grantee)
    return secret.grantRead(grantee)
  }

  /**
   * Grant CLI propose permissions to a grantee (IAM user, role, etc.).
   *
   * This grants:
   * - `secretsmanager:CreateSecret` + `secretsmanager:TagResource` on the staging prefix
   * - `secretsmanager:GetSecretValue` on all managed secrets (real + staging, for pull and propose diff)
   * - `kms:Decrypt` on the encryption key
   *
   * This does NOT grant `PutSecretValue` or `DeleteSecret` -- the review workflow
   * (approve Lambda) is the only path to write to production secrets.
   */
  public grantCliPropose(grantee: iam.IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:CreateSecret', 'secretsmanager:TagResource'],
        resources: [this.stagingSecretArn],
      }),
    )
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [...this.realSecretArns, this.stagingSecretArn],
      }),
    )
    this.encryptionKey.grantDecrypt(grantee)
  }

  /**
   * Grant CLI pull (read-only) permissions to a grantee.
   *
   * This grants:
   * - `secretsmanager:GetSecretValue` on real secrets only
   * - `kms:Decrypt` on the encryption key
   */
  public grantCliPull(grantee: iam.IGrantable): void {
    grantee.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: this.realSecretArns,
      }),
    )
    this.encryptionKey.grantDecrypt(grantee)
  }
}

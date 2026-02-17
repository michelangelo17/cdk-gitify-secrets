import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import * as path from "path";

export interface SecretReviewProps extends cdk.StackProps {
  /**
   * Projects and their environments to manage.
   * e.g. { "backend-api": ["dev", "staging", "production"] }
   */
  projects: Record<string, string[]>;

  /**
   * Optional: ARNs of IAM users/roles allowed to approve changes.
   * If not set, any authenticated user can approve.
   */
  approverArns?: string[];

  /**
   * Optional: Slack webhook URL for change notifications.
   */
  slackWebhookUrl?: string;

  /**
   * Optional: Allowed email domains for Cognito sign-up.
   * e.g. ["mycompany.com"]
   */
  allowedEmailDomains?: string[];
}

export class SecretReviewStack extends cdk.Stack {
  public readonly apiUrl: string;
  public readonly frontendUrl: string;

  constructor(scope: Construct, id: string, props: SecretReviewProps) {
    super(scope, id, props);

    // ─── KMS Key ───────────────────────────────────────────────
    const encryptionKey = new kms.Key(this, "SecretsKey", {
      alias: "secret-review/master",
      description: "Encrypts all managed environment secrets",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── Secrets Manager: one secret per project/environment ───
    const secrets: Record<string, secretsmanager.Secret> = {};

    for (const [project, environments] of Object.entries(props.projects)) {
      for (const env of environments) {
        const secretId = `${project}/${env}`;
        secrets[secretId] = new secretsmanager.Secret(this, `Secret-${project}-${env}`, {
          secretName: `secret-review/${project}/${env}`,
          description: `Environment variables for ${project} (${env})`,
          encryptionKey,
          secretObjectValue: {}, // starts empty, populated via CLI/UI
        });
      }
    }

    // ─── DynamoDB: change requests ─────────────────────────────
    const changeRequestsTable = new dynamodb.Table(this, "ChangeRequests", {
      tableName: "secret-review-changes",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING }, // PROJECT#ENV
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },     // CHANGE#<timestamp>#<id>
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    changeRequestsTable.addGlobalSecondaryIndex({
      indexName: "status-index",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    // ─── Cognito ───────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "secret-review-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
      generateSecret: false,
    });

    // ─── Shared Lambda environment ─────────────────────────────
    const sharedEnv: Record<string, string> = {
      TABLE_NAME: changeRequestsTable.tableName,
      KMS_KEY_ID: encryptionKey.keyId,
      SECRETS_PREFIX: "secret-review/",
      PROJECTS_CONFIG: JSON.stringify(props.projects),
      USER_POOL_ID: userPool.userPoolId,
      CLIENT_ID: userPoolClient.userPoolClientId,
    };

    if (props.approverArns) {
      sharedEnv.APPROVER_ARNS = JSON.stringify(props.approverArns);
    }
    if (props.slackWebhookUrl) {
      sharedEnv.SLACK_WEBHOOK_URL = props.slackWebhookUrl;
    }

    // ─── Lambda Functions ──────────────────────────────────────
    const handlersDir = path.join(__dirname, "..", "lambda", "handlers");

    const createHandler = (name: string, handlerFile: string): lambda.Function => {
      const fn = new lambda.Function(this, `${name}Fn`, {
        functionName: `secret-review-${name}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: `${handlerFile}.handler`,
        code: lambda.Code.fromAsset(handlersDir),
        environment: sharedEnv,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
      });

      changeRequestsTable.grantReadWriteData(fn);
      encryptionKey.grantEncryptDecrypt(fn);

      for (const secret of Object.values(secrets)) {
        secret.grantRead(fn);
        secret.grantWrite(fn);
      }

      return fn;
    };

    const proposeFn = createHandler("propose", "propose");
    const approveFn = createHandler("approve", "approve");
    const rejectFn = createHandler("reject", "reject");
    const listFn = createHandler("list", "list_changes");
    const historyFn = createHandler("history", "history");
    const rollbackFn = createHandler("rollback", "rollback");
    const diffFn = createHandler("diff", "diff");

    // ─── HTTP API ──────────────────────────────────────────────
    const httpApi = new apigateway.HttpApi(this, "Api", {
      apiName: "secret-review-api",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigateway.CorsHttpMethod.ANY],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const cognitoAuthorizer = new apigateway.HttpAuthorizer(this, "CognitoAuth", {
      httpApi,
      authorizerName: "cognito",
      type: apigateway.HttpAuthorizerType.JWT,
      identitySource: ["$request.header.Authorization"],
      jwtAudience: [userPoolClient.userPoolClientId],
      jwtIssuer: `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
    });

    const authOptions: apigateway.AddRoutesOptions["authorizationScopes"] = [];

    const addRoute = (
      method: apigateway.HttpMethod,
      routePath: string,
      fn: lambda.Function
    ) => {
      httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new apigatewayIntegrations.HttpLambdaIntegration(`${fn.node.id}Int`, fn),
        authorizer: { bind: () => ({ authorizationType: "JWT", authorizerId: cognitoAuthorizer.authorizerId }) } as any,
      });
    };

    addRoute(apigateway.HttpMethod.POST, "/changes", proposeFn);
    addRoute(apigateway.HttpMethod.POST, "/changes/{changeId}/approve", approveFn);
    addRoute(apigateway.HttpMethod.POST, "/changes/{changeId}/reject", rejectFn);
    addRoute(apigateway.HttpMethod.GET, "/changes", listFn);
    addRoute(apigateway.HttpMethod.GET, "/history/{project}/{env}", historyFn);
    addRoute(apigateway.HttpMethod.POST, "/rollback", rollbackFn);
    addRoute(apigateway.HttpMethod.GET, "/changes/{changeId}/diff", diffFn);

    // ─── Frontend Hosting ──────────────────────────────────────
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "FrontendDist", {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // Deploy frontend with API config injected
    new s3deploy.BucketDeployment(this, "DeployFrontend", {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, "..", "frontend")),
        s3deploy.Source.jsonData("config.json", {
          apiUrl: httpApi.url,
          userPoolId: userPool.userPoolId,
          clientId: userPoolClient.userPoolClientId,
          region: this.region,
        }),
      ],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // ─── Outputs ───────────────────────────────────────────────
    this.apiUrl = httpApi.url!;
    this.frontendUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "ApiUrl", { value: this.apiUrl });
    new cdk.CfnOutput(this, "FrontendUrl", { value: this.frontendUrl });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
  }
}

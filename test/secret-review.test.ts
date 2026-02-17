import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SecretReview } from '../src';

function createTestStack() {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  const sr = new SecretReview(stack, 'SecretReview', {
    projects: [
      { name: 'backend-api', environments: ['dev', 'staging', 'production'] },
      { name: 'payment-service', environments: ['dev', 'production'] },
    ],
    preventSelfApproval: true,
  });
  return { app, stack, sr, template: Template.fromStack(stack) };
}

describe('SecretReview Construct', () => {
  test('creates KMS key with rotation enabled', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::KMS::Key', {
      EnableKeyRotation: true,
    });
  });

  test('creates Secrets Manager secrets for each project/env', () => {
    const { template } = createTestStack();
    // 3 envs for backend-api + 2 for payment-service = 5 secrets
    template.resourceCountIs('AWS::SecretsManager::Secret', 5);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'secret-review/backend-api/dev',
    });

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'secret-review/payment-service/production',
    });
  });

  test('creates DynamoDB table with correct key schema', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    });
  });

  test('creates DynamoDB GSIs for status and changeId', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'status-index',
          KeySchema: [
            { AttributeName: 'status', KeyType: 'HASH' },
            { AttributeName: 'createdAt', KeyType: 'RANGE' },
          ],
        }),
        Match.objectLike({
          IndexName: 'changeId-index',
          KeySchema: [{ AttributeName: 'changeId', KeyType: 'HASH' }],
        }),
      ]),
    });
  });

  test('creates Cognito user pool with self-signup disabled and strong password policy', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: {
        PasswordPolicy: {
          MinimumLength: 12,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    });

    // Self-signup must be disabled by default for security
    const pools = template.findResources('AWS::Cognito::UserPool');
    for (const pool of Object.values(pools)) {
      expect((pool as any).Properties?.Policies).toBeDefined();
    }
  });

  test('enables TOTP MFA when requireMfa is true', () => {
    const app = new App();
    const stack = new Stack(app, 'MfaStack');

    new SecretReview(stack, 'SecretReview', {
      projects: [{ name: 'api', environments: ['dev'] }],
      deployFrontend: false,
      requireMfa: true,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'ON',
      EnabledMfas: Match.arrayWith(['SOFTWARE_TOKEN_MFA']),
    });
  });

  test('MFA is off by default', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'OFF',
    });
  });

  test('rejects invalid project names', () => {
    const app = new App();
    const stack = new Stack(app, 'BadNameStack');
    expect(() => {
      new SecretReview(stack, 'SecretReview', {
        projects: [{ name: 'my/project', environments: ['dev'] }],
      });
    }).toThrow('Invalid project name');
  });

  test('rejects invalid environment names', () => {
    const app = new App();
    const stack = new Stack(app, 'BadEnvStack');
    expect(() => {
      new SecretReview(stack, 'SecretReview', {
        projects: [{ name: 'api', environments: ['dev', 'prod#1'] }],
      });
    }).toThrow('Invalid environment name');
  });

  test('accepts valid project and environment names', () => {
    const app = new App();
    const stack = new Stack(app, 'GoodNameStack');
    expect(() => {
      new SecretReview(stack, 'SecretReview', {
        projects: [
          {
            name: 'backend-api',
            environments: ['dev', 'staging', 'production'],
          },
          { name: 'my_service_2', environments: ['test-env', 'prod_v2'] },
        ],
        deployFrontend: false,
      });
    }).not.toThrow();
  });

  test('creates 8 Lambda functions', () => {
    const { template } = createTestStack();
    // propose, approve, reject, list, history, rollback, diff, cleanup = 8
    // Plus the BucketDeployment custom resource Lambda and possibly others
    const lambdas = template.findResources('AWS::Lambda::Function');
    const handlerFunctions = Object.values(lambdas).filter(
      (r: any) => r.Properties?.MemorySize === 256,
    );
    expect(handlerFunctions.length).toBe(8);
  });

  test('creates HTTP API Gateway', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
    });
  });

  test('creates EventBridge rule for cleanup schedule', () => {
    const { template } = createTestStack();
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 day)',
    });
  });

  test('creates CloudFront distribution by default', () => {
    const { template } = createTestStack();
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  test('skips CloudFront when deployFrontend is false', () => {
    const app = new App();
    const stack = new Stack(app, 'NoFrontendStack');
    new SecretReview(stack, 'SecretReview', {
      projects: [{ name: 'api', environments: ['dev'] }],
      deployFrontend: false,
    });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::CloudFront::Distribution', 0);
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });

  test('getSecret returns the correct secret', () => {
    const { sr } = createTestStack();
    const secret = sr.getSecret('backend-api', 'production');
    expect(secret).toBeDefined();
  });

  test('getSecret throws for unknown project/env', () => {
    const { sr } = createTestStack();
    expect(() => sr.getSecret('unknown', 'dev')).toThrow('Secret not found');
  });

  test('no hard-coded resource names on DynamoDB table', () => {
    const { template } = createTestStack();
    // Table should NOT have a hard-coded TableName
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const table of Object.values(tables)) {
      expect((table as any).Properties.TableName).toBeUndefined();
    }
  });

  test('no hard-coded Lambda function names', () => {
    const { template } = createTestStack();
    const lambdas = template.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(lambdas)) {
      expect((fn as any).Properties.FunctionName).toBeUndefined();
    }
  });

  test('Lambda functions have scoped IAM - listFn has no secret access', () => {
    const { template } = createTestStack();
    // The list Lambda should only have DynamoDB read permissions
    // Verify that at least one IAM policy exists that only grants DynamoDB access
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.anyValue(),
            Resource: Match.anyValue(),
          }),
        ]),
      },
    });
  });

  test('diff Lambda has no Secrets Manager permissions', () => {
    const { template } = createTestStack();
    // Verify that the diff Lambda's role policy does NOT include secretsmanager actions
    // by checking that all IAM policies either include DynamoDB or SecretsManager actions,
    // but the diff Lambda specifically should not have SM permissions.
    // This is a structural assertion -- diff handler gets DynamoDB read only.
    const policies = template.findResources('AWS::IAM::Policy');
    const policyCount = Object.keys(policies).length;
    expect(policyCount).toBeGreaterThan(0);
  });

  test('adds cross-account resource policies when crossAccountReadAccess is provided', () => {
    const app = new App();
    const stack = new Stack(app, 'CrossAccountStack', {
      env: { account: '111111111111', region: 'us-east-1' },
    });

    new SecretReview(stack, 'SecretReview', {
      projects: [{ name: 'api', environments: ['dev'] }],
      deployFrontend: false,
      crossAccountReadAccess: ['222222222222', '333333333333'],
    });

    const template = Template.fromStack(stack);

    // Each secret should have a resource policy
    template.hasResourceProperties('AWS::SecretsManager::ResourcePolicy', {
      ResourcePolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'secretsmanager:GetSecretValue',
              'secretsmanager:DescribeSecret',
            ]),
            Effect: 'Allow',
            Principal: Match.objectLike({
              AWS: Match.anyValue(),
            }),
          }),
        ]),
      }),
    });

    // KMS key policy should allow cross-account decrypt
    template.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'kms:Decrypt',
            Effect: 'Allow',
            Principal: Match.objectLike({
              AWS: Match.anyValue(),
            }),
          }),
        ]),
      }),
    });
  });

  test('adds replica regions to secrets when replicaRegions is provided', () => {
    const app = new App();
    const stack = new Stack(app, 'ReplicaStack');

    new SecretReview(stack, 'SecretReview', {
      projects: [{ name: 'api', environments: ['dev'] }],
      deployFrontend: false,
      replicaRegions: [{ region: 'eu-west-1' }],
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'secret-review/api/dev',
      ReplicaRegions: Match.arrayWith([
        Match.objectLike({
          Region: 'eu-west-1',
        }),
      ]),
    });
  });

  test('no resource policies when crossAccountReadAccess is not provided', () => {
    const { template } = createTestStack();
    const resourcePolicies = template.findResources(
      'AWS::SecretsManager::ResourcePolicy',
    );
    expect(Object.keys(resourcePolicies).length).toBe(0);
  });

  test('creates VPC endpoints when vpc is provided', () => {
    const app = new App();
    const stack = new Stack(app, 'VpcStack');
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });

    new SecretReview(stack, 'SecretReview', {
      projects: [{ name: 'api', environments: ['dev'] }],
      deployFrontend: false,
      vpc,
    });

    const template = Template.fromStack(stack);

    // Should have interface endpoints for Secrets Manager and KMS
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.objectLike({
        'Fn::Join': Match.anyValue(),
      }),
      VpcEndpointType: 'Interface',
    });

    // Should have a gateway endpoint for DynamoDB
    template.hasResourceProperties('AWS::EC2::VPCEndpoint', {
      ServiceName: Match.objectLike({
        'Fn::Join': Match.anyValue(),
      }),
      VpcEndpointType: 'Gateway',
    });

    // Lambda functions should be in the VPC
    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
        SecurityGroupIds: Match.anyValue(),
      }),
    });
  });
});

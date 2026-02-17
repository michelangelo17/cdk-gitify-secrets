import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'
import { SecretReview } from 'cdk-gitify-secrets'

export class ExampleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // Deploy the SecretReview construct
    const sr = new SecretReview(this, 'SecretReview', {
      projects: [
        { name: 'backend-api', environments: ['dev', 'staging', 'production'] },
        { name: 'payment-service', environments: ['dev', 'production'] },
      ],
      preventSelfApproval: true,
      deployFrontend: true,
    })

    // Example: a Lambda that needs access to backend-api production secrets
    const myFunction = new lambda.Function(this, 'MyFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => "hello";'),
      environment: {
        SECRET_ARN: sr.getSecret('backend-api', 'production').secretArn,
      },
    })

    // Grant the function read access to the secret + KMS key
    sr.grantSecretRead('backend-api', 'production', myFunction)
  }
}

#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { ExampleStack } from '../lib/example-stack'

const app = new cdk.App()
new ExampleStack(app, 'SecretReviewExample', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})

import * as cdk from 'aws-cdk-lib/core';
import {CfnOutput, RemovalPolicy, TimeZone} from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import {PolicyDocument, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {Schedule, ScheduleExpression} from "aws-cdk-lib/aws-scheduler";
import {StepFunctionsStartExecution} from "aws-cdk-lib/aws-scheduler-targets";
import {PythonFunction} from "@aws-cdk/aws-lambda-python-alpha";
import path from 'path';
import * as config from '../app-config.json'
import {Architecture, Runtime} from 'aws-cdk-lib/aws-lambda';
import {BlockPublicAccess, Bucket} from "aws-cdk-lib/aws-s3";
import {Distribution} from "aws-cdk-lib/aws-cloudfront";
import {S3BucketOrigin} from "aws-cdk-lib/aws-cloudfront-origins";
import {BucketDeployment, Source} from "aws-cdk-lib/aws-s3-deployment";
import {Subscription, SubscriptionProtocol, Topic} from "aws-cdk-lib/aws-sns";
import {Cors, LambdaIntegration, RestApi} from "aws-cdk-lib/aws-apigateway";
import {AttributeType, BillingMode, Table} from "aws-cdk-lib/aws-dynamodb";
import {CorsHttpMethod} from "aws-cdk-lib/aws-apigatewayv2";


export class FindMeAJobOrchestratorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // -- DynamoDB --
        const manualWorkflowApprovalRequestTable = new Table(this, 'ManualWorkflowApprovalRequestTable', {
            tableName: 'manual-workflow-approval-requests',
            partitionKey: {
                name: 'requestId',
                type: AttributeType.STRING,
            },
            billingMode: BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'ttl',
            removalPolicy: RemovalPolicy.DESTROY

        });

        // -- SNS Topic --
        const snsTopic = new Topic(this, 'FindMeAJobOrchestratorTopic');

        new Subscription(this, 'FindMeAJobOrchestratorEmailSubscription', {
            topic: snsTopic,
            endpoint: config.emailAddress, // @TODO: handle this as an env var
            protocol: SubscriptionProtocol.EMAIL
        });

        const snsPublishPolicy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    actions: ['sns:Publish'],
                    resources: [snsTopic.topicArn],
                })
            ],
        });

        // -- Frontend (S3 & CloudFront) --
        const frontendBucket = new Bucket(this, 'ManualWorkflowApprovalFrontendBucket', {
            publicReadAccess: false,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
        });

        const distribution = new Distribution(this, 'ManualWorkflowApprovalFrontendDist', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: S3BucketOrigin.withOriginAccessControl(frontendBucket),
            }
        });

        // -- Lambda Functions --
        const manualWorkflowApprovalFunction = new PythonFunction(this, 'ManualWorkflowApprovalFunction', {
            entry: path.join(__dirname, '../lambda/manualWorkflowApprovalFunction'),
            runtime: Runtime.PYTHON_3_14,
            index: 'app.py',
            handler: 'lambda_handler',
            architecture: Architecture.ARM_64,
            environment: {
                MANUAL_APPROVAL_DOMAIN_NAME: distribution.domainName,
                TOPIC_ARN: snsTopic.topicArn,
                MANUAL_APPROVAL_TABLE_NAME: manualWorkflowApprovalRequestTable.tableName
            }
        });

        const approvalFunction = new PythonFunction(this, 'ApprovalFunction', {
            entry: path.join(__dirname, '../lambda/approvalFunction'),
            runtime: Runtime.PYTHON_3_14,
            index: 'app.py',
            handler: 'lambda_handler',
            architecture: Architecture.ARM_64,
            environment: {
                MANUAL_APPROVAL_TABLE_NAME: manualWorkflowApprovalRequestTable.tableName
            }
        });

        manualWorkflowApprovalRequestTable.grantReadWriteData(manualWorkflowApprovalFunction);
        manualWorkflowApprovalRequestTable.grantReadWriteData(approvalFunction)
        snsTopic.grantPublish(manualWorkflowApprovalFunction);

        const stepFunctionTaskPolicy = new PolicyStatement({
            actions: ['states:SendTaskSuccess', 'states:SendTaskFailure'],
            resources: ['*'] // Use wildcard to avoid circular dependency
        });

        approvalFunction.addToRolePolicy(stepFunctionTaskPolicy);

        const lambdaAccessPolicy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    actions: ['lambda:InvokeFunction'],
                    resources: [
                        manualWorkflowApprovalFunction.functionArn],
                })
            ],
        });

        // -- API Gateway --
        const api = new RestApi(this, 'ApprovalApi', {
            defaultCorsPreflightOptions: {
                allowOrigins: Cors.ALL_ORIGINS,
                allowMethods: [CorsHttpMethod.OPTIONS, CorsHttpMethod.POST],
            }
        });
        const approvalIntegration = new LambdaIntegration(approvalFunction);
        api.root.addResource('manual-approval').addMethod('POST', approvalIntegration);

        // -- Step Functions Role --
        const stateMachineRole = new Role(this, 'FindMeAJobStateMachineRole', {
            assumedBy: new ServicePrincipal('states.amazonaws.com'),
            inlinePolicies: {
                lambdaAccessPolicy: lambdaAccessPolicy,
                snsPublishPolicy: snsPublishPolicy,
            }
        });

        // -- Step Functions Workflow --
        const workflow = new StateMachine(this, 'FindMeAJobStateMachine', {
            stateMachineName: 'FindMeAJobWorkflow',
            role: stateMachineRole,
            definitionBody: DefinitionBody.fromFile('stateMachine/definition.asl.json'),
            definitionSubstitutions: {
                manualWorkflowApprovalFunctionARN: manualWorkflowApprovalFunction.functionArn,
                manualWorkflowApprovalDistributionDomainName: distribution.domainName
            }
        });

        // -- Scheduler --
        const schedulerRole = new Role(this, 'FindMeAJobSchedulerRole', {
            assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
        });

        workflow.grantStartExecution(schedulerRole);

        new Schedule(this, 'FindMeAJobWorkflowSchedule', {
            schedule: ScheduleExpression.cron({
                minute: '0',
                hour: '10',
                weekDay: 'MON,WED,FRI',
                timeZone: TimeZone.AMERICA_NEW_YORK
            }),
            target: new StepFunctionsStartExecution(workflow, {
                role: schedulerRole,
            }),
        });

        // -- Deployments --
        const frontendConfig = `window.APP_CONFIG = {API_URL: "${api.url}manual-approval"};`;

        new BucketDeployment(this, 'DeployFrontend', {
            sources: [
                Source.asset(path.join(__dirname, '../frontend')),
                Source.data('config.js', frontendConfig)
            ],
            destinationBucket: frontendBucket,
            distribution,
            distributionPaths: ['/*'],
            // Invalidate cache but don't wait or verify that invalidation has completed successfully.
            waitForDistributionInvalidation: false
        });

        // -- CloudFormation Output --
        new CfnOutput(this, 'CFOutputStateMachineArn', {
            value: workflow.stateMachineArn
        });

        new CfnOutput(this, 'ManualWorkflowApprovalFrontendURL', {
            value: `https://${distribution.domainName}`
        });
    }
}

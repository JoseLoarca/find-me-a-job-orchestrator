import * as cdk from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import {PolicyDocument, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {CfnOutput, TimeZone} from "aws-cdk-lib/core";
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


export class FindMeAJobOrchestratorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

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

        new BucketDeployment(this, 'DeployFrontend', {
            sources: [Source.asset(path.join(__dirname, '../frontend'))],
            destinationBucket: frontendBucket,
            distribution,
            distributionPaths: ['/*'],
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
            }
        });

        snsTopic.grantPublish(manualWorkflowApprovalFunction);

        const lambdaAccessPolicy = new PolicyDocument({
            statements: [
                new PolicyStatement({
                    actions: ['lambda:InvokeFunction'],
                    resources: [
                        manualWorkflowApprovalFunction.functionArn],
                })
            ],
        });

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

        // -- CloudFormation Output --
        new CfnOutput(this, 'CFOutputStateMachineArn', {
            value: workflow.stateMachineArn
        });

        new CfnOutput(this, 'ManualWorkflowApprovalFrontendURL', {
            value: `https://${distribution.domainName}`
        });
    }
}

import * as cdk from 'aws-cdk-lib/core';
import {Construct} from 'constructs';
import {PolicyDocument, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {CfnOutput, TimeZone} from "aws-cdk-lib/core";
import {Schedule, ScheduleExpression} from "aws-cdk-lib/aws-scheduler";
import {StepFunctionsStartExecution} from "aws-cdk-lib/aws-scheduler-targets";
import {PythonFunction} from "@aws-cdk/aws-lambda-python-alpha";
import path from 'path';
import {Runtime} from 'aws-cdk-lib/aws-lambda';


export class FindMeAJobOrchestratorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // -- Lambda Functions --
        const manualWorkflowApprovalFunction = new PythonFunction(this, 'ManualWorkflowApprovalFunction', {
            entry: path.join(__dirname, '../lambda/manualWorkflowApprovalFunction'),
            runtime: Runtime.PYTHON_3_13,
            index: 'app.py',
            handler: 'lambda_handler'
        });

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
                lambdaAccessPolicy: lambdaAccessPolicy
            }
        });

        // -- Step Functions Workflow --
        const workflow = new StateMachine(this, 'FindMeAJobStateMachine', {
            stateMachineName: 'FindMeAJobWorkflow',
            role: stateMachineRole,
            definitionBody: DefinitionBody.fromFile('stateMachine/definition.asl.json'),
            definitionSubstitutions: {
                manualWorkflowApprovalFunctionARN: manualWorkflowApprovalFunction.functionArn
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
    }
}

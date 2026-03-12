import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {CfnOutput, TimeZone} from "aws-cdk-lib/core";
import {Schedule, ScheduleExpression} from "aws-cdk-lib/aws-scheduler";
import {StepFunctionsStartExecution} from "aws-cdk-lib/aws-scheduler-targets";

export class FindMeAJobOrchestratorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -- Step Functions Role --
    const stateMachineRole = new Role(this, 'FindMeAJobStateMachineRole', {
      assumedBy: new ServicePrincipal('states.amazonaws.com')
    });

    // -- Step Functions Workflow --
    const workflow = new StateMachine(this, 'FindMeAJobStateMachine', {
      stateMachineName: 'FindMeAJobWorkflow',
      role: stateMachineRole,
      definitionBody: DefinitionBody.fromFile('stateMachine/definition.asl.json'),
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

import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import {Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {DefinitionBody, StateMachine} from "aws-cdk-lib/aws-stepfunctions";
import {CfnOutput} from "aws-cdk-lib/core";

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

    // -- CloudFormation Output --
    new CfnOutput(this, 'CFOutputStateMachineArn', {
      value: workflow.stateMachineArn
    });
  }
}

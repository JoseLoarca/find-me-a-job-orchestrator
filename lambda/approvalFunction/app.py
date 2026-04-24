import json
import logging
import os

import boto3
from botocore.exceptions import ClientError

# Initialize the logger
logger = logging.getLogger()
logger.setLevel("DEBUG")

manual_approval_table_name = os.getenv('MANUAL_APPROVAL_TABLE_NAME')
dynamodbClient = boto3.resource('dynamodb')
sfnClient = boto3.client("stepfunctions")


def lambda_handler(event, context):
    """
    Main Lambda handler function

    Parameters:
        event: Dict containing the Lambda function event data
        context: Lambda runtime context

    Returns:
        Dict containing status message
    """
    logger.debug(f"Incoming event: {json.dumps(event)}")

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON body"})

    # Get data from body
    request_id = body.get("requestId")
    decision = body.get("decision")  # APPROVE | APPROVE_CUSTOM | REJECT
    custom_params = body.get("payload", {})

    if not request_id or not decision:
        return response(400, {"error": "Missing requestId or decision"})

    # Lookup requestId in dynamo
    table = dynamodbClient.Table(manual_approval_table_name)
    item = table.get_item(Key={"requestId": request_id}).get("Item")
    if not item:
        return response(404, {"error": "Invalid requestId"})

    if item.get("status") != "pending":
        return response(409, {"error": "Request already processed"})

    task_token = item["taskToken"]

    try:
        if decision == "REJECT":
            sfnClient.send_task_failure(
                taskToken=task_token,
                error="UserRejected",
                cause="User rejected the workflow"
            )
            new_status = "rejected"

        elif decision in ["APPROVE", "APPROVE_CUSTOM"]:
            output_payload = {
                "decision": decision,
                "approved": True,
                "params": custom_params,
                "requestId": request_id
            }

            sfnClient.send_task_success(
                taskToken=task_token,
                output=json.dumps(output_payload)
            )

            new_status = "approved"

        else:
            return response(400, {"error": "Invalid decision"})

        # Update request in dynamodb
        table.update_item(
            Key={"requestId": request_id},
            UpdateExpression="SET #s = :newStatus",
            ConditionExpression="#s = :pending",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":newStatus": new_status,
                ":pending": "pending"
            }
        )

        return response(200, {
            "message": f"{decision} processed successfully"
        })

    except ClientError as e:
        logger.error(str(e))
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return response(409, {"error": "Request already handled"})
        raise


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "OPTIONS,POST"
        },
        "body": json.dumps(body)
    }

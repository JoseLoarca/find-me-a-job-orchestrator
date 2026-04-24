import json
import logging
import os
import uuid

from datetime import datetime, UTC, timedelta

import boto3

# Initialize the logger
logger = logging.getLogger()
logger.setLevel("DEBUG")

snsClient = boto3.client('sns')
dynamodbClient = boto3.resource('dynamodb')

distribution_domain_name = os.getenv('MANUAL_APPROVAL_DOMAIN_NAME')
topic_arn = os.getenv('TOPIC_ARN')
manual_approval_table_name = os.getenv('MANUAL_APPROVAL_TABLE_NAME')

EMAIL_MESSAGE = """Manual Workflow Approval Request

Please click on this link to reject or approve the request.

{link}
"""


def lambda_handler(event, context):
    """
    Main Lambda handler function

    Parameters:
        event: Dict containing the Lambda function event data
        context: Lambda runtime context

    Returns:
        Dict containing status message
    """
    try:
        logger.debug(f"Incoming event: {json.dumps(event)}")

        # Get task token
        task_token = event.get('task_token')
        if not task_token:
            logger.error(f"Missing task_token")
            raise ValueError("Missing task_token")

        # Generate requestId
        request_id = str(uuid.uuid4())
        logger.debug(f"Generated requestId: {request_id}")

        # Store in DynamoDB
        table = dynamodbClient.Table(manual_approval_table_name)
        ttl = int((datetime.now(UTC) + timedelta(hours=8.1)).timestamp()) # Lambda has a timeout of 8 hours, so...
        table.put_item(
            Item={
                "requestId": request_id,
                "taskToken": task_token,
                "status": "pending",
                "createdAt": datetime.now(UTC).isoformat(),
                "ttl": ttl
            }
        )

        # Send message
        message_id = send_message(request_id)

        return {
            "statusCode": 200,
            "requestId": request_id,
            "message": f"Message sent successfully: {message_id}"
        }

    except Exception as e:
        logger.error(f"Error during workflow: {str(e)}")
        raise

def send_message(request_id: str) -> str:
    """Send a message
    """
    approval_link = f"https://{distribution_domain_name}?requestId={request_id}"

    response = snsClient.publish(
        TopicArn=topic_arn,
        Message=EMAIL_MESSAGE.format(link=approval_link),
        Subject='Manual Workflow Approval Request - Step Functions'
    )
    logger.debug(response)

    return response.get('MessageId')
import logging
import os

import boto3

# Initialize the logger
logger = logging.getLogger()
logger.setLevel("DEBUG")

snsClient = boto3.client('sns')

distribution_domain_name = os.getenv('MANUAL_APPROVAL_DOMAIN_NAME')
topic_arn = os.getenv('TOPIC_ARN')

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
        # Parse the input event
        task_token = event.get('task_token')
        logger.info(task_token)

        response = snsClient.publish(
            TopicArn=topic_arn,
            Message=EMAIL_MESSAGE.format(link=distribution_domain_name),
            Subject='Manual Workflow Approval Request - Step Functions'
        )

        logger.debug(response)

        return {
            "statusCode": 200,
            "message": f"Message sent successfully: {response.get('MessageId')}"
        }

    except Exception as e:
        logger.error(f"Error sending message: {str(e)}")
        raise

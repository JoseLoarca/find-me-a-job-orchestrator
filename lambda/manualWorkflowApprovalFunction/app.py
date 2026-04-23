import logging

# Initialize the logger
logger = logging.getLogger()
logger.setLevel("DEBUG")

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
        task_token = event
        logger.info(task_token)

        return {
            "statusCode": 200,
            "message": "Receipt processed successfully"
        }

    except Exception as e:
        logger.error(f"Error processing order: {str(e)}")
        raise

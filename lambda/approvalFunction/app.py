import json
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
        logger.info('It works!')

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
            },
            "body": json.dumps({
                "message": "Hello world"
            })
        }

    except Exception as e:
        logger.error(f"It doesn't work! {str(e)}")

        return {
            "statusCode": 400,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
            },
            "body": json.dumps({
                "message": {str(e)}
            })
        }

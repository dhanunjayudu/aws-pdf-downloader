"""
AWS Lambda handler for FastAPI application
This adapter allows FastAPI to run on AWS Lambda
"""

import json
import base64
from typing import Dict, Any
from mangum import Mangum
from src.web_app_fastapi import app

# Create the Lambda handler using Mangum
handler = Mangum(app, lifespan="off")

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler function that adapts FastAPI for Lambda
    """
    try:
        # Use Mangum to handle the Lambda event
        return handler(event, context)
    except Exception as e:
        # Fallback error handling
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

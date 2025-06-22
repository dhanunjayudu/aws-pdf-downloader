#!/bin/bash

# NCDHHS Python Service - AWS Infrastructure Setup
# This script creates all necessary AWS resources using AWS CLI

set -e  # Exit on any error

# Configuration
REGION="us-east-1"
BUCKET_NAME="cwis-policy-manuals"
LAMBDA_FUNCTION_NAME="ncdhhs-python-processor"
API_GATEWAY_NAME="ncdhhs-python-api"
ROLE_NAME="ncdhhs-python-lambda-role"

echo "🚀 Setting up AWS infrastructure for NCDHHS Python Service..."
echo "📍 Region: $REGION"
echo "🪣 S3 Bucket: $BUCKET_NAME"
echo "⚡ Lambda Function: $LAMBDA_FUNCTION_NAME"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if AWS CLI is configured
check_aws_cli() {
    print_status "Checking AWS CLI configuration..."
    
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS CLI is not configured. Please run 'aws configure' first."
        exit 1
    fi
    
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    print_success "AWS CLI configured. Account ID: $ACCOUNT_ID"
}

# Function to create S3 bucket
create_s3_bucket() {
    print_status "Creating S3 bucket: $BUCKET_NAME"
    
    if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
        print_warning "S3 bucket $BUCKET_NAME already exists"
    else
        aws s3api create-bucket \
            --bucket "$BUCKET_NAME" \
            --region "$REGION" \
            --create-bucket-configuration LocationConstraint="$REGION" 2>/dev/null || \
        aws s3api create-bucket \
            --bucket "$BUCKET_NAME" \
            --region "$REGION"
        
        # Enable versioning
        aws s3api put-bucket-versioning \
            --bucket "$BUCKET_NAME" \
            --versioning-configuration Status=Enabled
        
        print_success "S3 bucket created and versioning enabled"
    fi
}

# Function to create IAM role for Lambda
create_lambda_role() {
    print_status "Creating IAM role: $ROLE_NAME"
    
    # Trust policy for Lambda
    cat > /tmp/trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Service": "lambda.amazonaws.com"
            },
            "Action": "sts:AssumeRole"
        }
    ]
}
EOF

    # Create role if it doesn't exist
    if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
        print_warning "IAM role $ROLE_NAME already exists"
    else
        aws iam create-role \
            --role-name "$ROLE_NAME" \
            --assume-role-policy-document file:///tmp/trust-policy.json
        print_success "IAM role created"
    fi
    
    # Attach basic Lambda execution policy
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    
    # Create and attach custom policy for S3 and DynamoDB access
    cat > /tmp/lambda-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::$BUCKET_NAME",
                "arn:aws:s3:::$BUCKET_NAME/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:PutItem",
                "dynamodb:GetItem",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:UpdateItem",
                "dynamodb:DeleteItem"
            ],
            "Resource": [
                "arn:aws:dynamodb:$REGION:*:table/ncdhhs-embeddings",
                "arn:aws:dynamodb:$REGION:*:table/ncdhhs-embeddings/index/*",
                "arn:aws:dynamodb:$REGION:*:table/ncdhhs-interactions"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream"
            ],
            "Resource": [
                "arn:aws:bedrock:$REGION::foundation-model/amazon.titan-embed-text-v1",
                "arn:aws:bedrock:$REGION::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0",
                "arn:aws:bedrock:$REGION::foundation-model/anthropic.claude-3-haiku-20240307-v1:0"
            ]
        }
    ]
}
EOF

    # Create policy
    POLICY_ARN="arn:aws:iam::$ACCOUNT_ID:policy/ncdhhs-python-lambda-policy"
    
    if aws iam get-policy --policy-arn "$POLICY_ARN" &>/dev/null; then
        print_warning "Policy already exists, updating..."
        # Get the default version and delete it, then create new one
        aws iam create-policy-version \
            --policy-arn "$POLICY_ARN" \
            --policy-document file:///tmp/lambda-policy.json \
            --set-as-default
    else
        aws iam create-policy \
            --policy-name "ncdhhs-python-lambda-policy" \
            --policy-document file:///tmp/lambda-policy.json
    fi
    
    # Attach custom policy to role
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn "$POLICY_ARN"
    
    print_success "IAM policies attached"
    
    # Clean up temp files
    rm -f /tmp/trust-policy.json /tmp/lambda-policy.json
}

# Function to create DynamoDB tables
create_dynamodb_tables() {
    print_status "Creating DynamoDB tables..."
    
    # Create embeddings table
    if aws dynamodb describe-table --table-name ncdhhs-embeddings --region "$REGION" &>/dev/null; then
        print_warning "DynamoDB table ncdhhs-embeddings already exists"
    else
        aws dynamodb create-table \
            --table-name ncdhhs-embeddings \
            --attribute-definitions \
                AttributeName=documentId,AttributeType=S \
                AttributeName=section,AttributeType=S \
            --key-schema \
                AttributeName=documentId,KeyType=HASH \
            --global-secondary-indexes \
                'IndexName=section-index,KeySchema=[{AttributeName=section,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5}' \
            --provisioned-throughput \
                ReadCapacityUnits=5,WriteCapacityUnits=5 \
            --region "$REGION"
        
        print_success "DynamoDB embeddings table created"
    fi
    
    # Create interactions table
    if aws dynamodb describe-table --table-name ncdhhs-interactions --region "$REGION" &>/dev/null; then
        print_warning "DynamoDB table ncdhhs-interactions already exists"
    else
        aws dynamodb create-table \
            --table-name ncdhhs-interactions \
            --attribute-definitions \
                AttributeName=sessionId,AttributeType=S \
                AttributeName=timestamp,AttributeType=S \
            --key-schema \
                AttributeName=sessionId,KeyType=HASH \
                AttributeName=timestamp,KeyType=RANGE \
            --provisioned-throughput \
                ReadCapacityUnits=5,WriteCapacityUnits=5 \
            --region "$REGION"
        
        print_success "DynamoDB interactions table created"
    fi
    
    # Wait for tables to be active
    print_status "Waiting for DynamoDB tables to be active..."
    aws dynamodb wait table-exists --table-name ncdhhs-embeddings --region "$REGION"
    aws dynamodb wait table-exists --table-name ncdhhs-interactions --region "$REGION"
    print_success "DynamoDB tables are active"
}

# Function to create Lambda function
create_lambda_function() {
    print_status "Creating Lambda function: $LAMBDA_FUNCTION_NAME"
    
    # Create deployment package
    print_status "Creating deployment package..."
    cd ../src
    
    # Create a simple deployment package
    zip -r ../infrastructure/lambda-deployment.zip . -x "*.pyc" "__pycache__/*" "*.git*"
    
    cd ../infrastructure
    
    # Get role ARN
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
    
    # Create or update Lambda function
    if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" --region "$REGION" &>/dev/null; then
        print_warning "Lambda function already exists, updating code..."
        aws lambda update-function-code \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --zip-file fileb://lambda-deployment.zip \
            --region "$REGION"
    else
        # Wait a bit for role to propagate
        print_status "Waiting for IAM role to propagate..."
        sleep 10
        
        aws lambda create-function \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --runtime python3.9 \
            --role "$ROLE_ARN" \
            --handler lambda_handler.lambda_handler \
            --zip-file fileb://lambda-deployment.zip \
            --timeout 900 \
            --memory-size 1024 \
            --environment Variables="{S3_BUCKET_NAME=$BUCKET_NAME,EMBEDDINGS_TABLE=ncdhhs-embeddings,INTERACTIONS_TABLE=ncdhhs-interactions}" \
            --region "$REGION"
    fi
    
    # Update function configuration
    aws lambda update-function-configuration \
        --function-name "$LAMBDA_FUNCTION_NAME" \
        --timeout 900 \
        --memory-size 1024 \
        --environment Variables="{S3_BUCKET_NAME=$BUCKET_NAME,EMBEDDINGS_TABLE=ncdhhs-embeddings,INTERACTIONS_TABLE=ncdhhs-interactions}" \
        --region "$REGION"
    
    print_success "Lambda function created/updated"
    
    # Clean up
    rm -f lambda-deployment.zip
}

# Function to create API Gateway
create_api_gateway() {
    print_status "Creating API Gateway: $API_GATEWAY_NAME"
    
    # Check if API already exists
    API_ID=$(aws apigateway get-rest-apis --region "$REGION" --query "items[?name=='$API_GATEWAY_NAME'].id" --output text)
    
    if [ -z "$API_ID" ] || [ "$API_ID" == "None" ]; then
        # Create new API
        API_ID=$(aws apigateway create-rest-api \
            --name "$API_GATEWAY_NAME" \
            --description "NCDHHS Python Service API" \
            --region "$REGION" \
            --query 'id' --output text)
        print_success "API Gateway created with ID: $API_ID"
    else
        print_warning "API Gateway already exists with ID: $API_ID"
    fi
    
    # Get root resource ID
    ROOT_RESOURCE_ID=$(aws apigateway get-resources \
        --rest-api-id "$API_ID" \
        --region "$REGION" \
        --query 'items[?path==`/`].id' --output text)
    
    # Create resources and methods
    create_api_resource() {
        local resource_name=$1
        local handler_function=$2
        
        # Create resource
        RESOURCE_ID=$(aws apigateway create-resource \
            --rest-api-id "$API_ID" \
            --parent-id "$ROOT_RESOURCE_ID" \
            --path-part "$resource_name" \
            --region "$REGION" \
            --query 'id' --output text 2>/dev/null || \
            aws apigateway get-resources \
                --rest-api-id "$API_ID" \
                --region "$REGION" \
                --query "items[?pathPart=='$resource_name'].id" --output text)
        
        # Create POST method
        aws apigateway put-method \
            --rest-api-id "$API_ID" \
            --resource-id "$RESOURCE_ID" \
            --http-method POST \
            --authorization-type NONE \
            --region "$REGION" 2>/dev/null || true
        
        # Get Lambda function ARN
        LAMBDA_ARN=$(aws lambda get-function \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --region "$REGION" \
            --query 'Configuration.FunctionArn' --output text)
        
        # Create integration
        aws apigateway put-integration \
            --rest-api-id "$API_ID" \
            --resource-id "$RESOURCE_ID" \
            --http-method POST \
            --type AWS_PROXY \
            --integration-http-method POST \
            --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
            --region "$REGION" 2>/dev/null || true
        
        # Add Lambda permission
        aws lambda add-permission \
            --function-name "$LAMBDA_FUNCTION_NAME" \
            --statement-id "apigateway-$resource_name-$(date +%s)" \
            --action lambda:InvokeFunction \
            --principal apigateway.amazonaws.com \
            --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*" \
            --region "$REGION" 2>/dev/null || true
    }
    
    # Create API resources
    create_api_resource "process-pdfs" "pdf_processor.lambda_handler"
    create_api_resource "rag-query" "rag_system.rag_query_handler"
    create_api_resource "feedback" "rag_system.feedback_handler"
    
    # Deploy API
    aws apigateway create-deployment \
        --rest-api-id "$API_ID" \
        --stage-name prod \
        --region "$REGION" >/dev/null
    
    print_success "API Gateway deployed"
    
    # Output API endpoint
    API_ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"
    echo ""
    print_success "🌐 API Gateway Endpoint: $API_ENDPOINT"
    echo ""
    print_success "📋 Available Endpoints:"
    echo "   • PDF Processing: $API_ENDPOINT/process-pdfs"
    echo "   • RAG Query: $API_ENDPOINT/rag-query"
    echo "   • Feedback: $API_ENDPOINT/feedback"
}

# Function to test the deployment
test_deployment() {
    print_status "Testing deployment..."
    
    API_ENDPOINT="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"
    
    # Test RAG query
    print_status "Testing RAG query endpoint..."
    RESPONSE=$(curl -s -X POST "$API_ENDPOINT/rag-query" \
        -H 'Content-Type: application/json' \
        -d '{"query":"What are CPS assessment procedures?","userId":"test-user"}' \
        --max-time 30)
    
    if echo "$RESPONSE" | grep -q '"success":true'; then
        print_success "✅ RAG query test passed"
    else
        print_warning "⚠️  RAG query test failed or returned unexpected response"
        echo "Response: $RESPONSE"
    fi
    
    echo ""
    print_success "🎉 Deployment completed successfully!"
    echo ""
    print_success "📊 Summary:"
    echo "   🪣 S3 Bucket: $BUCKET_NAME"
    echo "   ⚡ Lambda Function: $LAMBDA_FUNCTION_NAME"
    echo "   🌐 API Gateway: $API_ENDPOINT"
    echo "   🗄️  DynamoDB Tables: ncdhhs-embeddings, ncdhhs-interactions"
    echo ""
    print_success "🚀 Your Python-based NCDHHS service is ready!"
}

# Main execution
main() {
    echo "🐍 NCDHHS Python Service - AWS Infrastructure Setup"
    echo "=================================================="
    
    check_aws_cli
    create_s3_bucket
    create_lambda_role
    create_dynamodb_tables
    create_lambda_function
    create_api_gateway
    test_deployment
    
    echo ""
    print_success "✅ All AWS resources have been created successfully!"
    echo ""
    print_status "Next steps:"
    echo "1. Test the API endpoints using the URLs provided above"
    echo "2. Deploy the Flask web application for local development"
    echo "3. Configure Bedrock access for full AI capabilities"
    echo ""
    print_status "To run the Flask app locally:"
    echo "   cd ../src && python web_app.py"
}

# Run main function
main "$@"

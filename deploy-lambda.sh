#!/bin/bash

echo "🚀 NCDHHS PDF Processor - Lambda Deployment Script"
echo "================================================="

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS CLI not configured. Please run 'aws configure' first"
    exit 1
fi

echo "✅ AWS CLI configured"

# Create deployment package
echo "📦 Creating Lambda deployment package..."
cd lambda/
npm install --production
zip -r ../lambda-deployment.zip .
cd ..

echo "✅ Deployment package created: lambda-deployment.zip"

# Get AWS account ID and region
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"

echo "📋 AWS Account: $ACCOUNT_ID"
echo "📋 Region: $REGION"

# Use existing S3 bucket
BUCKET_NAME="ncdhhs-cwis-policy-manuals"
echo "🪣 Using existing S3 bucket: $BUCKET_NAME"

# Create IAM role for Lambda
echo "🔐 Creating IAM role for Lambda..."

ROLE_NAME="ncdhhs-pdf-processor-role"
TRUST_POLICY='{
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
}'

aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document "$TRUST_POLICY" 2>/dev/null || echo "Role already exists"

# Attach basic Lambda execution policy
aws iam attach-role-policy --role-name $ROLE_NAME --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create and attach S3 access policy
S3_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::'$BUCKET_NAME'/*"
    }
  ]
}'

aws iam put-role-policy --role-name $ROLE_NAME --policy-name S3AccessPolicy --policy-document "$S3_POLICY"

echo "✅ IAM role created and configured"

# Wait for role to be ready
echo "⏳ Waiting for IAM role to be ready..."
sleep 10

# Create Lambda function
echo "⚡ Creating Lambda function..."

ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME"

aws lambda create-function \
  --function-name ncdhhs-pdf-processor \
  --runtime nodejs18.x \
  --role $ROLE_ARN \
  --handler processPDFs.handler \
  --zip-file fileb://lambda-deployment.zip \
  --timeout 900 \
  --memory-size 1024 \
  --environment Variables="{S3_BUCKET_NAME=$BUCKET_NAME,AWS_REGION=$REGION}" \
  --region $REGION 2>/dev/null || {
    echo "Function might already exist, updating..."
    aws lambda update-function-code \
      --function-name ncdhhs-pdf-processor \
      --zip-file fileb://lambda-deployment.zip \
      --region $REGION
    
    aws lambda update-function-configuration \
      --function-name ncdhhs-pdf-processor \
      --timeout 900 \
      --memory-size 1024 \
      --environment Variables="{S3_BUCKET_NAME=$BUCKET_NAME,AWS_REGION=$REGION}" \
      --region $REGION
  }

echo "✅ Lambda function created/updated"

# Create API Gateway
echo "🌐 Creating API Gateway..."

API_NAME="ncdhhs-pdf-api"
API_ID=$(aws apigateway create-rest-api --name $API_NAME --region $REGION --query 'id' --output text 2>/dev/null || aws apigateway get-rest-apis --query "items[?name=='$API_NAME'].id" --output text --region $REGION)

if [ -z "$API_ID" ]; then
    echo "❌ Failed to create or find API Gateway"
    exit 1
fi

echo "✅ API Gateway ID: $API_ID"

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?path==`/`].id' --output text)

# Create resource
RESOURCE_ID=$(aws apigateway create-resource --rest-api-id $API_ID --parent-id $ROOT_ID --path-part process-pdfs --region $REGION --query 'id' --output text 2>/dev/null || aws apigateway get-resources --rest-api-id $API_ID --region $REGION --query 'items[?pathPart==`process-pdfs`].id' --output text)

# Create POST method
aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --authorization-type NONE --region $REGION 2>/dev/null || echo "Method already exists"

# Create integration
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:ncdhhs-pdf-processor"
aws apigateway put-integration --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method POST --type AWS_PROXY --integration-http-method POST --uri "arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" --region $REGION 2>/dev/null || echo "Integration already exists"

# Add Lambda permission for API Gateway
aws lambda add-permission --function-name ncdhhs-pdf-processor --statement-id api-gateway-invoke --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*" --region $REGION 2>/dev/null || echo "Permission already exists"

# Enable CORS
aws apigateway put-method --rest-api-id $API_ID --resource-id $RESOURCE_ID --http-method OPTIONS --authorization-type NONE --region $REGION 2>/dev/null || echo "OPTIONS method already exists"

# Deploy API
aws apigateway create-deployment --rest-api-id $API_ID --stage-name prod --region $REGION

API_URL="https://$API_ID.execute-api.$REGION.amazonaws.com/prod"

echo ""
echo "🎉 Deployment completed!"
echo "📋 Resources created:"
echo "   S3 Bucket: $BUCKET_NAME"
echo "   Lambda Function: ncdhhs-pdf-processor"
echo "   API Gateway: $API_URL"
echo ""
echo "🔧 Next steps:"
echo "1. Update your frontend code with the API URL:"
echo "   const API_BASE_URL = '$API_URL';"
echo ""
echo "2. Test the API:"
echo "   curl -X POST $API_URL/process-pdfs \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"url\":\"https://policies.ncdhhs.gov/divisional-n-z/social-services/child-welfare-services/cws-policies-manuals/\"}'"
echo ""
echo "3. Deploy your updated frontend to Amplify"
echo ""
echo "🗑️ Cleanup (if needed):"
echo "   rm lambda-deployment.zip"

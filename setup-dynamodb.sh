#!/bin/bash

echo "🚀 Setting up DynamoDB tables for NCDHHS RAG system..."

# Create embeddings table
echo "📊 Creating embeddings table..."
aws dynamodb create-table \
    --table-name ncdhhs-embeddings \
    --attribute-definitions \
        AttributeName=documentId,AttributeType=S \
        AttributeName=section,AttributeType=S \
    --key-schema \
        AttributeName=documentId,KeyType=HASH \
    --global-secondary-indexes \
        IndexName=section-index,KeySchema=[{AttributeName=section,KeyType=HASH}],Projection={ProjectionType=ALL},ProvisionedThroughput={ReadCapacityUnits=5,WriteCapacityUnits=5} \
    --provisioned-throughput \
        ReadCapacityUnits=5,WriteCapacityUnits=5 \
    --region us-east-1

# Create interactions table
echo "💬 Creating interactions table..."
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
    --region us-east-1

echo "⏳ Waiting for tables to be created..."
aws dynamodb wait table-exists --table-name ncdhhs-embeddings --region us-east-1
aws dynamodb wait table-exists --table-name ncdhhs-interactions --region us-east-1

echo "✅ DynamoDB tables created successfully!"
echo ""
echo "📋 Tables created:"
echo "   • ncdhhs-embeddings (for document embeddings)"
echo "   • ncdhhs-interactions (for user interactions and feedback)"
echo ""
echo "🎯 Next steps:"
echo "   1. Update Lambda function with RAG capabilities"
echo "   2. Generate embeddings for existing PDFs"
echo "   3. Test RAG queries"

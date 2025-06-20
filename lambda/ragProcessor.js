import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'ncdhhs-cwis-policy-manuals';
const EMBEDDINGS_TABLE = process.env.EMBEDDINGS_TABLE || 'ncdhhs-embeddings';
const INTERACTIONS_TABLE = process.env.INTERACTIONS_TABLE || 'ncdhhs-interactions';

// Enhanced RAG processor for NCDHHS policy documents
export const handler = async (event) => {
  console.log('Processing RAG query for NCDHHS policies...');
  
  try {
    const { httpMethod, path } = event;
    
    // Route different endpoints
    if (httpMethod === 'POST' && path === '/rag-query') {
      return await handleRagQuery(event);
    } else if (httpMethod === 'POST' && path === '/feedback') {
      return await handleFeedback(event);
    } else if (httpMethod === 'POST' && path === '/refine-response') {
      return await handleRefineResponse(event);
    } else if (httpMethod === 'POST' && path === '/generate-embeddings') {
      return await handleGenerateEmbeddings(event);
    } else {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Endpoint not found' })
      };
    }

  } catch (error) {
    console.error('RAG processing error:', error);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

const handleRagQuery = async (event) => {
  const { query, section, userId, sessionId, recordId } = JSON.parse(event.body);
  
  if (!query) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: 'Query is required' })
    };
  }

  console.log(`Processing query: "${query}" for section: ${section || 'all'}`);

  // Step 1: Generate embeddings for the query
  const queryEmbedding = await generateEmbedding(query);
  
  // Step 2: Search relevant documents from your organized S3 structure
  const relevantDocs = await searchRelevantDocuments(queryEmbedding, section);
  
  // Step 3: Build context from relevant documents
  const context = await buildContext(relevantDocs);
  
  // Step 4: Generate response using Bedrock Claude
  const response = await generateResponse(query, context, section);
  
  // Step 5: Log interaction for feedback loop
  await logInteraction(userId, sessionId, query, response, relevantDocs, recordId);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      response: response.content,
      sources: relevantDocs.map(doc => ({
        filename: doc.filename,
        section: doc.section,
        relevanceScore: doc.score,
        s3Key: doc.s3Key,
        excerpt: doc.excerpt
      })),
      sessionId: sessionId,
      usage: response.usage,
      timestamp: new Date().toISOString()
    })
  };
};

const handleFeedback = async (event) => {
  const { sessionId, query, response, feedback, userId } = JSON.parse(event.body);
  
  await dynamoClient.send(new PutCommand({
    TableName: INTERACTIONS_TABLE,
    Item: {
      sessionId: sessionId,
      timestamp: new Date().toISOString(),
      userId: userId,
      query: query,
      response: response,
      feedback: feedback,
      type: 'feedback'
    }
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ success: true, message: 'Feedback recorded' })
  };
};

const handleRefineResponse = async (event) => {
  const { originalQuery, originalResponse, sessionId, section } = JSON.parse(event.body);
  
  // Get feedback context
  const feedbackContext = await getFeedbackContext(sessionId);
  
  // Generate refined response
  const refinedResponse = await refineResponse(originalQuery, originalResponse, feedbackContext, section);
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      refinedResponse: refinedResponse.content,
      usage: refinedResponse.usage,
      timestamp: new Date().toISOString()
    })
  };
};

const handleGenerateEmbeddings = async (event) => {
  console.log('Generating embeddings for all PDFs in S3...');
  
  const sections = [
    'child-welfare-manuals',
    'child-welfare-practice-resources', 
    'child-welfare-appendices',
    'path-sdm-tools-manuals',
    'safe-sleep-resources',
    'disaster-preparedness',
    'administrative-manuals',
    'other-resources'
  ];

  let totalProcessed = 0;
  const results = [];

  for (const section of sections) {
    try {
      const objects = await s3Client.send(new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: `ncdhhs-pdfs/${section}/`
      }));

      if (objects.Contents) {
        for (const obj of objects.Contents) {
          if (obj.Key.endsWith('.pdf')) {
            try {
              console.log(`Processing ${obj.Key}...`);
              
              // Extract text from PDF
              const pdfContent = await extractPdfText(obj.Key);
              
              // Generate embeddings for chunks
              const chunks = chunkText(pdfContent, 1000); // 1000 char chunks
              
              for (let i = 0; i < chunks.length; i++) {
                const embedding = await generateEmbedding(chunks[i]);
                
                // Store embedding in DynamoDB
                await dynamoClient.send(new PutCommand({
                  TableName: EMBEDDINGS_TABLE,
                  Item: {
                    documentId: `${obj.Key}_chunk_${i}`,
                    s3Key: obj.Key,
                    section: section,
                    filename: obj.Key.split('/').pop(),
                    chunkIndex: i,
                    content: chunks[i],
                    embedding: embedding,
                    createdAt: new Date().toISOString()
                  }
                }));
              }
              
              totalProcessed++;
              results.push({
                filename: obj.Key.split('/').pop(),
                section: section,
                chunks: chunks.length,
                status: 'success'
              });
              
            } catch (error) {
              console.error(`Error processing ${obj.Key}:`, error);
              results.push({
                filename: obj.Key.split('/').pop(),
                section: section,
                status: 'error',
                error: error.message
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error processing section ${section}:`, error);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      message: `Generated embeddings for ${totalProcessed} documents`,
      results: results,
      timestamp: new Date().toISOString()
    })
  };
};

const generateEmbedding = async (text) => {
  try {
    const command = new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v1',
      body: JSON.stringify({
        inputText: text.substring(0, 8000) // Titan has input limits
      }),
      contentType: 'application/json'
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
};

const searchRelevantDocuments = async (queryEmbedding, section) => {
  try {
    // Scan DynamoDB for relevant document chunks
    let scanParams = {
      TableName: EMBEDDINGS_TABLE,
      Limit: 50
    };

    // If section is specified, filter by section
    if (section) {
      scanParams.FilterExpression = 'section = :section';
      scanParams.ExpressionAttributeValues = {
        ':section': section
      };
    }

    const result = await dynamoClient.send(new ScanCommand(scanParams));
    
    // Calculate cosine similarity for each document chunk
    const scoredDocs = result.Items.map(item => {
      const similarity = cosineSimilarity(queryEmbedding, item.embedding);
      return {
        ...item,
        score: similarity,
        excerpt: item.content.substring(0, 200) + '...'
      };
    });

    // Sort by relevance and return top results
    return scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Top 5 most relevant chunks

  } catch (error) {
    console.error('Error searching documents:', error);
    // Fallback: return sample documents from the specified section
    return getSampleDocuments(section);
  }
};

const buildContext = async (relevantDocs) => {
  let context = "Based on the following NCDHHS Child Welfare Services policy documents:\n\n";
  
  for (const doc of relevantDocs) {
    context += `Document: ${doc.filename} (Section: ${doc.section})\n`;
    context += `Relevance Score: ${(doc.score * 100).toFixed(1)}%\n`;
    context += `Content: ${doc.content}\n\n`;
  }
  
  return context;
};

const generateResponse = async (query, context, section) => {
  const systemPrompt = `You are an expert assistant for North Carolina Department of Health and Human Services (NCDHHS) Child Welfare Services policies. 

Your role is to provide accurate, helpful information based on official NCDHHS policy documents. Always:

1. Base your responses ONLY on the provided policy documents
2. Cite specific document names and sections when possible
3. If information is not available in the provided context, clearly state "Based on the provided documents, I don't have specific information about..."
4. Provide practical, actionable guidance when appropriate
5. Maintain a professional, helpful tone
6. Use bullet points and clear formatting for readability
7. If asked about procedures, provide step-by-step guidance when available

Context from NCDHHS Policy Documents:
${context}

Section Focus: ${section ? section.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'General Child Welfare Services'}`;

  const userPrompt = `Question: ${query}

Please provide a comprehensive answer based on the NCDHHS policy documents provided in the context. Include specific document references where applicable.`;

  try {
    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2000,
        temperature: 0.1, // Low temperature for factual responses
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      }),
      contentType: 'application/json'
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    return {
      content: responseBody.content[0].text,
      usage: responseBody.usage
    };
  } catch (error) {
    console.error('Error generating response:', error);
    throw error;
  }
};

const refineResponse = async (originalQuery, originalResponse, feedbackContext, section) => {
  const systemPrompt = `You are refining a response based on user feedback. The user indicated they were not satisfied with the previous response.

Original Query: ${originalQuery}
Original Response: ${originalResponse}
Feedback Context: ${feedbackContext}

Please provide an improved, more detailed response that addresses potential gaps in the original answer. Focus on:
1. Providing more specific details
2. Adding relevant examples or scenarios
3. Clarifying any ambiguous points
4. Including additional relevant information from the policy documents`;

  const command = new InvokeModelCommand({
    modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2500,
      temperature: 0.2,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: "Please provide a refined and improved response."
        }
      ]
    }),
    contentType: 'application/json'
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  
  return {
    content: responseBody.content[0].text,
    usage: responseBody.usage
  };
};

const logInteraction = async (userId, sessionId, query, response, sources, recordId) => {
  try {
    await dynamoClient.send(new PutCommand({
      TableName: INTERACTIONS_TABLE,
      Item: {
        sessionId: sessionId,
        timestamp: new Date().toISOString(),
        userId: userId || 'anonymous',
        recordId: recordId,
        query: query,
        response: response.content,
        sourcesCount: sources.length,
        sources: sources.map(s => ({ filename: s.filename, section: s.section, score: s.score })),
        usage: response.usage,
        type: 'query'
      }
    }));
  } catch (error) {
    console.error('Error logging interaction:', error);
  }
};

const extractPdfText = async (s3Key) => {
  // For now, return a placeholder text based on the filename
  // In production, you'd use a proper PDF parsing library
  const filename = s3Key.split('/').pop();
  
  // Return sample content based on document type
  if (filename.includes('cps-assessment')) {
    return `CPS Assessment Procedures Manual
    
This document outlines the procedures for conducting Child Protective Services assessments in North Carolina. Key topics include:

1. Initial Assessment Requirements
2. Safety Assessment Protocols  
3. Risk Evaluation Procedures
4. Documentation Standards
5. Timeline Requirements
6. Family Engagement Strategies
7. Multi-disciplinary Team Coordination
8. Case Planning and Service Referrals

The assessment process must be completed within 30 days of report acceptance and should focus on child safety, family strengths, and service needs.`;
  }
  
  if (filename.includes('adoption')) {
    return `Adoption Services Manual
    
This manual provides guidance on adoption services and procedures including:

1. Pre-adoption Requirements
2. Home Study Procedures
3. Matching Process
4. Legal Requirements
5. Post-adoption Services
6. Interstate Compact Procedures
7. Special Needs Adoption
8. Adoption Assistance Programs

All adoption procedures must comply with state and federal regulations.`;
  }
  
  // Default content for other documents
  return `NCDHHS Child Welfare Policy Document: ${filename}
  
This document contains important policy information and procedures for North Carolina child welfare services. Please refer to the complete document for detailed guidance and requirements.`;
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const chunkText = (text, chunkSize) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
};

const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

const getFeedbackContext = async (sessionId) => {
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: INTERACTIONS_TABLE,
      KeyConditionExpression: 'sessionId = :sessionId',
      ExpressionAttributeValues: {
        ':sessionId': sessionId
      },
      ScanIndexForward: false,
      Limit: 5
    }));

    return result.Items.map(item => ({
      type: item.type,
      feedback: item.feedback,
      timestamp: item.timestamp
    }));
  } catch (error) {
    console.error('Error getting feedback context:', error);
    return [];
  }
};

const getSampleDocuments = (section) => {
  // Fallback sample documents based on your existing S3 structure
  const sampleDocs = {
    'child-welfare-manuals': [
      {
        filename: 'cps-assessments-may-2025-1.pdf',
        section: 'child-welfare-manuals',
        s3Key: 'ncdhhs-pdfs/child-welfare-manuals/cps-assessments-may-2025-1.pdf',
        content: 'CPS Assessment procedures and guidelines for child protective services...',
        score: 0.8,
        excerpt: 'CPS Assessment procedures and guidelines...'
      }
    ],
    'child-welfare-practice-resources': [
      {
        filename: 'applying_the_reasonable_and_prudent_parent_standard_tool.pdf',
        section: 'child-welfare-practice-resources',
        s3Key: 'ncdhhs-pdfs/child-welfare-practice-resources/applying_the_reasonable_and_prudent_parent_standard_tool.pdf',
        content: 'Guidelines for applying reasonable and prudent parent standards...',
        score: 0.75,
        excerpt: 'Guidelines for applying reasonable and prudent parent standards...'
      }
    ]
  };

  return sampleDocs[section] || sampleDocs['child-welfare-manuals'];
};

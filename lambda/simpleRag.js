import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });

export const handler = async (event) => {
  console.log('Simple RAG test handler');
  
  try {
    const { query } = JSON.parse(event.body);
    
    if (!query) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'Query is required' })
      };
    }

    // Simple context about NCDHHS policies
    const context = `You are an expert assistant for North Carolina Department of Health and Human Services (NCDHHS) Child Welfare Services policies. 

Based on NCDHHS policy documents, here is some key information:

CPS Assessment Procedures:
- Initial assessments must be completed within 30 days
- Safety assessments are required for all reports
- Risk evaluation must consider family strengths and needs
- Documentation must be thorough and timely
- Multi-disciplinary team coordination is essential

Adoption Services:
- Pre-adoption requirements include background checks and home studies
- Matching process considers child's needs and family capabilities
- Post-adoption services are available for ongoing support
- Interstate adoptions follow ICPC procedures

Please provide accurate information based on these policies.`;

    const response = await generateResponse(query, context);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        response: response.content,
        usage: response.usage,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Error:', error);
    
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

const generateResponse = async (query, context) => {
  const systemPrompt = `You are an expert assistant for North Carolina Department of Health and Human Services (NCDHHS) Child Welfare Services policies.

${context}

Provide helpful, accurate responses based on the policy information provided.`;

  const command = new InvokeModelCommand({
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0', // Using Haiku for faster/cheaper responses
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1000,
      temperature: 0.1,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: query
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

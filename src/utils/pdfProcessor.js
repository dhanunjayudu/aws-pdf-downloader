// PDF Processing utility - Real Backend Integration
import axios from 'axios';

const API_BASE_URL = 'https://cqdhmncpzi.execute-api.us-east-1.amazonaws.com/prod';

export const processPDFs = async (url, onProgress) => {
  try {
    onProgress('Connecting to backend service...');
    
    const response = await axios.post(`${API_BASE_URL}/process-pdfs`, {
      url: url
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 900000 // 15 minutes to match Lambda timeout
    });

    return response.data;
    
  } catch (error) {
    console.error('PDF processing error:', error);
    throw new Error(error.response?.data?.error || error.message);
  }
};

// Keep mock function for comparison
export const mockProcessPDFs = async (url, onProgress) => {
  onProgress('Scanning website for PDF links...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  onProgress('Found PDF links, starting downloads...');
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  onProgress('Uploading to S3 storage...');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Simulate finding some PDFs
  return {
    success: true,
    summary: {
      total: 5,
      successful: 4,
      failed: 1
    },
    results: [
      {
        filename: 'child-welfare-policy-manual.pdf',
        s3Key: 'pdfs/1234567890_child-welfare-policy-manual.pdf',
        size: 2048576,
        originalUrl: 'https://policies.ncdhhs.gov/.../manual.pdf'
      },
      {
        filename: 'foster-care-guidelines.pdf',
        s3Key: 'pdfs/1234567891_foster-care-guidelines.pdf',
        size: 1536000,
        originalUrl: 'https://policies.ncdhhs.gov/.../guidelines.pdf'
      },
      {
        filename: 'adoption-procedures.pdf',
        s3Key: 'pdfs/1234567892_adoption-procedures.pdf',
        size: 3072000,
        originalUrl: 'https://policies.ncdhhs.gov/.../procedures.pdf'
      },
      {
        filename: 'safety-assessment-form.pdf',
        s3Key: 'pdfs/1234567893_safety-assessment-form.pdf',
        size: 512000,
        originalUrl: 'https://policies.ncdhhs.gov/.../assessment.pdf'
      }
    ],
    errors: [
      {
        url: 'https://policies.ncdhhs.gov/.../broken-link.pdf',
        error: 'File not found (404)'
      }
    ]
  };
};

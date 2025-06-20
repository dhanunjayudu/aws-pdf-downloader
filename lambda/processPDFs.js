// AWS Lambda function for real PDF processing
import axios from 'axios';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

// Helper function to sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
};

// Helper function to upload file to S3
const uploadToS3 = async (buffer, filename) => {
  const timestamp = new Date().getTime();
  const sanitizedName = sanitizeFilename(filename);
  const key = `ncdhhs-pdfs/${timestamp}_${sanitizedName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
    Metadata: {
      'upload-date': new Date().toISOString(),
      'original-name': filename,
      'source': 'ncdhhs-policies'
    }
  });

  try {
    const result = await s3Client.send(command);
    return {
      success: true,
      key: key,
      bucket: process.env.S3_BUCKET_NAME,
      etag: result.ETag
    };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload to S3: ${error.message}`);
  }
};

export const handler = async (event) => {
  console.log('Processing PDFs from NCDHHS website...');
  
  try {
    // Parse the request
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const { url } = body;
    
    if (!url) {
      throw new Error('URL is required');
    }

    console.log(`Starting PDF processing for: ${url}`);

    // Fetch the NCDHHS webpage
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 30000
    });

    // Parse HTML and find PDF links
    const $ = cheerio.load(response.data);
    const pdfLinks = [];

    // Look for PDF links with various selectors
    $('a[href$=".pdf"], a[href*=".pdf"], a[href*="pdf"]').each((i, element) => {
      const href = $(element).attr('href');
      const linkText = $(element).text().trim();
      
      if (href && href.toLowerCase().includes('.pdf')) {
        // Convert relative URLs to absolute URLs
        const absoluteUrl = new URL(href, url).href;
        pdfLinks.push({
          url: absoluteUrl,
          text: linkText || 'Unnamed PDF',
          element: $(element).html()
        });
      }
    });

    // Remove duplicates
    const uniqueLinks = pdfLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.url === link.url)
    );

    if (uniqueLinks.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify({
          success: true,
          summary: {
            total: 0,
            successful: 0,
            failed: 0
          },
          results: [],
          errors: [],
          message: 'No PDF links found on the specified page'
        })
      };
    }

    console.log(`Found ${uniqueLinks.length} unique PDF links`);

    // Process PDFs (limit to 10 to avoid Lambda timeout)
    const maxPDFs = Math.min(uniqueLinks.length, 10);
    const results = [];
    const errors = [];

    for (let i = 0; i < maxPDFs; i++) {
      const pdfLink = uniqueLinks[i];
      try {
        console.log(`Processing PDF ${i + 1}/${maxPDFs}: ${pdfLink.url}`);

        // Download PDF with timeout
        const pdfResponse = await axios.get(pdfLink.url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/1.0)',
            'Accept': 'application/pdf,*/*'
          },
          timeout: 45000, // 45 seconds for large PDFs
          maxContentLength: 50 * 1024 * 1024 // 50MB max file size
        });

        // Verify it's actually a PDF
        const contentType = pdfResponse.headers['content-type'] || '';
        const buffer = Buffer.from(pdfResponse.data);
        
        // Check PDF magic number
        if (!contentType.includes('pdf') && !buffer.toString('hex', 0, 4) === '25504446') {
          throw new Error(`Invalid file type. Expected PDF, got: ${contentType}`);
        }

        // Generate filename
        const urlParts = pdfLink.url.split('/');
        let originalFilename = urlParts[urlParts.length - 1];
        
        // Clean up filename
        if (!originalFilename || !originalFilename.includes('.pdf')) {
          originalFilename = `${sanitizeFilename(pdfLink.text || 'document')}.pdf`;
        }
        
        // Upload to S3
        const uploadResult = await uploadToS3(buffer, originalFilename);

        results.push({
          originalUrl: pdfLink.url,
          filename: originalFilename,
          linkText: pdfLink.text,
          s3Key: uploadResult.key,
          size: buffer.length,
          contentType: contentType
        });

        console.log(`✅ Successfully processed PDF ${i + 1}/${maxPDFs}: ${originalFilename}`);

      } catch (error) {
        console.error(`❌ Error processing PDF ${i + 1}/${maxPDFs}:`, error.message);
        errors.push({
          url: pdfLink.url,
          linkText: pdfLink.text,
          error: error.message
        });
      }
    }

    // Return results
    const responseData = {
      success: true,
      summary: {
        total: maxPDFs,
        successful: results.length,
        failed: errors.length
      },
      results: results,
      errors: errors.length > 0 ? errors : undefined,
      processedFrom: url,
      timestamp: new Date().toISOString()
    };

    console.log(`Process completed: ${results.length}/${maxPDFs} PDFs successfully uploaded`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify(responseData)
    };

  } catch (error) {
    console.error('Lambda function error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// AWS Lambda function for real PDF processing
import axios from 'axios';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Helper function to sanitize filename
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
};

// Helper function to upload file to S3 with consistent naming
const uploadToS3 = async (buffer, filename) => {
  // Use the original filename directly, no timestamp prefix
  const sanitizedName = sanitizeFilename(filename);
  const key = `ncdhhs-pdfs/${sanitizedName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
    Metadata: {
      'upload-date': new Date().toISOString(),
      'original-name': filename,
      'source': 'ncdhhs-policies',
      'last-updated': new Date().toISOString() // Track when file was last updated
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

    // Process PDFs (increased limit to handle more files)
    const maxPDFs = Math.min(uniqueLinks.length, 50); // Increased from 10 to 50

    console.log(`Found ${uniqueLinks.length} unique PDF links, processing up to ${maxPDFs}`);
    const results = [];
    const errors = [];
    let newFiles = 0;
    let updatedFiles = 0;
    let skippedFiles = 0;

    for (let i = 0; i < maxPDFs; i++) {
      const pdfLink = uniqueLinks[i];
      try {
        console.log(`Processing PDF ${i + 1}/${maxPDFs}: ${pdfLink.url}`);

        // Generate filename first
        const urlParts = pdfLink.url.split('/');
        let originalFilename = urlParts[urlParts.length - 1];
        
        // Clean up filename
        if (!originalFilename || !originalFilename.includes('.pdf')) {
          originalFilename = `${sanitizeFilename(pdfLink.text || 'document')}.pdf`;
        }

        const sanitizedName = sanitizeFilename(originalFilename);
        const s3Key = `ncdhhs-pdfs/${sanitizedName}`;

        // Download PDF with timeout and size limit
        const pdfResponse = await axios.get(pdfLink.url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/1.0)',
            'Accept': 'application/pdf,*/*'
          },
          timeout: 30000, // Reduced to 30 seconds per PDF
          maxContentLength: 25 * 1024 * 1024 // Reduced to 25MB max file size
        });

        // Verify it's actually a PDF
        const contentType = pdfResponse.headers['content-type'] || '';
        const buffer = Buffer.from(pdfResponse.data);
        
        // Check PDF magic number
        if (!contentType.includes('pdf') && !buffer.toString('hex', 0, 4) === '25504446') {
          throw new Error(`Invalid file type. Expected PDF, got: ${contentType}`);
        }

        // For now, treat all files as updates (will overwrite with same name)
        let updateReason = 'updated with consistent filename';
        updatedFiles++;

        // Upload to S3 (will overwrite existing file with same name)
        const uploadResult = await uploadToS3(buffer, originalFilename);

        results.push({
          originalUrl: pdfLink.url,
          filename: originalFilename,
          linkText: pdfLink.text,
          s3Key: uploadResult.key,
          size: buffer.length,
          contentType: contentType,
          status: updateReason,
          timestamp: new Date().toISOString()
        });

        console.log(`✅ Successfully processed PDF ${i + 1}/${maxPDFs}: ${originalFilename} (${updateReason})`);

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
        failed: errors.length,
        newFiles: newFiles,
        updatedFiles: updatedFiles,
        refreshedFiles: skippedFiles
      },
      results: results,
      errors: errors.length > 0 ? errors : undefined,
      processedFrom: url,
      timestamp: new Date().toISOString()
    };

    console.log(`Process completed: ${results.length}/${maxPDFs} PDFs processed (${newFiles} new, ${updatedFiles} updated, ${skippedFiles} refreshed)`);

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

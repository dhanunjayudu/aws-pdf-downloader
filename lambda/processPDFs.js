import axios from 'axios';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_+/g, '_').toLowerCase();
};

const uploadToS3 = async (buffer, filename) => {
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
      'last-updated': new Date().toISOString()
    }
  });

  const result = await s3Client.send(command);
  return { success: true, key: key, bucket: process.env.S3_BUCKET_NAME, etag: result.ETag };
};

export const handler = async (event) => {
  console.log('Processing PDFs from NCDHHS website...');
  
  try {
    const { url } = JSON.parse(event.body);
    
    if (!url) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: false, error: 'URL is required' })
      };
    }

    console.log(`Starting PDF processing for: ${url}`);

    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/1.0)' },
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const pdfLinks = [];

    $('a[href$=".pdf"], a[href*=".pdf"]').each((index, element) => {
      const href = $(element).attr('href');
      const text = $(element).text().trim();
      
      if (href) {
        let fullUrl = href;
        if (href.startsWith('/')) {
          const baseUrl = new URL(url);
          fullUrl = `${baseUrl.protocol}//${baseUrl.host}${href}`;
        } else if (!href.startsWith('http')) {
          fullUrl = new URL(href, url).href;
        }
        
        pdfLinks.push({ url: fullUrl, text: text || 'PDF Document' });
      }
    });

    const uniqueLinks = pdfLinks.filter((link, index, self) => 
      index === self.findIndex(l => l.url === link.url)
    );

    if (uniqueLinks.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          success: true,
          summary: { total: 0, successful: 0, failed: 0 },
          results: [],
          message: 'No PDF links found on the specified page'
        })
      };
    }

    console.log(`Found ${uniqueLinks.length} unique PDF links - processing ALL of them dynamically`);

    const results = [];
    const errors = [];

    for (let i = 0; i < uniqueLinks.length; i++) {
      const pdfLink = uniqueLinks[i];
      try {
        console.log(`Processing PDF ${i + 1}/${uniqueLinks.length}: ${pdfLink.url}`);

        const urlParts = pdfLink.url.split('/');
        let originalFilename = urlParts[urlParts.length - 1];
        
        if (!originalFilename || !originalFilename.includes('.pdf')) {
          originalFilename = `${sanitizeFilename(pdfLink.text || 'document')}.pdf`;
        }

        const pdfResponse = await axios.get(pdfLink.url, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/1.0)',
            'Accept': 'application/pdf,*/*'
          },
          timeout: 30000,
          maxContentLength: 50 * 1024 * 1024
        });

        const contentType = pdfResponse.headers['content-type'] || '';
        const buffer = Buffer.from(pdfResponse.data);
        
        if (!contentType.includes('pdf') && !buffer.toString('hex', 0, 4) === '25504446') {
          throw new Error(`Invalid file type. Expected PDF, got: ${contentType}`);
        }

        const uploadResult = await uploadToS3(buffer, originalFilename);

        results.push({
          originalUrl: pdfLink.url,
          filename: originalFilename,
          linkText: pdfLink.text,
          s3Key: uploadResult.key,
          size: buffer.length,
          contentType: contentType,
          timestamp: new Date().toISOString()
        });

        console.log(`✅ Successfully processed PDF ${i + 1}/${uniqueLinks.length}: ${originalFilename}`);

      } catch (error) {
        console.error(`❌ Error processing PDF ${i + 1}/${uniqueLinks.length}:`, error.message);
        errors.push({
          url: pdfLink.url,
          linkText: pdfLink.text,
          error: error.message
        });
      }
    }

    console.log(`Process completed: ${results.length}/${uniqueLinks.length} PDFs successfully processed`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        summary: {
          total: uniqueLinks.length,
          successful: results.length,
          failed: errors.length
        },
        results: results,
        errors: errors.length > 0 ? errors : undefined,
        processedFrom: url,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Lambda execution error:', error);
    
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

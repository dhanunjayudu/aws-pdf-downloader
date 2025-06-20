import axios from 'axios';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Import mock RAG processor for demonstration
import { handler as mockRagHandler } from './mockRag.js';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const sanitizeFilename = (filename) => {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_+/g, '_').toLowerCase();
};

const sanitizeFolderName = (folderName) => {
  return folderName
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .trim();
};

const categorizeSection = (linkText, linkUrl, nearbyText) => {
  const text = (linkText + ' ' + linkUrl + ' ' + nearbyText).toLowerCase();
  
  // Define section categories based on content analysis
  if (text.includes('child welfare manual') || text.includes('cws manual') || text.includes('adoptions') || 
      text.includes('cps-assessments') || text.includes('cps-intake') || text.includes('cross-functions') || 
      text.includes('permanency-planning') || text.includes('in-home') || text.includes('icpc') || 
      text.includes('purpose') || text.includes('rams-manual') || text.includes('evidence-based-prevention')) {
    return 'child-welfare-manuals';
  }
  
  if (text.includes('appendix') || text.includes('funding') || text.includes('pregnancy-services') || 
      text.includes('case-record') || text.includes('best-practice') || text.includes('data-collection') || 
      text.includes('cpps')) {
    return 'child-welfare-appendices';
  }
  
  if (text.includes('practice') || text.includes('resource') || text.includes('guidance') || 
      text.includes('lgbtq') || text.includes('fatality') || text.includes('discipline') || 
      text.includes('substance') || text.includes('safety') || text.includes('firearm') || 
      text.includes('circles-of-safety') || text.includes('capp') || text.includes('cmep') || 
      text.includes('reasonable') || text.includes('prudent') || text.includes('youth-in-transition')) {
    return 'child-welfare-practice-resources';
  }
  
  if (text.includes('safe sleep') || text.includes('safesleep') || text.includes('sleep-comic')) {
    return 'safe-sleep-resources';
  }
  
  if (text.includes('disaster') || text.includes('county-attestation') || text.includes('disaster-plan')) {
    return 'disaster-preparedness';
  }
  
  if (text.includes('path') || text.includes('sdm') || text.includes('screening') || 
      text.includes('risk-assessment') || text.includes('safety-manual') || text.includes('fsna') || 
      text.includes('csna') || text.includes('technology-usage')) {
    return 'path-sdm-tools-manuals';
  }
  
  if (text.includes('administrative') || text.includes('dss-admin')) {
    return 'administrative-manuals';
  }
  
  // Default category for uncategorized items
  return 'other-resources';
};

const uploadToS3 = async (buffer, filename, section) => {
  const sanitizedName = sanitizeFilename(filename);
  const sanitizedSection = sanitizeFolderName(section);
  const key = `ncdhhs-pdfs/${sanitizedSection}/${sanitizedName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf',
    Metadata: {
      'upload-date': new Date().toISOString(),
      'original-name': filename,
      'source': 'ncdhhs-policies',
      'section': section,
      'last-updated': new Date().toISOString()
    }
  });

  const result = await s3Client.send(command);
  return { success: true, key: key, bucket: process.env.S3_BUCKET_NAME, etag: result.ETag };
};

export const handler = async (event) => {
  console.log('NCDHHS Lambda Handler - Processing request...');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  try {
    const { httpMethod, path } = event;
    
    // Route to RAG processor for AI-related endpoints
    if (path && (path.includes('rag-query') || path.includes('feedback') || 
                 path.includes('refine-response') || path.includes('generate-embeddings'))) {
      console.log('Routing to Mock RAG processor...');
      return await mockRagHandler(event);
    }
    
    // Original PDF processing functionality
    if (httpMethod === 'POST' && (path === '/process-pdfs' || !path)) {
      return await handlePdfProcessing(event);
    }
    
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: 'Endpoint not found' })
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

const handlePdfProcessing = async (event) => {
  console.log('Processing PDFs from NCDHHS website with section-based organization...');
  
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

  // Find all PDF links and capture surrounding context for better categorization
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
      
      // Get surrounding context for better categorization
      const parentElement = $(element).parent();
      const nearbyText = parentElement.text() + ' ' + parentElement.prev().text() + ' ' + parentElement.next().text();
      
      // Find the nearest heading for context
      let sectionHeading = '';
      const headings = parentElement.prevAll('h1, h2, h3, h4, h5, h6').first();
      if (headings.length > 0) {
        sectionHeading = headings.text().trim();
      }
      
      pdfLinks.push({
        url: fullUrl,
        text: text || 'PDF Document',
        nearbyText: nearbyText,
        sectionHeading: sectionHeading
      });
    }
  });

  // Remove duplicates based on URL
  const uniqueLinks = pdfLinks.filter((link, index, self) => 
    index === self.findIndex(l => l.url === link.url)
  );

  if (uniqueLinks.length === 0) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        success: true,
        summary: { total: 0, successful: 0, failed: 0, sections: {} },
        results: [],
        message: 'No PDF links found on the specified page'
      })
    };
  }

  console.log(`Found ${uniqueLinks.length} unique PDF links - organizing by sections`);

  const results = [];
  const errors = [];
  const sectionCounts = {};

  // Process ALL PDFs with section-based organization
  for (let i = 0; i < uniqueLinks.length; i++) {
    const pdfLink = uniqueLinks[i];
    try {
      console.log(`Processing PDF ${i + 1}/${uniqueLinks.length}: ${pdfLink.url}`);

      // Generate filename from URL
      const urlParts = pdfLink.url.split('/');
      let originalFilename = urlParts[urlParts.length - 1];
      
      if (!originalFilename || !originalFilename.includes('.pdf')) {
        originalFilename = `${sanitizeFilename(pdfLink.text || 'document')}.pdf`;
      }

      // Categorize the PDF based on content and context
      const section = categorizeSection(pdfLink.text, pdfLink.url, pdfLink.nearbyText + ' ' + pdfLink.sectionHeading);
      
      // Track section counts
      sectionCounts[section] = (sectionCounts[section] || 0) + 1;

      // Download PDF
      const pdfResponse = await axios.get(pdfLink.url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/1.0)',
          'Accept': 'application/pdf,*/*'
        },
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024
      });

      // Verify it's a PDF
      const contentType = pdfResponse.headers['content-type'] || '';
      const buffer = Buffer.from(pdfResponse.data);
      
      if (!contentType.includes('pdf') && !buffer.toString('hex', 0, 4) === '25504446') {
        throw new Error(`Invalid file type. Expected PDF, got: ${contentType}`);
      }

      // Upload to S3 with section-based organization
      const uploadResult = await uploadToS3(buffer, originalFilename, section);

      results.push({
        originalUrl: pdfLink.url,
        filename: originalFilename,
        linkText: pdfLink.text,
        section: section,
        s3Key: uploadResult.key,
        size: buffer.length,
        contentType: contentType,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Successfully processed PDF ${i + 1}/${uniqueLinks.length}: ${originalFilename} → ${section}/`);

    } catch (error) {
      console.error(`❌ Error processing PDF ${i + 1}/${uniqueLinks.length}:`, error.message);
      errors.push({
        url: pdfLink.url,
        linkText: pdfLink.text,
        error: error.message
      });
    }
  }

  console.log(`Process completed: ${results.length}/${uniqueLinks.length} PDFs successfully organized into sections`);
  console.log('Section distribution:', sectionCounts);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      success: true,
      summary: {
        total: uniqueLinks.length,
        successful: results.length,
        failed: errors.length,
        sections: sectionCounts
      },
      results: results,
      errors: errors.length > 0 ? errors : undefined,
      processedFrom: url,
      timestamp: new Date().toISOString()
    })
  };
};

"""
NCDHHS PDF Processor - Python Implementation
Converts the Node.js Lambda function to Python
"""

import os
import re
import json
import boto3
import requests
from datetime import datetime
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from typing import Dict, List, Tuple, Optional
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class NCDHHSPDFProcessor:
    def __init__(self, bucket_name: str = None, region: str = 'us-east-1'):
        """Initialize the PDF processor with AWS clients"""
        self.region = region
        self.bucket_name = bucket_name or os.getenv('S3_BUCKET_NAME', 'ncdhhs-cwis-policy-manuals')
        
        # Initialize AWS clients
        self.s3_client = boto3.client('s3', region_name=self.region)
        
        # Request session for better performance
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (compatible; NCDHHS-PDF-Downloader/2.0)'
        })

    def sanitize_filename(self, filename: str) -> str:
        """Sanitize filename for S3 storage"""
        # Remove invalid characters and replace with underscores
        sanitized = re.sub(r'[^a-zA-Z0-9.-]', '_', filename)
        # Remove multiple underscores
        sanitized = re.sub(r'_+', '_', sanitized)
        return sanitized.lower()

    def sanitize_folder_name(self, folder_name: str) -> str:
        """Sanitize folder name for S3 storage"""
        # Remove invalid characters
        sanitized = re.sub(r'[^a-zA-Z0-9\s-]', '', folder_name)
        # Replace spaces with hyphens
        sanitized = re.sub(r'\s+', '-', sanitized)
        # Remove multiple hyphens
        sanitized = re.sub(r'-+', '-', sanitized)
        return sanitized.lower().strip()

    def categorize_section(self, link_text: str, link_url: str, nearby_text: str) -> str:
        """Categorize PDF based on content analysis"""
        text = f"{link_text} {link_url} {nearby_text}".lower()
        
        # Child welfare manuals
        if any(keyword in text for keyword in [
            'child welfare manual', 'cws manual', 'adoptions',
            'cps-assessments', 'cps-intake', 'cross-functions',
            'permanency-planning', 'in-home', 'icpc',
            'purpose', 'rams-manual', 'evidence-based-prevention'
        ]):
            return 'child-welfare-manuals'
        
        # Appendices
        if any(keyword in text for keyword in [
            'appendix', 'funding', 'pregnancy-services',
            'case-record', 'best-practice', 'data-collection', 'cpps'
        ]):
            return 'child-welfare-appendices'
        
        # Practice resources
        if any(keyword in text for keyword in [
            'practice', 'resource', 'guidance', 'lgbtq', 'fatality',
            'discipline', 'substance', 'safety', 'firearm',
            'circles-of-safety', 'capp', 'cmep', 'reasonable',
            'prudent', 'youth-in-transition'
        ]):
            return 'child-welfare-practice-resources'
        
        # Safe sleep resources
        if any(keyword in text for keyword in ['safe sleep', 'safesleep', 'sleep-comic']):
            return 'safe-sleep-resources'
        
        # Disaster preparedness
        if any(keyword in text for keyword in ['disaster', 'county-attestation', 'disaster-plan']):
            return 'disaster-preparedness'
        
        # PATH/SDM tools
        if any(keyword in text for keyword in [
            'path', 'sdm', 'screening', 'risk-assessment',
            'safety-manual', 'fsna', 'csna', 'technology-usage'
        ]):
            return 'path-sdm-tools-manuals'
        
        # Administrative manuals
        if any(keyword in text for keyword in ['administrative', 'dss-admin']):
            return 'administrative-manuals'
        
        # Default category
        return 'other-resources'

    def discover_pdf_links(self, url: str) -> List[Dict]:
        """Discover all PDF links from a webpage"""
        logger.info(f"Discovering PDF links from: {url}")
        
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            pdf_links = []
            
            # Find all PDF links
            for link in soup.find_all('a', href=True):
                href = link['href']
                if href.endswith('.pdf') or '.pdf' in href:
                    # Get link text and surrounding context
                    link_text = link.get_text(strip=True) or 'PDF Document'
                    
                    # Get nearby text for better categorization
                    parent = link.parent
                    nearby_text = ''
                    if parent:
                        nearby_text = parent.get_text(strip=True)
                        # Also check previous and next siblings
                        if parent.previous_sibling:
                            nearby_text += ' ' + str(parent.previous_sibling)
                        if parent.next_sibling:
                            nearby_text += ' ' + str(parent.next_sibling)
                    
                    # Find nearest heading for context
                    section_heading = ''
                    current = link
                    for _ in range(10):  # Look up to 10 levels up
                        current = current.parent
                        if not current:
                            break
                        heading = current.find_previous(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
                        if heading:
                            section_heading = heading.get_text(strip=True)
                            break
                    
                    # Convert relative URLs to absolute
                    full_url = urljoin(url, href)
                    
                    pdf_links.append({
                        'url': full_url,
                        'text': link_text,
                        'nearby_text': nearby_text,
                        'section_heading': section_heading
                    })
            
            # Remove duplicates based on URL
            unique_links = []
            seen_urls = set()
            for link in pdf_links:
                if link['url'] not in seen_urls:
                    unique_links.append(link)
                    seen_urls.add(link['url'])
            
            logger.info(f"Found {len(unique_links)} unique PDF links")
            return unique_links
            
        except Exception as e:
            logger.error(f"Error discovering PDF links: {str(e)}")
            raise

    def upload_to_s3(self, content: bytes, filename: str, section: str) -> Dict:
        """Upload PDF content to S3 with proper organization"""
        sanitized_name = self.sanitize_filename(filename)
        sanitized_section = self.sanitize_folder_name(section)
        key = f"ncdhhs-pdfs/{sanitized_section}/{sanitized_name}"
        
        try:
            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=content,
                ContentType='application/pdf',
                Metadata={
                    'upload-date': datetime.now().isoformat(),
                    'original-name': filename,
                    'source': 'ncdhhs-policies',
                    'section': section,
                    'last-updated': datetime.now().isoformat()
                }
            )
            
            logger.info(f"Successfully uploaded: {key}")
            return {
                'success': True,
                'key': key,
                'bucket': self.bucket_name
            }
            
        except Exception as e:
            logger.error(f"Error uploading to S3: {str(e)}")
            raise

    def download_pdf(self, url: str) -> Tuple[bytes, str]:
        """Download PDF from URL and return content with content type"""
        try:
            response = self.session.get(
                url,
                timeout=30,
                headers={'Accept': 'application/pdf,*/*'}
            )
            response.raise_for_status()
            
            # Verify it's a PDF
            content_type = response.headers.get('content-type', '').lower()
            content = response.content
            
            # Check PDF magic number
            if not content.startswith(b'%PDF') and 'pdf' not in content_type:
                raise ValueError(f"Invalid file type. Expected PDF, got: {content_type}")
            
            return content, content_type
            
        except Exception as e:
            logger.error(f"Error downloading PDF from {url}: {str(e)}")
            raise

    def process_pdfs(self, url: str) -> Dict:
        """Main method to process PDFs from a website"""
        logger.info(f"Starting PDF processing for: {url}")
        
        try:
            # Discover PDF links
            pdf_links = self.discover_pdf_links(url)
            
            if not pdf_links:
                return {
                    'success': True,
                    'summary': {'total': 0, 'successful': 0, 'failed': 0, 'sections': {}},
                    'results': [],
                    'message': 'No PDF links found on the specified page'
                }
            
            results = []
            errors = []
            section_counts = {}
            
            # Process each PDF
            for i, pdf_link in enumerate(pdf_links):
                try:
                    logger.info(f"Processing PDF {i + 1}/{len(pdf_links)}: {pdf_link['url']}")
                    
                    # Generate filename from URL
                    parsed_url = urlparse(pdf_link['url'])
                    original_filename = os.path.basename(parsed_url.path)
                    
                    if not original_filename or not original_filename.endswith('.pdf'):
                        original_filename = f"{self.sanitize_filename(pdf_link['text'] or 'document')}.pdf"
                    
                    # Categorize the PDF
                    section = self.categorize_section(
                        pdf_link['text'],
                        pdf_link['url'],
                        pdf_link['nearby_text'] + ' ' + pdf_link['section_heading']
                    )
                    
                    # Track section counts
                    section_counts[section] = section_counts.get(section, 0) + 1
                    
                    # Download PDF
                    content, content_type = self.download_pdf(pdf_link['url'])
                    
                    # Upload to S3
                    upload_result = self.upload_to_s3(content, original_filename, section)
                    
                    results.append({
                        'original_url': pdf_link['url'],
                        'filename': original_filename,
                        'link_text': pdf_link['text'],
                        'section': section,
                        's3_key': upload_result['key'],
                        'size': len(content),
                        'content_type': content_type,
                        'timestamp': datetime.now().isoformat()
                    })
                    
                    logger.info(f"✅ Successfully processed: {original_filename} → {section}/")
                    
                except Exception as e:
                    logger.error(f"❌ Error processing PDF {i + 1}/{len(pdf_links)}: {str(e)}")
                    errors.append({
                        'url': pdf_link['url'],
                        'link_text': pdf_link['text'],
                        'error': str(e)
                    })
            
            logger.info(f"Process completed: {len(results)}/{len(pdf_links)} PDFs successfully organized")
            logger.info(f"Section distribution: {section_counts}")
            
            return {
                'success': True,
                'summary': {
                    'total': len(pdf_links),
                    'successful': len(results),
                    'failed': len(errors),
                    'sections': section_counts
                },
                'results': results,
                'errors': errors if errors else None,
                'processed_from': url,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"PDF processing error: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }

# Lambda handler function for AWS Lambda deployment
def lambda_handler(event, context):
    """AWS Lambda handler function"""
    try:
        # Parse the event
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event
        
        url = body.get('url')
        if not url:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'success': False,
                    'error': 'URL is required'
                })
            }
        
        # Initialize processor
        processor = NCDHHSPDFProcessor()
        
        # Process PDFs
        result = processor.process_pdfs(url)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(result)
        }
        
    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            })
        }

# For local testing
if __name__ == "__main__":
    # Test the processor locally
    processor = NCDHHSPDFProcessor()
    test_url = "https://policies.ncdhhs.gov/divisional-n-z/social-services/child-welfare-services/cws-policies-manuals/"
    result = processor.process_pdfs(test_url)
    print(json.dumps(result, indent=2))

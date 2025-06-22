"""
Unit tests for PDF Processor
"""

import pytest
import json
from unittest.mock import Mock, patch, MagicMock
from src.pdf_processor import NCDHHSPDFProcessor, lambda_handler

class TestNCDHHSPDFProcessor:
    
    def setup_method(self):
        """Setup test fixtures"""
        self.processor = NCDHHSPDFProcessor(bucket_name='test-bucket')
    
    def test_sanitize_filename(self):
        """Test filename sanitization"""
        # Test normal filename
        assert self.processor.sanitize_filename('test-file.pdf') == 'test-file.pdf'
        
        # Test filename with special characters
        assert self.processor.sanitize_filename('test file@#$.pdf') == 'test_file___.pdf'
        
        # Test filename with multiple underscores
        assert self.processor.sanitize_filename('test___file.pdf') == 'test_file.pdf'
    
    def test_sanitize_folder_name(self):
        """Test folder name sanitization"""
        # Test normal folder name
        assert self.processor.sanitize_folder_name('child welfare') == 'child-welfare'
        
        # Test folder name with special characters
        assert self.processor.sanitize_folder_name('child@welfare#') == 'child-welfare'
        
        # Test folder name with multiple spaces/hyphens
        assert self.processor.sanitize_folder_name('child   welfare---manual') == 'child-welfare-manual'
    
    def test_categorize_section(self):
        """Test PDF categorization logic"""
        # Test CPS assessment categorization
        result = self.processor.categorize_section(
            'CPS Assessment Manual', 
            'cps-assessments.pdf', 
            'child welfare manual'
        )
        assert result == 'child-welfare-manuals'
        
        # Test adoption categorization
        result = self.processor.categorize_section(
            'Adoption Services', 
            'adoptions.pdf', 
            'adoption procedures'
        )
        assert result == 'child-welfare-manuals'
        
        # Test safe sleep categorization
        result = self.processor.categorize_section(
            'Safe Sleep Guidelines', 
            'safe-sleep.pdf', 
            'SIDS prevention'
        )
        assert result == 'safe-sleep-resources'
        
        # Test default categorization
        result = self.processor.categorize_section(
            'Unknown Document', 
            'unknown.pdf', 
            'random text'
        )
        assert result == 'other-resources'
    
    @patch('src.pdf_processor.requests.Session')
    def test_discover_pdf_links(self, mock_session):
        """Test PDF link discovery"""
        # Mock HTML response
        mock_response = Mock()
        mock_response.content = b'''
        <html>
            <body>
                <a href="test1.pdf">Test PDF 1</a>
                <a href="/path/test2.pdf">Test PDF 2</a>
                <a href="https://example.com/test3.pdf">Test PDF 3</a>
                <a href="not-a-pdf.txt">Not a PDF</a>
            </body>
        </html>
        '''
        mock_response.raise_for_status = Mock()
        
        mock_session_instance = Mock()
        mock_session_instance.get.return_value = mock_response
        mock_session.return_value = mock_session_instance
        
        # Test discovery
        links = self.processor.discover_pdf_links('https://example.com')
        
        # Should find 3 PDF links
        assert len(links) == 3
        assert any('test1.pdf' in link['url'] for link in links)
        assert any('test2.pdf' in link['url'] for link in links)
        assert any('test3.pdf' in link['url'] for link in links)
    
    @patch('src.pdf_processor.boto3.client')
    def test_upload_to_s3(self, mock_boto3):
        """Test S3 upload functionality"""
        # Mock S3 client
        mock_s3_client = Mock()
        mock_boto3.return_value = mock_s3_client
        
        # Test upload
        content = b'fake pdf content'
        result = self.processor.upload_to_s3(content, 'test.pdf', 'test-section')
        
        # Verify S3 client was called
        mock_s3_client.put_object.assert_called_once()
        
        # Verify result
        assert result['success'] is True
        assert 'test-section' in result['key']
        assert 'test.pdf' in result['key']
    
    @patch('src.pdf_processor.requests.Session')
    def test_download_pdf(self, mock_session):
        """Test PDF download functionality"""
        # Mock PDF response
        mock_response = Mock()
        mock_response.content = b'%PDF-1.4 fake pdf content'
        mock_response.headers = {'content-type': 'application/pdf'}
        mock_response.raise_for_status = Mock()
        
        mock_session_instance = Mock()
        mock_session_instance.get.return_value = mock_response
        mock_session.return_value = mock_session_instance
        
        # Test download
        content, content_type = self.processor.download_pdf('https://example.com/test.pdf')
        
        assert content == b'%PDF-1.4 fake pdf content'
        assert content_type == 'application/pdf'
    
    @patch('src.pdf_processor.requests.Session')
    def test_download_pdf_invalid_content(self, mock_session):
        """Test PDF download with invalid content"""
        # Mock non-PDF response
        mock_response = Mock()
        mock_response.content = b'not a pdf'
        mock_response.headers = {'content-type': 'text/html'}
        mock_response.raise_for_status = Mock()
        
        mock_session_instance = Mock()
        mock_session_instance.get.return_value = mock_response
        mock_session.return_value = mock_session_instance
        
        # Test download should raise error
        with pytest.raises(ValueError, match="Invalid file type"):
            self.processor.download_pdf('https://example.com/test.pdf')
    
    @patch.object(NCDHHSPDFProcessor, 'upload_to_s3')
    @patch.object(NCDHHSPDFProcessor, 'download_pdf')
    @patch.object(NCDHHSPDFProcessor, 'discover_pdf_links')
    def test_process_pdfs_success(self, mock_discover, mock_download, mock_upload):
        """Test successful PDF processing"""
        # Mock discovered links
        mock_discover.return_value = [
            {
                'url': 'https://example.com/test1.pdf',
                'text': 'Test PDF 1',
                'nearby_text': 'CPS assessment',
                'section_heading': 'Child Welfare'
            }
        ]
        
        # Mock download
        mock_download.return_value = (b'%PDF fake content', 'application/pdf')
        
        # Mock upload
        mock_upload.return_value = {
            'success': True,
            'key': 'ncdhhs-pdfs/child-welfare-manuals/test1.pdf'
        }
        
        # Test processing
        result = self.processor.process_pdfs('https://example.com')
        
        # Verify result
        assert result['success'] is True
        assert result['summary']['total'] == 1
        assert result['summary']['successful'] == 1
        assert result['summary']['failed'] == 0
        assert len(result['results']) == 1
    
    @patch.object(NCDHHSPDFProcessor, 'discover_pdf_links')
    def test_process_pdfs_no_links(self, mock_discover):
        """Test PDF processing with no links found"""
        # Mock no links found
        mock_discover.return_value = []
        
        # Test processing
        result = self.processor.process_pdfs('https://example.com')
        
        # Verify result
        assert result['success'] is True
        assert result['summary']['total'] == 0
        assert 'No PDF links found' in result['message']

class TestLambdaHandler:
    
    @patch.object(NCDHHSPDFProcessor, 'process_pdfs')
    def test_lambda_handler_success(self, mock_process):
        """Test Lambda handler with successful processing"""
        # Mock successful processing
        mock_process.return_value = {
            'success': True,
            'summary': {'total': 1, 'successful': 1, 'failed': 0}
        }
        
        # Test event
        event = {
            'body': json.dumps({'url': 'https://example.com'})
        }
        
        # Call handler
        result = lambda_handler(event, None)
        
        # Verify result
        assert result['statusCode'] == 200
        response_body = json.loads(result['body'])
        assert response_body['success'] is True
    
    def test_lambda_handler_missing_url(self):
        """Test Lambda handler with missing URL"""
        # Test event without URL
        event = {
            'body': json.dumps({})
        }
        
        # Call handler
        result = lambda_handler(event, None)
        
        # Verify error response
        assert result['statusCode'] == 400
        response_body = json.loads(result['body'])
        assert response_body['success'] is False
        assert 'URL is required' in response_body['error']
    
    @patch.object(NCDHHSPDFProcessor, 'process_pdfs')
    def test_lambda_handler_processing_error(self, mock_process):
        """Test Lambda handler with processing error"""
        # Mock processing error
        mock_process.side_effect = Exception('Processing failed')
        
        # Test event
        event = {
            'body': json.dumps({'url': 'https://example.com'})
        }
        
        # Call handler
        result = lambda_handler(event, None)
        
        # Verify error response
        assert result['statusCode'] == 500
        response_body = json.loads(result['body'])
        assert response_body['success'] is False
        assert 'Processing failed' in response_body['error']

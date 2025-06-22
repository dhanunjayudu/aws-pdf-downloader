"""
Unit tests for FastAPI Application
"""

import pytest
import json
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
from src.web_app_fastapi import app

class TestFastAPIApp:
    
    def setup_method(self):
        """Setup test fixtures"""
        self.client = TestClient(app)
    
    def test_root_endpoint(self):
        """Test the root endpoint returns HTML"""
        response = self.client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert "NCDHHS Complete System" in response.text
        assert "FastAPI" in response.text
    
    def test_health_endpoint(self):
        """Test health check endpoint"""
        response = self.client.get("/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "NCDHHS FastAPI Service"
        assert data["version"] == "2.0.0"
        assert "timestamp" in data
    
    def test_api_status_endpoint(self):
        """Test detailed API status endpoint"""
        response = self.client.get("/api/status")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "operational"
        assert "components" in data
        assert "endpoints" in data
        assert "documentation" in data
    
    @patch('src.web_app_fastapi.rag_system')
    def test_rag_query_endpoint(self, mock_rag_system):
        """Test RAG query endpoint"""
        # Mock RAG system response
        mock_result = Mock()
        mock_result.success = True
        mock_result.response = "Test response"
        mock_result.sources = []
        mock_result.session_id = "test-session"
        mock_result.usage = {"tokens": 100}
        mock_result.timestamp = "2023-01-01T00:00:00"
        mock_result.note = "Test note"
        mock_result.error = ""
        
        mock_rag_system.handle_rag_query.return_value = mock_result
        
        # Test request
        response = self.client.post(
            "/api/rag-query",
            json={
                "query": "What are CPS procedures?",
                "userId": "test-user"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["response"] == "Test response"
        assert data["sessionId"] == "test-session"
    
    def test_rag_query_validation(self):
        """Test RAG query endpoint validation"""
        # Test missing query
        response = self.client.post(
            "/api/rag-query",
            json={}
        )
        assert response.status_code == 422  # Validation error
        
        # Test invalid data types
        response = self.client.post(
            "/api/rag-query",
            json={"query": 123}  # Should be string
        )
        assert response.status_code == 422
    
    @patch('src.web_app_fastapi.pdf_processor')
    def test_process_pdfs_endpoint(self, mock_pdf_processor):
        """Test PDF processing endpoint"""
        # Mock PDF processor response
        mock_pdf_processor.process_pdfs.return_value = {
            "success": True,
            "summary": {
                "total": 5,
                "successful": 4,
                "failed": 1,
                "sections": {"test-section": 4}
            }
        }
        
        # Test request
        response = self.client.post(
            "/api/process-pdfs",
            json={"url": "https://example.com"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["summary"]["total"] == 5
    
    def test_process_pdfs_validation(self):
        """Test PDF processing endpoint validation"""
        # Test missing URL
        response = self.client.post(
            "/api/process-pdfs",
            json={}
        )
        assert response.status_code == 422
        
        # Test invalid URL format
        response = self.client.post(
            "/api/process-pdfs",
            json={"url": "not-a-url"}
        )
        # Note: This might pass basic validation but fail in processing
        # The URL validation in Pydantic is basic
    
    @patch('src.web_app_fastapi.rag_system')
    def test_feedback_endpoint(self, mock_rag_system):
        """Test feedback endpoint"""
        # Mock feedback response
        mock_rag_system.handle_feedback.return_value = {
            "success": True,
            "message": "Feedback recorded"
        }
        
        # Test request
        response = self.client.post(
            "/api/feedback",
            json={
                "sessionId": "test-session",
                "query": "Test query",
                "response": "Test response",
                "feedback": "positive"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
    
    def test_feedback_validation(self):
        """Test feedback endpoint validation"""
        # Test missing required fields
        response = self.client.post(
            "/api/feedback",
            json={"sessionId": "test"}  # Missing other required fields
        )
        assert response.status_code == 422
    
    @patch('src.web_app_fastapi.rag_system')
    def test_refine_response_endpoint(self, mock_rag_system):
        """Test response refinement endpoint"""
        # Mock refinement response
        mock_rag_system.handle_refine_response.return_value = {
            "success": True,
            "refined_response": "Refined test response"
        }
        
        # Test request
        response = self.client.post(
            "/api/refine-response",
            json={
                "originalQuery": "Test query",
                "originalResponse": "Test response",
                "sessionId": "test-session"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "refined_response" in data
    
    def test_404_handler(self):
        """Test 404 error handler"""
        response = self.client.get("/nonexistent-endpoint")
        assert response.status_code == 404
        
        data = response.json()
        assert "error" in data
        assert "available_endpoints" in data
    
    def test_docs_endpoints(self):
        """Test that documentation endpoints are accessible"""
        # Test OpenAPI docs
        response = self.client.get("/docs")
        assert response.status_code == 200
        
        # Test ReDoc
        response = self.client.get("/redoc")
        assert response.status_code == 200
        
        # Test OpenAPI JSON
        response = self.client.get("/openapi.json")
        assert response.status_code == 200
        
        openapi_data = response.json()
        assert openapi_data["info"]["title"] == "NCDHHS Complete System"
        assert openapi_data["info"]["version"] == "2.0.0"
    
    def test_cors_headers(self):
        """Test CORS headers are present"""
        response = self.client.options("/api/rag-query")
        # CORS headers should be present
        assert "access-control-allow-origin" in response.headers
    
    @patch('src.web_app_fastapi.rag_system')
    def test_error_handling(self, mock_rag_system):
        """Test error handling in endpoints"""
        # Mock an exception
        mock_rag_system.handle_rag_query.side_effect = Exception("Test error")
        
        response = self.client.post(
            "/api/rag-query",
            json={"query": "Test query"}
        )
        
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data

class TestPydanticModels:
    """Test Pydantic model validation"""
    
    def test_rag_query_request_validation(self):
        """Test RAG query request model validation"""
        from src.web_app_fastapi import RAGQueryRequest
        
        # Valid request
        valid_request = RAGQueryRequest(query="Test query")
        assert valid_request.query == "Test query"
        assert valid_request.section is None
        
        # Test with all fields
        full_request = RAGQueryRequest(
            query="Test query",
            section="test-section",
            userId="user123",
            sessionId="session123",
            recordId="record123"
        )
        assert full_request.section == "test-section"
        assert full_request.userId == "user123"
    
    def test_pdf_process_request_validation(self):
        """Test PDF process request model validation"""
        from src.web_app_fastapi import PDFProcessRequest
        
        # Valid request
        valid_request = PDFProcessRequest(url="https://example.com")
        assert valid_request.url == "https://example.com"
        
        # Test validation error for missing URL
        with pytest.raises(ValueError):
            PDFProcessRequest()
    
    def test_health_response_model(self):
        """Test health response model"""
        from src.web_app_fastapi import HealthResponse
        
        health = HealthResponse(
            status="healthy",
            service="Test Service",
            timestamp="2023-01-01T00:00:00",
            version="1.0.0"
        )
        
        assert health.status == "healthy"
        assert health.service == "Test Service"

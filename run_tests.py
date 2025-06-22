#!/usr/bin/env python3
"""
Test runner for NCDHHS Python Service
"""

import sys
import subprocess
import os

def run_tests():
    """Run all tests and display results"""
    print("🧪 Running NCDHHS Python Service Tests")
    print("=" * 50)
    
    # Change to project directory
    project_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(project_dir)
    
    # Install test dependencies if needed
    print("📦 Installing test dependencies...")
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'pytest', 'pytest-mock', 'moto'], 
                   capture_output=True)
    
    # Run tests
    print("🔍 Running unit tests...")
    result = subprocess.run([sys.executable, '-m', 'pytest', 'tests/', '-v'], 
                           capture_output=True, text=True)
    
    print(result.stdout)
    if result.stderr:
        print("Errors:")
        print(result.stderr)
    
    # Test imports
    print("\n📋 Testing module imports...")
    try:
        from src.pdf_processor import NCDHHSPDFProcessor
        from src.rag_system import NCDHHSRAGSystem
        from src.web_app import app
        print("✅ All modules imported successfully")
    except ImportError as e:
        print(f"❌ Import error: {e}")
        return False
    
    # Test basic functionality
    print("\n🧪 Testing basic functionality...")
    try:
        # Test PDF processor initialization
        processor = NCDHHSPDFProcessor()
        print("✅ PDF Processor initialized")
        
        # Test RAG system initialization
        rag_system = NCDHHSRAGSystem()
        print("✅ RAG System initialized")
        
        # Test filename sanitization
        sanitized = processor.sanitize_filename("test@file#.pdf")
        assert sanitized == "test_file_.pdf"
        print("✅ Filename sanitization working")
        
        # Test categorization
        category = processor.categorize_section("CPS Assessment", "cps.pdf", "child welfare")
        assert category == "child-welfare-manuals"
        print("✅ PDF categorization working")
        
        # Test mock RAG response
        response = rag_system.generate_mock_response("What are CPS procedures?")
        assert len(response) > 100
        print("✅ Mock RAG responses working")
        
    except Exception as e:
        print(f"❌ Functionality test failed: {e}")
        return False
    
    print("\n🎉 All tests completed successfully!")
    return result.returncode == 0

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)

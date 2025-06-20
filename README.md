# NCDHHS PDF Processor

🚀 **Intelligent PDF Processing System** for North Carolina Department of Health and Human Services (NCDHHS) Child Welfare Services documents.

## 🌟 Features

- **Dynamic PDF Discovery**: Automatically finds ALL PDFs on any NCDHHS webpage
- **Intelligent Section Organization**: Categorizes PDFs into logical folders:
  - `child-welfare-manuals/` - Core policy manuals
  - `child-welfare-practice-resources/` - Practice guides and resources
  - `child-welfare-appendices/` - Appendix documents and funding guides
  - `path-sdm-tools-manuals/` - PATH assessments and SDM tools
  - `safe-sleep-resources/` - Safe sleep policies and materials
  - `disaster-preparedness/` - Emergency planning documents
  - `administrative-manuals/` - Administrative policies
  - `other-resources/` - Miscellaneous documents
- **AWS S3 Storage**: Organized cloud storage with metadata
- **Real-time Processing**: Live status updates and progress tracking
- **Error Resilience**: Continues processing even if individual files fail
- **Scalable Architecture**: Handles any number of PDFs automatically

## 🏗️ Architecture

- **Frontend**: React.js application for user interface
- **Backend**: AWS Lambda function for PDF processing
- **Storage**: AWS S3 with intelligent folder organization
- **API**: AWS API Gateway for secure communication

## 🚀 Quick Start

### Process PDFs from NCDHHS Website

```bash
curl -X POST https://cqdhmncpzi.execute-api.us-east-1.amazonaws.com/prod/process-pdfs \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://policies.ncdhhs.gov/divisional-n-z/social-services/child-welfare-services/cws-policies-manuals/"}'
```

### Example Response

```json
{
  "success": true,
  "summary": {
    "total": 53,
    "successful": 52,
    "failed": 1,
    "sections": {
      "child-welfare-manuals": 10,
      "child-welfare-practice-resources": 18,
      "child-welfare-appendices": 12,
      "path-sdm-tools-manuals": 5,
      "safe-sleep-resources": 2,
      "disaster-preparedness": 3,
      "administrative-manuals": 1,
      "other-resources": 1
    }
  }
}
```

## 📁 Repository Structure

```
├── lambda/                    # AWS Lambda function
│   ├── processPDFs.js        # Main processing logic
│   ├── package.json          # Lambda dependencies
│   └── node_modules/         # Lambda dependencies
├── src/                      # Frontend application
│   ├── App.jsx              # Main React component
│   ├── App.css              # Styling
│   ├── main.jsx             # React entry point
│   ├── index.css            # Global styles
│   └── utils/
│       └── pdfProcessor.js   # API communication
├── package.json              # Frontend dependencies
├── .gitignore               # Git ignore rules
└── README.md                # This file
```

## 🔧 Development

### Lambda Function

The core processing logic is in `lambda/processPDFs.js`. It:

1. **Discovers PDFs**: Scrapes the provided URL for PDF links
2. **Categorizes Content**: Uses intelligent analysis to determine section
3. **Downloads Files**: Retrieves each PDF with error handling
4. **Organizes Storage**: Uploads to S3 with proper folder structure
5. **Reports Results**: Provides detailed processing summary

### Frontend Application

The React frontend provides a user-friendly interface for:

- Entering NCDHHS URLs to process
- Monitoring real-time processing status
- Viewing detailed results and statistics
- Managing processed documents

## 🌐 Live Processing

The system is currently processing PDFs from:
- **NCDHHS Child Welfare Services**: 53 PDFs organized into 8 sections
- **S3 Bucket**: `ncdhhs-cwis-policy-manuals`
- **API Endpoint**: `https://cqdhmncpzi.execute-api.us-east-1.amazonaws.com/prod`

## 📊 Processing Statistics

- **Success Rate**: 98.1% (52/53 PDFs processed successfully)
- **Processing Speed**: ~13 seconds for 53 PDFs
- **Storage Organization**: 8 logical sections with clean folder structure
- **Scalability**: Handles any number of PDFs dynamically

## 🔒 Security & Best Practices

- **AWS IAM**: Proper role-based access control
- **Error Handling**: Comprehensive error catching and reporting
- **File Validation**: PDF format verification before processing
- **Metadata Tracking**: Complete audit trail for all processed files
- **Clean Naming**: Sanitized filenames and folder names

## 🎯 Perfect For

- **Document Management**: Automated organization of policy documents
- **Compliance**: Systematic storage of regulatory materials
- **Research**: Easy access to categorized resources
- **Archival**: Long-term storage with proper organization

---

**Built with ❤️ for efficient document management and organization**

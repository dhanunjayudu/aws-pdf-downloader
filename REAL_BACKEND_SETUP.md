# 🚀 Real Backend Implementation Guide

## 🎯 **Current Status**
✅ **Demo Working**: Your app shows realistic PDF processing simulation
✅ **Lambda Code Ready**: Real PDF processing function created
✅ **Ready for Production**: Time to connect to actual NCDHHS website

## 🏗️ **Backend Architecture**

```
React App (Amplify) → API Gateway → Lambda Function → S3 Bucket
                                         ↓
                              NCDHHS Website Scraping
```

## 🛠️ **Implementation Steps**

### **Step 1: Create S3 Bucket**

1. **Go to S3 Console**: https://console.aws.amazon.com/s3/
2. **Create bucket**:
   - Name: `ncdhhs-pdf-storage-[your-unique-suffix]`
   - Region: `us-east-1` (same as your other resources)
   - Block public access: Keep enabled (secure)
   - Versioning: Enable (recommended)

### **Step 2: Create Lambda Function**

1. **Go to Lambda Console**: https://console.aws.amazon.com/lambda/
2. **Create function**:
   - Name: `ncdhhs-pdf-processor`
   - Runtime: `Node.js 18.x`
   - Architecture: `x86_64`
   - Execution role: Create new role with basic Lambda permissions

3. **Upload code**:
   - Copy the code from `lambda/processPDFs.js`
   - Or create deployment package:
   ```bash
   cd lambda/
   npm install
   zip -r ../lambda-deployment.zip .
   ```

4. **Configure function**:
   - Timeout: `15 minutes` (maximum)
   - Memory: `1024 MB` (for PDF processing)
   - Environment variables:
     - `S3_BUCKET_NAME`: Your S3 bucket name
     - `AWS_REGION`: `us-east-1`

### **Step 3: Set IAM Permissions**

Add these permissions to your Lambda execution role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### **Step 4: Create API Gateway**

1. **Go to API Gateway Console**: https://console.aws.amazon.com/apigateway/
2. **Create REST API**:
   - Name: `ncdhhs-pdf-api`
   - Type: Regional

3. **Create resource and method**:
   - Resource: `/process-pdfs`
   - Method: `POST`
   - Integration: Lambda Function
   - Lambda Function: `ncdhhs-pdf-processor`

4. **Enable CORS**:
   - Actions → Enable CORS
   - Access-Control-Allow-Origin: `*` (or your Amplify domain)
   - Access-Control-Allow-Headers: `Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token`

5. **Deploy API**:
   - Actions → Deploy API
   - Stage: `prod`
   - Note the API URL: `https://your-api-id.execute-api.us-east-1.amazonaws.com/prod`

### **Step 5: Update Frontend**

Update `src/utils/pdfProcessor.js`:

```javascript
// Replace the API_BASE_URL with your actual API Gateway URL
const API_BASE_URL = 'https://your-api-id.execute-api.us-east-1.amazonaws.com/prod';

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
```

Update `src/App.jsx` to use real API:

```javascript
// Replace mockProcessPDFs with processPDFs
import { processPDFs } from './utils/pdfProcessor'

// In handleDownload function:
const result = await processPDFs(URL, (progressMessage) => {
  setProgress(progressMessage)
})
```

## 🧪 **Testing Steps**

### **Test Lambda Function**
```json
{
  "body": "{\"url\":\"https://policies.ncdhhs.gov/divisional-n-z/social-services/child-welfare-services/cws-policies-manuals/\"}"
}
```

### **Test API Gateway**
```bash
curl -X POST https://your-api-id.execute-api.us-east-1.amazonaws.com/prod/process-pdfs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://policies.ncdhhs.gov/divisional-n-z/social-services/child-welfare-services/cws-policies-manuals/"}'
```

## 📊 **Expected Real Results**

Once connected to the real backend, your app will:

✅ **Scrape actual NCDHHS website**
✅ **Find real PDF files** (policies, manuals, forms)
✅ **Download actual PDFs** (may find 10-50+ files)
✅ **Upload to your S3 bucket**
✅ **Show real file names and sizes**
✅ **Handle real errors** (broken links, access issues)

## 💰 **Cost Estimate (Real Backend)**

- **Lambda**: ~$0.20 per 1M requests + compute time
- **API Gateway**: ~$3.50 per 1M requests  
- **S3 Storage**: ~$0.023 per GB/month
- **Data Transfer**: ~$0.09 per GB

**Estimated monthly cost**: $5-20 for typical usage

## 🚨 **Important Considerations**

### **Rate Limiting**
- NCDHHS website may have rate limits
- Add delays between requests if needed
- Monitor for 429 (Too Many Requests) errors

### **File Size Limits**
- Lambda payload limit: 6MB (synchronous)
- Use S3 direct upload for larger files
- Current limit set to 50MB per PDF

### **Timeout Handling**
- Lambda timeout: 15 minutes maximum
- Process in batches if many PDFs found
- Consider Step Functions for complex workflows

## 🔄 **Deployment Process**

1. **Set up AWS resources** (S3, Lambda, API Gateway)
2. **Update frontend code** with real API URL
3. **Test thoroughly** with small batches first
4. **Deploy to production**
5. **Monitor CloudWatch logs** for issues

## 📞 **Need Help?**

I can help you:
- Set up the AWS resources
- Debug any deployment issues
- Optimize performance
- Add additional features

Your demo is working perfectly - ready to make it real? 🚀

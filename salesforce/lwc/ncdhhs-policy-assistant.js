import { LightningElement, track, api } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

export default class NcdhHsPolicyAssistant extends LightningElement {
    @api recordId; // Case or Contact record ID from Salesforce
    @track query = '';
    @track response = '';
    @track isLoading = false;
    @track sources = [];
    @track selectedSection = '';
    @track sessionId = '';
    
    // NCDHHS Policy Sections (from your organized S3 structure)
    sectionOptions = [
        { label: 'All Sections', value: '' },
        { label: 'Child Welfare Manuals', value: 'child-welfare-manuals' },
        { label: 'Practice Resources', value: 'child-welfare-practice-resources' },
        { label: 'Appendices', value: 'child-welfare-appendices' },
        { label: 'PATH SDM Tools', value: 'path-sdm-tools-manuals' },
        { label: 'Safe Sleep Resources', value: 'safe-sleep-resources' },
        { label: 'Disaster Preparedness', value: 'disaster-preparedness' },
        { label: 'Administrative Manuals', value: 'administrative-manuals' }
    ];

    connectedCallback() {
        this.sessionId = this.generateSessionId();
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    handleQueryChange(event) {
        this.query = event.target.value;
    }

    handleSectionChange(event) {
        this.selectedSection = event.detail.value;
    }

    async handleSubmit() {
        if (!this.query.trim()) {
            this.showToast('Error', 'Please enter a question', 'error');
            return;
        }

        this.isLoading = true;
        this.response = '';
        this.sources = [];

        try {
            // Call your existing API Gateway endpoint
            const response = await fetch('https://cqdhmncpzi.execute-api.us-east-1.amazonaws.com/prod/rag-query', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: this.query,
                    section: this.selectedSection,
                    userId: this.getCurrentUserId(),
                    sessionId: this.sessionId,
                    recordId: this.recordId
                })
            });

            const data = await response.json();

            if (data.success) {
                this.response = data.response;
                this.sources = data.sources || [];
                this.showToast('Success', 'Response generated successfully', 'success');
            } else {
                throw new Error(data.error || 'Failed to generate response');
            }

        } catch (error) {
            console.error('Error:', error);
            this.showToast('Error', 'Failed to get response: ' + error.message, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    handleLike() {
        this.sendFeedback('like');
        this.showToast('Thank you', 'Feedback recorded', 'success');
    }

    handleDislike() {
        this.sendFeedback('dislike');
        this.showToast('Thank you', 'We will improve this response', 'info');
        // Optionally trigger response refinement
        this.refineResponse();
    }

    async sendFeedback(type) {
        try {
            await fetch('https://cqdhmncpzi.execute-api.us-east-1.amazonaws.com/prod/feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    query: this.query,
                    response: this.response,
                    feedback: type,
                    userId: this.getCurrentUserId(),
                    timestamp: new Date().toISOString()
                })
            });
        } catch (error) {
            console.error('Feedback error:', error);
        }
    }

    async refineResponse() {
        this.isLoading = true;
        
        try {
            const response = await fetch('https://cqdhmncpzi.execute-api.us-east-1.amazonaws.com/prod/refine-response', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    originalQuery: this.query,
                    originalResponse: this.response,
                    sessionId: this.sessionId,
                    section: this.selectedSection
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.response = data.refinedResponse;
                this.showToast('Response Refined', 'Updated response based on your feedback', 'success');
            }
        } catch (error) {
            console.error('Refinement error:', error);
        } finally {
            this.isLoading = false;
        }
    }

    getCurrentUserId() {
        // Get current Salesforce user ID
        return '$A.get("$SObjectType.CurrentUser.Id")' || 'anonymous';
    }

    showToast(title, message, variant) {
        const evt = new ShowToastEvent({
            title: title,
            message: message,
            variant: variant,
        });
        this.dispatchEvent(evt);
    }

    get hasResponse() {
        return this.response && this.response.length > 0;
    }

    get hasSources() {
        return this.sources && this.sources.length > 0;
    }
}

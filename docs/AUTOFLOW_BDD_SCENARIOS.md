# AutoFlow BDD Scenarios

This document uses BDD-style scenarios to anchor future development. Each feature should be implemented with matching automated tests where practical.

## Feature 1: Brand Positioning

### Scenario 1.1: User sees AutoFlow as the product

Given a visitor opens the login page  
When the page is rendered  
Then the product name should be AutoFlow  
And the supporting copy should describe outbound sales workflow automation  
And the page should not describe the app as a smart note application

### Scenario 1.2: Existing record features are presented as business records

Given an authenticated user opens settings or record-related pages  
When legacy note features are shown  
Then the UI should refer to records, customer materials, or research notes  
And it should not present notes as the primary product purpose

## Feature 2: Workflow Creation

### Scenario 2.1: Create workflow from product keyword

Given a sales rep is logged in  
And the sales rep opens the workflow creation page  
When the sales rep enters keyword "pet grooming brush"  
And selects target market "United States"  
And submits the workflow  
Then a workflow run should be created  
And its status should be "draft" or "running"  
And its current stage should start at "seed"  
And it should be visible in the workflow list after refresh

### Scenario 2.2: Create workflow from product image URL

Given a sales rep is logged in  
When the sales rep creates a workflow with seed type "image"  
And provides an image URL  
Then the workflow should store the seed type and seed value  
And the workflow should be ready for ad discovery and store detection

### Scenario 2.3: Reject empty workflow seed

Given a sales rep is logged in  
When the sales rep submits a workflow without seed value  
Then the system should reject the request  
And no workflow should be created

## Feature 3: Discovery And Lead Generation

### Scenario 3.1: Generate leads from Shopify search

Given a workflow exists with keyword seed  
When the sales rep starts discovery  
Then the system should call the Shopify search adapter  
And normalize stores into lead records  
And attach the lead records to the workflow

### Scenario 3.2: Generate ad creatives from Facebook Ads search

Given a workflow exists with keyword seed  
When the system performs ad discovery  
Then Facebook Ads results should be saved as ad creative records  
And related brand/store hints should be linked to candidate leads

### Scenario 3.3: Search adapter fallback in development

Given the environment is not production  
And the external search API key is missing  
When discovery is started  
Then the system may return mock discovery results  
And the result should clearly mark the source as mock or estimated

### Scenario 3.4: No mock fallback in production

Given the environment is production  
And mock search is not explicitly enabled  
And the external search API key is missing  
When discovery is started  
Then the system should return a service unavailable error

## Feature 4: Lead Scoring

### Scenario 4.1: Score a lead with complete contact information

Given a lead has a Shopify store, active ads, and verified email  
When lead scoring runs  
Then the lead should receive scores for Shopify confidence, ad activity, traffic, contact, and total score  
And the score explanation should be saved

### Scenario 4.2: Mark risky lead

Given a lead appears to sell restricted, infringing, or grey-market products  
When lead scoring runs  
Then the lead should receive a risk signal  
And the recommended action should warn the sales rep before outreach

## Feature 5: AI Outreach

### Scenario 5.1: Generate WhatsApp message

Given a qualified lead exists  
When the sales rep requests a WhatsApp message  
Then the system should generate a message based on lead category, store, market, and sourcing angle  
And create an outreach task with status "ready"  
And the message should require human review before sending

### Scenario 5.2: Generate email message

Given a qualified lead exists  
When the sales rep requests an email message  
Then the system should generate a concise outbound email  
And save it as an outreach task

### Scenario 5.3: AI unavailable

Given the AI provider is not configured  
When the sales rep requests a message  
Then the system should return a clear configuration error  
And should not create an empty outreach task

## Feature 6: Outreach Queue

### Scenario 6.1: Mark outreach task as sent

Given an outreach task is ready  
When the sales rep marks it as sent  
Then the task status should become "sent"  
And the lead status should become "contacted" if it was new or qualified  
And a CRM activity should be recorded

### Scenario 6.2: Record prospect reply

Given an outreach task has been sent  
When the sales rep marks the task as replied  
Then the task status should become "replied"  
And the lead status should become "replied"  
And the next follow-up action should be required

## Feature 7: Quote Foundation

### Scenario 7.1: Calculate quote margin

Given a lead exists  
And a quote item has product cost, logistics cost, and customer price  
When the sales rep saves the quote  
Then the system should calculate gross margin  
And show a warning if margin is below 15%  
And require approval if margin is below 10%

### Scenario 7.2: Quote validity

Given a quote has validity days set to 7  
When the quote is created  
Then the quote expiration date should be calculated  
And expired quotes should not be reused as current offers

## Feature 8: CRM Follow-Up

### Scenario 8.1: Add follow-up note

Given a lead exists  
When the sales rep adds a follow-up record  
Then the record should appear in the lead timeline  
And the record should include owner, timestamp, type, and content

### Scenario 8.2: Protect lead ownership

Given a lead has an owner and protection period  
When another user tries to claim the lead  
Then the system should prevent silent takeover  
And require manager review or ownership transfer record


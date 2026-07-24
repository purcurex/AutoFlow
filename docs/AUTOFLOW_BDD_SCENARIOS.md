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

### Scenario 2.4: Allocate an owner-scoped workflow ID

Given a sales rep has no prior workflow
When the sales rep creates three workflows concurrently
Then the workflows should receive unique display IDs "01", "02", and "03"
And another sales rep's first workflow should receive display ID "01"
And deleting a workflow should not make its display ID available again

### Scenario 2.5: Display workflow identity and creation date

Given a workflow has been persisted
When the sales rep opens the workflow list or recent dashboard activity
Then the workflow display ID should be visible
And the creation date should be shown in `YYYY-MM-DD` format
And the internal UUID should not replace the short display ID in normal UI

## Feature 3: Discovery And Lead Generation

### Scenario 3.1: Generate leads from PipiAds store candidates

Given a workflow exists with keyword seed
When the sales rep starts discovery
Then the system should call the PipiAds discovery adapter
And normalize store candidates into lead records
And attach the lead records to the workflow

### Scenario 3.2: Generate ad creatives from PipiAds

Given a workflow exists with keyword seed
When the system performs ad discovery
Then PipiAds results should be saved as ad creative records
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

### Scenario 3.5: Verify a PipiAds store candidate

Given PipiAds returns a candidate landing-page domain
When the system enriches the candidate
Then the storefront should be verified independently before Shopify is asserted
And PipiAds evidence should remain marked as secondary evidence
And extracted contact details should retain their source and confidence

### Scenario 3.6: Discover from a product image

Given a workflow exists with a public product image URL
When discovery is started
Then the system should submit the image to the PipiAds image-search workflow
And poll the provider task within the configured timeout
And persist normalized matching ads without storing the provider API key

### Scenario 3.7: Analyze storefront contact evidence

Given a lead belongs to the current sales rep
When AutoFlow analyzes the lead storefront
Then it should inspect the storefront and up to four high-value same-origin Contact, Support, About, or policy pages
And extract email, telephone, WhatsApp, Facebook, Instagram, and LinkedIn contact evidence from explicit links, labelled text, and structured data
And persist the contact type, normalized value, source page URL, source page title, extraction method, verification status, and confidence
And reject private-network targets and irrelevant social share, post, reel, or tracking links

### Scenario 3.8: Present classified contacts instead of raw URLs

Given a lead has persisted contact evidence
When the sales rep opens the lead detail page
Then AutoFlow should display a readable account or address grouped by contact type
And explain what the evidence page proves
And provide direct buttons for the contact destination and evidence source
And should not present storefront or product-detail URLs as customer contact records
And another user should not be able to trigger or read the analysis

## Feature 4: Lead Scoring

### Scenario 4.1: Score a lead with complete contact information

Given a lead has a Shopify store, active ads, and verified email  
When lead scoring runs  
Then the lead should receive scores for Shopify confidence, ad activity, traffic, contact, and total score  
And the score explanation should be saved

### Scenario 4.2: Prioritize strong direct-contact channels

Given public evidence contains a phone number, WhatsApp account, or store-owner Facebook profile
When AutoFlow calculates the contact score
Then those channels should have materially higher weight than email and general social pages
And the score explanation should identify the priority contact types that were found
And a storefront Facebook business page should not be treated as a store-owner personal profile

### Scenario 4.3: Cap an email-only contact score

Given email is the only usable contact channel for a lead
When AutoFlow calculates or recalculates the contact score
Then the contact score should not exceed 50
And the score explanation should record that the email-only cap was applied

### Scenario 4.4: Preserve attributable customer advertising evidence

Given PipiAds returns an ad that can be matched to a candidate store
When AutoFlow persists and presents the lead evidence
Then the provider, platform, provider ad ID, confidence, match reason, and direct ad URL should be retained
And PipiAds records should be labelled as "PipiAds API"
And a Facebook ad ID without a provider URL should use the official Facebook Ads Library URL

### Scenario 4.5: Group the lead pool by source workflow

Given one owner-level prospect may be discovered by one or more workflows
When the sales rep opens the lead pool
Then AutoFlow should group discovery occurrences by source workflow
And each occurrence should retain the internal workflow UUID, short workflow ID, workflow name, and lead discovery time
And each group heading should display the workflow name and short workflow ID together
And one globally deduplicated prospect should appear in every workflow that discovered it
And leads inside each workflow should sort by workflow-specific score descending
And discovery time descending should break equal-score ties

### Scenario 4.6: Mark risky lead

Given a lead appears to sell restricted, infringing, or grey-market products  
When lead scoring runs  
Then the lead should receive a risk signal  
And the recommended action should warn the sales rep before outreach

## Feature 5: AI Outreach

### Scenario 5.1: Generate WhatsApp message

Given a qualified lead exists  
When the sales rep requests a WhatsApp message  
Then the system should generate a message based on lead category, store, market, and sourcing angle
And create an outreach task with status "draft"
And the message should require human review before it can become "ready"

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

### Scenario 5.4: Generate a reviewed draft with Zhipu GLM

Given a qualified lead and a verified target contact exist
And the Zhipu GLM provider is configured
When the sales rep requests an outreach message
Then AutoFlow should send only the required business context to Zhipu GLM
And save the generated content as a draft requiring human review
And never expose the Zhipu API key to the browser, logs, or persisted task

### Scenario 5.5: Refine outreach through multiple AI turns

Given a qualified lead belongs to the current sales rep
When the sales rep starts an AI outreach conversation and sends refinement instructions
Then AutoFlow should persist each user and assistant message in sequence
And each subsequent GLM request should receive the bounded conversation history, lead snapshot, outreach options, and active prompt modules
And another user should not be able to read or change the conversation

### Scenario 5.6: Generate a structured bilingual draft

Given an active AI outreach conversation contains enough verified context
When the sales rep requests a final draft
Then GLM should return structured English and Simplified Chinese subjects and messages
And AutoFlow should reject a response when either required language is empty
And facts used, missing facts, and review warnings should be stored with the draft
And generating again should create a new version while preserving the superseded version

### Scenario 5.7: Review and accept the bilingual draft

Given a bilingual draft exists
When the sales rep edits both versions and explicitly accepts the draft
Then AutoFlow should preserve the accepted English and Chinese content
And create one ready outreach task using the English version as the outbound source of truth
And retain the Chinese version as an internal semantic reference
And the accepted conversation should reject further messages or draft generation

### Scenario 5.8: Never fabricate missing commercial facts

Given quotation, product, logistics, or contact facts are missing or unverified
When GLM helps refine or generate outreach
Then the immutable system rules should prohibit invented values or claims
And the final draft should list missing facts and warnings for human review
And a user template should not be able to override this safety boundary

## Feature 6: Outreach Queue

### Scenario 6.1: Mark outreach task as sent

Given an outreach task is ready  
When the sales rep marks it as sent  
Then the task status should become "sent"  
And the lead status should become "contacted" if it was new or qualified  
And a lightweight local follow-up activity should be recorded

### Scenario 6.2: Record prospect reply

Given an outreach task has been sent  
When the sales rep marks the task as replied  
Then the task status should become "replied"  
And the lead status should become "replied"  
And the next follow-up action should be required

## Feature 7: FOP-Backed Quote Workspace

### Scenario 7.1: Define product quantity tiers

Given a lead and a quote draft exist
When the sales rep adds a product with quantity tiers 1-99, 100-499, and 500 or more
Then the tiers should be stored in ascending order
And overlapping or inverted quantity ranges should be rejected
And each tier should preserve its unit and currency

### Scenario 7.2: Request product costs from FOP

Given a quote contains valid product tiers and FOP product mapping references
When the sales rep requests product costs
Then AutoFlow should call the configured product-cost provider port once with an idempotency key
And save the FOP source, external request ID, version/effective time, currency, and tier result snapshot
And AutoFlow should not reproduce FOP product-cost rules locally

### Scenario 7.3: Request freight for multiple destination countries

Given a quote contains explicit package weight, dimensions, units, currency, and destination countries US and DE
When the sales rep requests freight options
Then AutoFlow should call the configured logistics-rate provider port
And group returned channels and rates under US and DE
And preserve chargeable weight, freight, returned fees, ETA, validity, and source version for each option

### Scenario 7.4: Build a combined quotation matrix

Given product-cost tiers and shipping-rate options have been returned by FOP
When the sales rep selects one or more destination channels and composes the quote
Then AutoFlow should show product/SKU x quantity tier x destination country x shipping channel combinations
And every displayed amount should reference the exact product-cost and shipping-rate snapshots used
And any arithmetic should be transparent and reproducible

### Scenario 7.5: FOP quote capability is unavailable

Given the FOP provider is not configured or is temporarily unavailable
When the sales rep requests product cost or freight
Then the quote draft and request conditions should remain saved
And the UI should show a retryable unavailable state and correlation ID
And no mock, estimated, or invented amount should be presented as a real FOP result

### Scenario 7.6: Quote result expires or is superseded

Given a quote uses an FOP result with an expiration time
When that result expires or a newer result is selected
Then the old snapshot should remain immutable for audit
And it should not be used for a newly shared quote without explicit refresh

### Scenario 7.7: Export a saved quotation version to Excel

Given the sales rep owns a saved quotation version
When the sales rep exports that version to Excel
Then AutoFlow should return a valid XLSX workbook with HyperZone branding and the quotation matrix
And the workbook should preserve quantity tiers, destination countries, custom and actual logistics channels, carrier, costs, margin rates, customer amounts, currency, quote ID, and version
And unavailable product-cost or freight values should remain blank
And another user should not be able to export the quotation version

## Feature 8: Lightweight Follow-Up And FOP Handoff

### Scenario 8.1: Record the next AutoFlow action

Given a lead exists
When the sales rep records the latest outcome, next action, next-action time, or a short note
Then the action should appear in the AutoFlow lead timeline
And it should include owner, timestamp, type, and content
And it should not be presented as the authoritative FOP follow-up history

### Scenario 8.2: Handoff a prospect to FOP idempotently

Given a qualified lead or a lead with a ready/shared quote has not been handed off
When the sales rep starts FOP handoff
Then AutoFlow should call the configured FOP handoff port with lead, contact, evidence, outreach, and quote context
And save the returned FOP lead ID, optional opportunity ID, sync status, and conflicts
And repeating the same idempotent request should not create a duplicate FOP lead or opportunity

### Scenario 8.3: Respect FOP authority

Given FOP reports a duplicate, ownership conflict, or different opportunity stage
When AutoFlow receives the handoff result
Then AutoFlow should display the conflict and require review
And should not silently overwrite FOP customer, ownership, stage, or follow-up data

## Feature 9: Workflow Failure Recovery And Lifecycle

### Scenario 9.1: Retry a transient provider failure

Given a workflow failed because PipiAds, Google Lens, or Google Search was temporarily unavailable
When the sales rep chooses direct retry
Then AutoFlow should rerun the existing workflow with the same search settings
And preserve the original failure details for diagnosis

### Scenario 9.2: Revise search conditions and rerun

Given a workflow is failed, cancelled, or completed
When the sales rep changes the product seed, target market, or Google search options
Then AutoFlow should create a new workflow revision
And link it to the parent and root workflow
And preserve the prior execution and evidence history
And start discovery using the revised settings

### Scenario 9.3: Safely delete a disposable workflow

Given a draft, failed, or cancelled workflow has no revision descendants
When the owner confirms deletion after reviewing the impact
Then AutoFlow should delete that workflow, its jobs, steps, and workflow-specific evidence
And delete only the workflow-to-lead links
And preserve every owner-level lead record that may be shared with other workflows

### Scenario 9.4: Archive a workflow with revision history

Given a workflow has revision history or is not in a deletable state
When the owner attempts to remove it from the active list
Then AutoFlow should require archive instead of physical deletion
And hide the archived workflow from active lists and dashboard activity
And retain its execution history, revision lineage, and related leads

### Scenario 9.5: Enforce owner isolation

Given a workflow belongs to another user
When the current user requests its details, revision, deletion impact, archive, or deletion
Then AutoFlow should respond as if the workflow does not exist
And must not disclose any workflow or lead information

## Feature 10: External Link Navigation

### Scenario 10.1: Preserve the active AutoFlow workspace

Given a sales rep is using any AutoFlow business page
When the sales rep opens a store, product page, Facebook profile, evidence URL, or outreach channel
Then the external destination should open in a new browser tab
And the current AutoFlow page should remain open in its original tab
And the external link should use noopener and noreferrer protections

### Scenario 10.2: Keep internal navigation in the current tab

Given a sales rep is using AutoFlow
When the sales rep opens an internal workflow, lead, quote, setting, or administration route
Then the application should navigate in the current tab
And should not create an unnecessary browser tab

### Scenario 10.3: Apply the rule to dynamically rendered content

Given a trusted and sanitized rich-text preview contains an external link
When the preview is rendered after application startup
Then AutoFlow should apply the same secure new-tab policy before navigation

## Feature 11: Prompt Management, Outreach Context, And Dashboard Drill-Down

### Scenario 11.1: Maintain prompts outside personal settings

Given an authenticated user opens the primary navigation
When the user selects AI Prompt Templates
Then AutoFlow should open an independent prompt-template workspace
And system defaults, user templates, and active per-user bindings should remain independently persisted
And personal settings should no longer contain the prompt-template manager

### Scenario 11.2: Prioritize customer communication channels

Given a sales rep starts a new AI outreach conversation
When no channel has been selected
Then Facebook should be the default channel
And WhatsApp, email, Instagram, and another manually specified channel should remain available
And another channel should require a reachable target before the conversation starts

### Scenario 11.3: Show the linked customer on an outreach task

Given an outreach task belongs to an owner-scoped lead
When the sales rep opens the outreach workspace
Then the task should display current customer name, domain, market, category, score, and status
And list current available contact channels from the customer profile
And provide an internal link to the customer profile
And should not create a duplicate customer master record

### Scenario 11.4: Drill down from dashboard metrics

Given a dashboard or follow-up metric represents a business object count
When the sales rep selects the metric
Then AutoFlow should navigate to the corresponding object list
And status-specific metrics should apply the matching status filter

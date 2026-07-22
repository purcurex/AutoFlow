# AutoFlow Product Spec

## 1. Product Positioning

AutoFlow is a Dropshipping customer-development workflow for outbound sales teams serving overseas small-business customers.

It focuses on the work before and around the first customer quotation: product and store discovery, contact enrichment, rapid qualification, outreach preparation, and quotation assembly. After a lead becomes a formal lead or opportunity, Kingdee Cloud Cosmic FOP is the business system of record.

AutoFlow is not a full CRM, a replacement for FOP, or a local logistics-rating engine. Legacy note capabilities remain only as supporting business records, research notes, customer materials, and quotation remarks.

## 2. Target Users

| Role | Main Goals |
|---|---|
| Sales Rep | Discover stores, find contacts, qualify prospects, prepare outreach, and assemble customer quotations |
| Sales Manager | Review lead quality, quote completeness, exceptions, and FOP handoff status |
| Admin | Manage users, integration configuration, workflow templates, and audit data |

FOP users continue to manage formal leads, opportunities, opportunity stages, follow-up records, customer records, and downstream fulfillment processes in Kingdee Cloud Cosmic.

## 3. System Boundary

### AutoFlow Owns

- Product keyword, image, URL, and store discovery workflows.
- Ad/store evidence, Shopify identification, contact enrichment, deduplication, and lead scoring.
- AI-assisted outreach drafts with human review.
- A lightweight next-action queue before FOP handoff.
- Customer-facing quotation preparation and comparison.
- Product quantity tiers, destination countries, shipping-channel selections, and combined quote presentation.
- Stable internal API contracts and adapters for FOP capabilities.
- Request, response, version, source, and selected-option snapshots required to reproduce a quotation.

### FOP Owns

- Formal lead and opportunity master records.
- Opportunity stages and authoritative follow-up history.
- Customer and ownership master data.
- Product cost and pricing capability exposed to AutoFlow.
- Logistics channel and freight-rating capability exposed to AutoFlow.
- Orders, fulfillment, logistics execution, after-sales, finance, settlement, and margin master data.

### Explicitly Out Of Scope

- Building a second full CRM inside AutoFlow.
- Reimplementing FOP product-cost rules or logistics-rating models.
- Silent mock, estimated, or locally invented cost/freight values in production.
- Full FOP customer, order, fulfillment, finance, or after-sales replication.
- Fully automated WhatsApp sending without human confirmation.

## 4. Core Workflow

```text
Product keyword / image / URL
-> ad and store discovery
-> Shopify/store verification
-> contact enrichment
-> cleaning and lead scoring
-> AI outreach draft
-> human-reviewed outreach
-> lightweight next action
-> product tier quote + destination freight quote
-> combined customer quote
-> FOP lead/opportunity handoff
```

## 5. Domain Objects

| Object | Purpose |
|---|---|
| WorkflowRun | A customer-development workflow started from a product or store seed |
| WorkflowStep | A resumable and traceable stage within a workflow |
| Lead | An AutoFlow prospect before or during FOP handoff |
| LeadContact | Email, WhatsApp, Instagram, Facebook, LinkedIn, phone, or website contact evidence |
| AdCreative | Ad discovery evidence from an approved provider |
| ShopifyStore | Store identity and Shopify verification evidence |
| LeadScore | Explainable score dimensions, confidence, and reasons |
| OutreachTask | Human-reviewed message draft, channel, owner, status, and next action |
| FollowUpActivity | Lightweight local note or action log; not the authoritative CRM history |
| QuoteDraft | Customer quotation workspace linked to one lead |
| ProductQuoteLine | Product/SKU selection and customer-facing quantity tiers |
| ProductQuoteTier | Minimum/maximum quantity, unit, currency, and selected price/cost snapshot |
| ShippingQuoteRequest | Package and destination-country conditions sent through the FOP adapter |
| ShippingQuoteOption | FOP-returned channel, freight, ETA, currency, validity, and source version |
| QuoteCombination | Reproducible product-tier x destination-country x shipping-channel result |
| FopReference | FOP lead/opportunity IDs and synchronization state |
| IntegrationCall | Idempotency key, correlation ID, request/response snapshot, status, and error |
| AuditEvent | Append-only trace for workflow, outreach, quotation, and handoff actions |

The existing `CrmActivityEntity` may temporarily implement `FollowUpActivity`. Its name does not change the ownership boundary: FOP remains authoritative after handoff.

## 6. Status Models

### Workflow Status

- `draft`
- `running`
- `completed`
- `failed`
- `cancelled`

### Outreach Status

- `draft`
- `ready`
- `sent`
- `replied`
- `skipped`
- `failed`

### Quote Status

- `draft`
- `awaiting_product_cost`
- `awaiting_shipping_rate`
- `ready`
- `shared`
- `failed`
- `expired`

### FOP Synchronization Status

- `not_started`
- `pending`
- `succeeded`
- `failed`
- `requires_review`

The current lead status enum remains an implementation compatibility model until a versioned migration is approved. AutoFlow must not attempt to mirror every FOP opportunity stage.

## 7. Functional Requirements

### FR-001 Brand And Product Language

All editable user-facing product language uses AutoFlow and describes a customer-development workflow. Legacy note terminology is limited to migration notes and physical compatibility names.

### FR-002 Workflow Creation

Sales reps can create customer-development workflows from a product keyword or image URL. Product URL and manual store URL seeds are planned after discovery adapters are normalized.

### FR-003 Discovery And Evidence

The system calls approved ad/store discovery adapters and persists provider, source type, confidence, request time, and evidence. Mock or estimated data is visibly labelled and cannot silently become production quotation input.

### FR-004 Contact Enrichment

Sales reps can quickly review discovered email, WhatsApp, social, phone, and website contacts with source and verification status. Contact evidence contributes to qualification but does not create a formal FOP customer automatically.

### FR-005 Lead Qualification

The lead pool supports owner-scoped filtering, deduplication, evidence review, explainable scoring, and a recommended next action.

### FR-006 AI Outreach

Sales reps can generate WhatsApp or email drafts from persistent lead context. Every generated draft is editable and requires explicit human approval before being marked ready or sent.

### FR-007 Lightweight Follow-Up

AutoFlow stores only the local actions needed to complete discovery, outreach, quotation, and FOP handoff: latest outcome, next action, next-action time, note, and handoff status. It does not implement a second opportunity pipeline or authoritative CRM history.

### FR-008 Product Tier Quotation

Sales reps can create one or more product lines and define ordered, non-overlapping quantity tiers. Each tier supports quantity range, unit, currency, customer-facing unit price, and an FOP product-cost reference when available.

AutoFlow calls the product-cost port instead of reproducing FOP cost rules. Returned values are stored with source, version/effective time, currency, and request snapshot.

### FR-009 Destination Freight Quotation

Sales reps can request freight quotations for one or more destination countries using package, weight, and product quantity context. Results are grouped by destination country and may contain multiple FOP logistics channels, freight amounts, chargeable weight, ETA, surcharges, currency, and validity.

AutoFlow calls the logistics-rate port instead of implementing the FOP rating model.

### FR-010 Combined Quotation

The quote workspace can present a multidimensional matrix across:

- Product and SKU.
- Product quantity tier.
- Destination country.
- Selected logistics channel.
- Product amount, freight amount, optional returned fees, and combined customer amount.

Every matrix cell must be reproducible from immutable cost/rate snapshots. AutoFlow may perform transparent arithmetic for presentation, but pricing policy and logistics-rating rules remain in FOP.

### FR-011 FOP Handoff

After qualification, reply, or quotation, a sales rep can explicitly hand off the prospect to FOP. AutoFlow sends an idempotent lead/opportunity payload through an adapter and stores returned FOP identifiers and synchronization status. It never silently overwrites authoritative FOP data.

### FR-012 Integration Failure Handling

When FOP is unavailable or not configured, AutoFlow preserves the draft and request conditions, shows a retryable error, and does not fabricate product cost or freight results.

### FR-013 Legacy Record Capability

Legacy records can remain as research notes, customer materials, and quotation remarks, linked to workflows or leads where useful.

## 8. Current-Phase Delivery Scope

This phase establishes the quotation and FOP integration foundation without claiming a live FOP connection:

- Add quote entry points from lead detail and primary navigation.
- Add the product-tier editor, destination-country selector, shipping-option result area, and combined quote matrix shell.
- Define validated AutoFlow quote DTOs and provider-port interfaces.
- Provide contract-test adapters using explicit mock fixtures in development/test only.
- Persist integration status and reproducible request/response snapshots once quote persistence is implemented.
- Keep FOP authentication, exact Kingdee Cloud Cosmic endpoint mapping, and production field mapping configurable and pending the FOP API inventory.

## 9. Non-Functional Requirements

- Authentication is required for every AutoFlow and integration API.
- AutoFlow data is owner- or team-scoped.
- Integration credentials are never stored in frontend code or returned to the browser.
- FOP calls use timeout, correlation ID, idempotency key, retry classification, and redacted logs.
- Monetary values use decimal-safe storage and explicit ISO currency codes.
- Weight, dimensions, quantity, country, and units are explicit and validated.
- Important workflow, quotation, and handoff actions are auditable.
- Provider snapshots are immutable once used by a shared quotation.
- Automated tests cover happy paths, validation, provider failure, and duplicate submission.

## 10. Acceptance Criteria

- AutoFlow is presented as the customer-development and quotation workbench, not as a CRM replacement.
- A sales rep can move from discovery evidence to verified contact review and outreach preparation.
- The quote page can capture product quantity tiers and multiple destination countries.
- Internal APIs can invoke replaceable product-cost and logistics-rate provider ports.
- Combined quotation output is derived only from selected, traceable provider results.
- FOP failure never produces a fake cost or freight amount.
- FOP lead/opportunity references and synchronization status can be stored without duplicating FOP master data.
- BDD, automated tests, architecture, and backlog remain aligned with this boundary.

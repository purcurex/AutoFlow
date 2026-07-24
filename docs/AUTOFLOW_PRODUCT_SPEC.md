# AutoFlow Product Spec

## 1. Product Positioning

AutoFlow is a Dropshipping customer-development workflow for outbound sales teams serving overseas small-business customers.

Phase 1 focuses on the work before quotation: product and ad discovery, store discovery, contact enrichment, rapid qualification, and human-reviewed outreach preparation. Customer quotation and live Kingdee Cloud Cosmic FOP integration are retained as phase 2 foundations and are not phase 1 delivery claims.

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

Every workflow receives an owner-scoped display ID and an immutable creation timestamp. The display ID is a numeric sequence rendered as `01` through `99`, then `100` through `999999`. Each user has an independent sequence, concurrent creation must not allocate duplicates, deleted IDs are never reused, and creation is rejected after the user's sequence exceeds `999999`. Existing workflows are backfilled per owner by creation time and internal UUID. Lists and dashboard activity display the workflow ID and creation date in `YYYY-MM-DD` format; the UUID remains the internal relational identifier.

### FR-003 Discovery And Evidence

The system calls approved ad/store discovery adapters and persists provider, source type, confidence, request time, and evidence. Mock or estimated data is visibly labelled and cannot silently become production quotation input.

### FR-004 Contact Enrichment

Sales reps can analyze a storefront and selected same-origin Contact, Support, About, and policy pages for public email, telephone, WhatsApp, Facebook, Instagram, and LinkedIn contact evidence. Every contact preserves its normalized value, source page, page title, extraction method, verification status, and confidence.

The lead detail page presents readable contact identities with direct contact and evidence-source actions. Storefront and product-detail URLs remain quick-access resources and are not misrepresented or scored as customer contact records. Contact evidence contributes to qualification but does not create a formal FOP customer automatically.

### FR-005 Lead Qualification

The lead pool supports owner-scoped filtering, deduplication, evidence review, explainable scoring, and a recommended next action.

The lead pool groups discovery occurrences by source workflow. Each occurrence preserves the workflow's owner-scoped short display ID and name, internal workflow UUID, workflow creation time, lead discovery time, and the score calculated for that workflow. The group heading visibly presents the workflow name and short ID together. A globally deduplicated prospect may therefore appear under every workflow that discovered it. Workflow groups are ordered by workflow creation time; leads inside a workflow are ordered by workflow-specific score descending and discovery time descending as the tie-breaker.

### FR-006 AI Outreach

Sales reps can start an owner-scoped AI collaboration session from persistent lead context and refine the intended product, value proposition, tone, quotation mode, and call to action through multiple turns with Zhipu GLM.

The final result is a versioned bilingual draft containing an English outbound version and a Simplified Chinese semantic-reference version. English is the outbound source of truth; Chinese is retained for internal review. Both versions remain editable and require explicit human acceptance before the English version creates a ready outreach task.

The immutable system prompt enforces anti-fabrication and structured bilingual output. Per-user active prompt modules continue to control business style, channel guidance, quotation mode, product visuals, supplier strengths, and logistics strengths without overriding the system safety boundary.

### FR-007 Lightweight Follow-Up

AutoFlow stores only the local actions needed to complete discovery, outreach, quotation, and FOP handoff: latest outcome, next action, next-action time, note, and handoff status. It does not implement a second opportunity pipeline or authoritative CRM history.

### FR-008 Product Tier Quotation

Sales reps can create one or more product lines and define ordered, non-overlapping quantity tiers. Each tier supports quantity range, unit, currency, an FOP-returned purchase cost, and a customer-facing unit price. The product line also stores a user-defined gross-margin percentage.

AutoFlow calls the product-cost port instead of reproducing FOP cost rules. Returned values are stored with source, version/effective time, currency, and request snapshot. AutoFlow may transparently calculate the proposed customer price as `purchase cost / (1 - product gross margin rate)`; the FOP purchase cost remains immutable evidence and the resulting customer price remains reviewable.

### FR-009 Destination Freight Quotation

Sales reps can request freight quotations for one or more destination countries using package, weight, and product quantity context. Logistics-channel selection is two-level: first select an FOP custom logistics channel group, then select one or more actual FOP logistics channels under that group. Selections from more than one group may coexist in one quotation.

Each selected actual channel stores its custom-channel code/name, actual-channel code/name, and a user-defined logistics gross-margin percentage. AutoFlow calls the logistics-rate port instead of implementing the FOP rating model. It may transparently calculate customer freight as `FOP freight cost / (1 - logistics gross margin rate)`.

### FR-010 Combined Quotation

The quote workspace can present a multidimensional matrix across:

- Product and SKU.
- Product quantity tier.
- Destination country.
- Selected logistics channel.
- FOP purchase cost, product gross margin, and customer product amount.
- FOP freight cost, logistics gross margin, customer freight, optional returned fees, and combined customer amount.

Every matrix cell must be reproducible from immutable cost/rate snapshots. AutoFlow may perform transparent arithmetic for presentation, but pricing policy and logistics-rating rules remain in FOP.

The sales rep can export a saved quotation version as an Excel workbook. The export follows the approved HyperZone quotation layout: branded header, quotation notes, quantity-tier rows, destination and logistics-channel dimensions, internal cost/margin review fields, customer product amount, customer freight, and emphasized total price. The workbook records the quotation ID, immutable version, source version, and generation date. Missing FOP values remain blank and must never be replaced by simulated amounts.

### FR-011 FOP Handoff

After qualification, reply, or quotation, a sales rep can explicitly hand off the prospect to FOP. AutoFlow sends an idempotent lead/opportunity payload through an adapter and stores returned FOP identifiers and synchronization status. It never silently overwrites authoritative FOP data.

### FR-012 Integration Failure Handling

When FOP is unavailable or not configured, AutoFlow preserves the draft and request conditions, shows a retryable error, and does not fabricate product cost or freight results.

### FR-013 Legacy Record Capability

Legacy records can remain as research notes, customer materials, and quotation remarks, linked to workflows or leads where useful.

### FR-014 Alibaba 1688 Product Sourcing

AutoFlow can search official Alibaba 1688 Open Platform offers by product keyword or a provider-ready product image. Results are presented as a separate `1688货源` procurement area with product, price tier, MOQ, seller, shop, delivery, customization, and source evidence.

1688 suppliers are procurement candidates rather than overseas prospects. Sourcing records are linked to the workflow product signal, are not stored as customer contacts, and never affect the customer contact score or customer total score. AutoFlow maintains a separate, explainable sourcing score for offer suitability.

### FR-015 Independent AI Prompt Template Workspace

AI outreach prompt templates are a top-level user capability rather than a personal-profile setting. System defaults, user-created versions, and the active per-user module binding remain independently persisted in `ai_prompt_templates` and `ai_prompt_bindings`. Removing a user template restores the immutable system fallback.

### FR-016 Customer-Linked Outreach Workspace

Outreach prioritizes Facebook direct messages, followed by WhatsApp, email, Instagram, and a user-specified other channel. Every outreach task remains linked to one owner-scoped customer lead and presents current customer basics and available contact channels from the customer profile rather than duplicating a stale contact snapshot.

Dashboard and follow-up metric cards navigate to the corresponding workflow, lead, or outreach list. Status-specific cards include a URL filter that the destination list applies on entry.

## 8. Current Phase 1 Delivery Scope

Phase 1 delivers the customer-development workflow:

- Use PipiAds/PipiSpy as the primary keyword/image advertising-intelligence source.
- Treat PipiAds as secondary discovery evidence, not as authoritative platform performance data.
- Derive candidate store domains from ad details and landing pages.
- Verify storefront accessibility and Shopify evidence before promoting a candidate.
- Extract and preserve contact evidence with source, confidence, and verification state.
- Prioritize phone, WhatsApp, and store-owner Facebook profile evidence during contact discovery and scoring.
- Cap the contact score at 50 when email is the only available contact channel.
- Preserve attributable customer ad links, prioritize Facebook Ads Library destinations, and label PipiAds API evidence explicitly.
- Discover suitable 1688 procurement offers by keyword or image through an independently scored `1688货源` capability.
- Generate Zhipu GLM outreach drafts that require explicit human review.

The following implemented foundations remain available but further delivery is deferred to phase 2:

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
- A sales rep can maintain GLM prompt modules from an independent top-level workspace.
- Outreach tasks display their linked customer profile and current available contact channels.
- Dashboard metrics navigate to their corresponding filtered object lists.
- The quote page can capture product quantity tiers and multiple destination countries.
- Internal APIs can invoke replaceable product-cost and logistics-rate provider ports.
- Combined quotation output is derived only from selected, traceable provider results.
- FOP failure never produces a fake cost or freight amount.
- FOP lead/opportunity references and synchronization status can be stored without duplicating FOP master data.
- BDD, automated tests, architecture, and backlog remain aligned with this boundary.

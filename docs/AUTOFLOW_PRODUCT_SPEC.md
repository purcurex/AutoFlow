# AutoFlow Product Spec

## 1. Product Positioning

AutoFlow is a Dropshipping sales workflow platform for outbound sales teams.

It helps sales reps discover potential Shopify sellers, qualify store leads, generate outreach messages, prepare quotations, and track follow-up actions before the customer formally enters CRM/FOP.

AutoFlow should not be treated as a renamed note-taking app. Legacy note capabilities are retained only as supporting knowledge, records, and remarks.

## 2. Target Users

| Role | Main Goals |
|---|---|
| Sales Rep | Discover leads, contact prospects, prepare quotes, follow up customers |
| Sales Manager | Review lead quality, manage ownership, monitor outreach, approve risky quotes |
| Order Assistant | Receive handoff signals after quote / registration / order intent |
| Admin | Manage users, configs, workflow templates, audit data |

## 3. Business Scope

### In Scope For First Refactor

- AutoFlow brand and product language cleanup.
- Product keyword / image based workflow creation.
- Shopify store discovery and Facebook Ads discovery as workflow inputs.
- Lead pool with scoring and qualification fields.
- Outreach queue with AI-assisted message drafts.
- CRM-style follow-up board.
- Quote workspace foundation.
- Persistent AutoFlow data model.
- BDD/PDD/test documentation and task tracking.

### Out Of Scope For First Refactor

- Full CRM replacement.
- Full FOP replacement.
- Real WhatsApp sending automation without human confirmation.
- Full Shopify OAuth and order sync.
- Real logistics provider rating integration.
- Finance settlement and commission calculation.

## 4. Core Workflow

```text
Seed input
→ Ad discovery
→ Shopify store detection
→ Lead enrichment
→ Lead scoring
→ AI message generation
→ Human-reviewed outreach
→ Quote preparation
→ CRM follow-up
→ CRM/FOP handoff
```

## 5. Domain Objects

| Object | Purpose |
|---|---|
| WorkflowRun | A sales development workflow started from a keyword, image, URL, or manual lead |
| WorkflowStep | A traceable stage within a workflow |
| Lead | A potential Shopify / dropshipping customer |
| LeadContact | Email, WhatsApp, Instagram, Facebook, LinkedIn, website form |
| AdCreative | Ad discovery result from Facebook Ads Library or other sources |
| ShopifyStore | Store identity and Shopify confidence result |
| LeadScore | Structured score result and reasons |
| OutreachTask | Message draft, channel, owner, status, next follow-up time |
| CrmActivity | Follow-up record, call note, reply, quote event, status change |
| Quote | Customer quotation header and approval state |
| QuoteItem | Product cost, quantity, selling price, margin |
| LogisticsQuote | Country, channel, weight, freight, ETA, surcharges |
| CustomerOwnership | Owner, protection period, assignment source |
| AuditEvent | Append-only trace for workflow, quote, outreach, and ownership actions |

## 6. Status Models

### Workflow Status

- `draft`
- `running`
- `completed`
- `failed`
- `cancelled`

### Workflow Stage

- `seed`
- `ad_discovery`
- `store_detection`
- `lead_cleaning`
- `lead_scoring`
- `message_generation`
- `outreach`
- `crm`

### Lead Status

- `new`
- `qualified`
- `contacted`
- `replied`
- `opportunity`
- `won`
- `lost`
- `invalid`

### Outreach Status

- `draft`
- `ready`
- `sent`
- `replied`
- `skipped`
- `failed`

### Quote Status

- `draft`
- `ready`
- `sent`
- `approved`
- `rejected`
- `expired`

## 7. Functional Requirements

### FR-001 Brand Conversion

All user-facing editable product language should use AutoFlow. NoteFlow should not appear in login, register, navigation, README, seed logs, emails, or product docs except migration notes.

### FR-002 Workflow Creation

P1 sales reps can create a workflow from:

- Product keyword.
- Product image URL.

Product URL and manual prospect/store URL seeds are planned for P2 after discovery adapters are normalized.

The workflow records owner, target market, seed type, seed value, status, current stage, progress, and timestamps.

### FR-003 Discovery Results

The system can call existing Shopify Search and Facebook Ads Search capabilities and normalize results into leads, stores, and ad creatives.

### FR-004 Lead Pool

Sales reps can view, filter, and open leads. Each lead must show store identity, domain, country, category, source, score, contacts, owner, status, and recommended action.

### FR-005 Lead Scoring

The system scores leads using configurable dimensions:

- Shopify confidence.
- Ad activity.
- Traffic signal.
- Contact completeness.
- Category fit.
- Dropshipping fit.
- Risk signal.

### FR-006 AI Outreach

Sales reps can generate a WhatsApp or Email message for a lead. The message must be saved as an outreach task and require human review before sending.

### FR-007 Outreach Queue

Sales reps can update outreach tasks as ready, sent, replied, skipped, or failed. Each task has owner and next follow-up time.

### FR-008 CRM Activity

Each lead supports follow-up records: note, reply, quote, status change, call, meeting, handoff.

### FR-009 Quote Foundation

Sales reps can create a quote draft linked to a lead with product cost, logistics cost, target margin, final customer price, quote validity, and approval warning.

### FR-010 Legacy Record Capability

Legacy notes can remain as internal records, but should be renamed in product language to records, research notes, or customer materials.

## 8. Non-Functional Requirements

- Authentication required for all AutoFlow APIs.
- AutoFlow data must be user-owned or team-owned.
- Important workflow, quote, and ownership actions must be auditable.
- No production fallback secret for JWT.
- Mock search results must not be used in production unless explicitly enabled.
- API contracts should be typed and validated.
- Automated tests must cover happy paths and key state transitions.

## 9. Acceptance Criteria

- Product shell no longer presents itself as NoteFlow.
- AutoFlow workflow data persists in PostgreSQL.
- A sales rep can create a workflow and see it after refresh.
- A workflow can generate leads from existing search adapters.
- A lead can generate a human-review outreach task.
- Outreach task status updates persist.
- A quote draft can calculate margin warning.
- Frontend test and build pass.
- Backend build passes.

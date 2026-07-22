# AutoFlow PDD Design

PDD here means product-and-process design for implementation. It turns the accepted transformation proposal into engineering-ready slices.

## 1. Design Principles

- Keep the current Vue + NestJS + PostgreSQL foundation.
- Evolve legacy note capabilities into business records instead of deleting them immediately.
- Persist AutoFlow business data before building deeper automation.
- Keep external integrations behind adapters.
- Treat FOP as the downstream business source of truth for orders, fulfillment, logistics, after-sales, finance, and margin.
- Treat AutoFlow as the pre-CRM sales development cockpit.
- Prefer explicit status machines over free-form string updates.
- Every important workflow, quote, and ownership action should produce an audit event.

## 2. Target Architecture

```text
Frontend Vue Workbench
  → API clients
  → Pinia stores
  → AutoFlow pages

NestJS API
  → Auth / Users
  → AutoFlow Orchestrator
  → Discovery Adapters
  → Lead Scoring
  → Outreach
  → Quote
  → CRM Activity
  → Audit

PostgreSQL
  → workflows
  → leads
  → outreach
  → quotes
  → crm activities
  → audit events

External Systems
  → Search providers
  → AI provider
  → future CRM/FOP/Shopify/Logistics integrations
```

## 3. Backend Modules

### 3.1 `autoflow`

Responsibility:

- Workflow creation and orchestration.
- Workflow stage progression.
- Dashboard aggregation.

Initial entities:

- `WorkflowRunEntity`
- `WorkflowStepEntity`

### 3.2 `leads`

Responsibility:

- Lead CRUD and lead filtering.
- Contact management.
- Lead status transitions.
- Lead ownership fields.

Initial entities:

- `LeadEntity`
- `LeadContactEntity`
- `LeadScoreEntity`

### 3.3 `discovery`

Responsibility:

- Adapter layer over existing Shopify Search and Facebook Ads modules.
- Normalize discovery output into stores, ad creatives, and candidate leads.

Initial entities:

- `AdCreativeEntity`
- `ShopifyStoreEntity`

### 3.4 `outreach`

Responsibility:

- Generate AI-assisted outreach drafts.
- Manage outreach queue.
- Update outreach task status.
- Create CRM activities when status changes.

Initial entities:

- `OutreachTaskEntity`

### 3.5 `quotes`

Responsibility:

- Quote draft creation.
- Product and logistics cost entry.
- Margin calculation.
- Approval warning foundation.

Initial entities:

- `QuoteEntity`
- `QuoteItemEntity`
- `LogisticsQuoteEntity`

### 3.6 `crm`

Responsibility:

- Timeline records.
- Follow-up actions.
- Next action reminders.

Initial entities:

- `CrmActivityEntity`

### 3.7 `audit`

Responsibility:

- Append-only event logs.
- Trace workflow, lead, outreach, quote, and ownership actions.

Initial entities:

- `AuditEventEntity`

## 4. API Contract Draft

### Workflow

```text
GET    /api/autoflow/dashboard
GET    /api/autoflow/workflows
POST   /api/autoflow/workflows
GET    /api/autoflow/workflows/:id
POST   /api/autoflow/workflows/:id/start-discovery
GET    /api/autoflow/workflows/:id/steps
```

### Leads

```text
GET    /api/leads
POST   /api/leads
GET    /api/leads/:id
PATCH  /api/leads/:id
POST   /api/leads/:id/score
GET    /api/leads/:id/timeline
POST   /api/leads/:id/activities
```

### Outreach

```text
GET    /api/outreach/tasks
POST   /api/leads/:id/messages
PATCH  /api/outreach/tasks/:id
```

### Quotes

```text
GET    /api/leads/:id/quotes
POST   /api/leads/:id/quotes
GET    /api/quotes/:id
PATCH  /api/quotes/:id
POST   /api/quotes/:id/calculate
```

## 5. Frontend Pages

| Page | Purpose |
|---|---|
| Dashboard | Sales command center, metrics, next actions |
| Workflows | Workflow list and workflow progress |
| Discovery | Create workflow and run discovery |
| Leads | Lead pool, filters, scoring |
| Lead Detail | Store profile, contacts, timeline, outreach, quotes |
| Outreach | Human-review message queue |
| Quotes | Quote calculator and quote history |
| CRM | Pipeline board and follow-up workload |
| Admin | User/config/audit foundation |

## 6. Frontend Store Design

Current `useAutoFlowStore` can remain for the first round, but should be split after persistence:

- `useWorkflowStore`
- `useLeadStore`
- `useOutreachStore`
- `useQuoteStore`
- `useCrmStore`

Keep API types in one source. Avoid defining the same AutoFlow contracts in both `api/autoflow.ts` and `types/index.ts`.

## 7. Data Migration Strategy

Phase 1:

- Add new AutoFlow tables.
- Keep legacy `notes` and `folders` tables.
- Do not rename the physical database immediately.

Phase 2:

- Rename user-facing note concepts to records/materials.
- Optionally add `record_type` to legacy notes.
- Link records to leads or workflows.

Phase 3:

- Consider database rename from `noteflow` to `autoflow` only after backup and migration scripts exist.

## 8. State Transition Rules

### Lead Status

Allowed transitions:

```text
new → qualified
new → invalid
qualified → contacted
qualified → quoted
contacted → replied
contacted → lost
replied → quoted
quoted → registered
registered → store_connected
store_connected → ordered
ordered → won
any non-terminal → lost
any non-terminal → invalid
```

### Outreach Status

Allowed transitions:

```text
draft → ready
ready → sent
ready → skipped
sent → replied
sent → failed
failed → ready
```

### Quote Status

Allowed transitions:

```text
draft → ready
ready → sent
sent → approved
sent → rejected
sent → expired
```

## 9. Engineering Ground Rules

- Every new backend endpoint must use DTO validation.
- Every new status update must validate allowed transitions.
- Every persisted object must include owner or team ownership where relevant.
- Every cross-module action should create an audit event.
- Search provider adapters must expose mock/dev behavior explicitly.
- Production must not silently use mock data.
- Test each module at service level first, then API level.


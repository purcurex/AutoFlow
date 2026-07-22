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

### 3.8 P1-A Persistence Schema

| Entity | Table | Ownership | Main Relations |
|---|---|---|---|
| `WorkflowRunEntity` | `workflow_runs` | `owner_user_id`, optional `team_id` | Has workflow steps and discovered leads |
| `WorkflowStepEntity` | `workflow_steps` | Inherited from workflow | Belongs to one workflow run; one row per stage |
| `LeadEntity` | `leads` | `owner_user_id`, optional `team_id` | Optionally belongs to a workflow; has contacts, outreach tasks, and CRM activities |
| `LeadContactEntity` | `lead_contacts` | Inherited from lead | Belongs to one lead; unique by lead, type, and value |
| `OutreachTaskEntity` | `outreach_tasks` | `owner_user_id`, optional `team_id` | Belongs to one lead |
| `CrmActivityEntity` | `crm_activities` | `owner_user_id`, optional `team_id` | Belongs to one lead and records timeline/follow-up data |
| `WorkflowLeadEntity` | `workflow_leads` | Inherited from workflow and lead | Many-to-many discovery evidence between workflows and stable leads |
| `AdCreativeEntity` | `ad_creatives` | `owner_user_id`, optional `team_id` | Immutable provider evidence scoped to a workflow run |
| `ShopifyStoreEntity` | `shopify_stores` | `owner_user_id`, optional `team_id` | Store detection evidence; optionally linked to a promoted lead |
| `LeadScoreEntity` | `lead_scores` | `owner_user_id`, optional `team_id` | Explainable score snapshots for a lead and optional workflow run |

Persistence rules:

- Workflow progress and lead score columns are constrained to `0..100`.
- Workflow stages, lead statuses, outreach statuses, contact types, and CRM activity types use named PostgreSQL enums.
- Query indexes cover ownership, workflow relation, lead status, follow-up time, and created/updated timestamps.
- `team_id` remains nullable without a foreign key until a Team aggregate is introduced.
- Legacy `notes` rows can optionally reference `workflow_runs` and `leads`; deleting a linked aggregate sets the legacy link to null.
- Leads are deduplicated by `owner_user_id + normalized_domain`; repeated discovery is recorded in `workflow_leads` instead of creating duplicate customer assets.
- Ad creatives are idempotent by workflow, provider, and a SHA-256 evidence key.
- Shopify store detections are idempotent by workflow and normalized domain.
- Discovery evidence remains separate from customer assets until P2-B promotes normalized candidates into leads.
- `DB_SYNCHRONIZE` defaults to false. Versioned migrations are the schema authority.

## 4. API Contracts

### Current P0 Scaffold

```text
GET    /api/autoflow/dashboard
GET    /api/autoflow/workflows
POST   /api/autoflow/workflows
GET    /api/autoflow/leads
GET    /api/autoflow/leads/:id
PATCH  /api/autoflow/leads/:id/status
POST   /api/autoflow/leads/:id/messages
GET    /api/autoflow/outreach-tasks
PATCH  /api/autoflow/outreach-tasks/:id
GET    /api/autoflow/crm
```

Current contract rules:

- `frontend/src/api/autoflow.ts` is the canonical frontend contract source.
- Backend write endpoints use DTO classes from `backend/src/modules/autoflow/dto/autoflow.dto.ts`.
- Current AutoFlow endpoints stay under the `/api/autoflow` namespace.
- List APIs return `{ items, total, page, pageSize }` and are always scoped by the authenticated owner.
- Status transitions and corresponding CRM activities commit in one database transaction.

### Workflow APIs

```text
GET    /api/autoflow/workflows/:id
GET    /api/autoflow/workflows/:id/steps
```

Implemented in P2:

```text
POST   /api/autoflow/workflows/:id/start-discovery -> 202 Accepted
```

The P2 runner is asynchronous within one application instance. Workflow progress, step outputs, failures, and deduplication keys are persisted in PostgreSQL. A repeated start resumes a failed or interrupted run unless it is already active in the current process. A durable queue worker is required before multi-instance deployment.

### Planned Lead APIs

```text
POST   /api/autoflow/leads
PATCH  /api/autoflow/leads/:id
POST   /api/autoflow/leads/:id/score
GET    /api/autoflow/leads/:id/timeline
POST   /api/autoflow/leads/:id/activities
```

### Planned Quote APIs

```text
GET    /api/autoflow/leads/:id/quotes
POST   /api/autoflow/leads/:id/quotes
GET    /api/autoflow/quotes/:id
PATCH  /api/autoflow/quotes/:id
POST   /api/autoflow/quotes/:id/calculate
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

Keep API types in `frontend/src/api/autoflow.ts`. Do not define AutoFlow contracts in `frontend/src/types/index.ts`.

## 7. Data Migration Strategy

Phase 1:

- Add new AutoFlow tables.
- Keep legacy `notes` and `folders` tables.
- Do not rename the physical database immediately.

P0 compatibility layer (completed):

- Rename user-facing note concepts to business records and record categories.
- Keep legacy routes, modules, and physical tables stable.

Phase 2:

- Optionally add `record_type` to legacy notes.
- Expose record-to-lead and record-to-workflow links in discovery workflows.

P1 persistence decision:

- Define nullable legacy record relationships to `WorkflowRunEntity` and `LeadEntity` after those entities exist.
- Keep current `notes` and `folders` API paths and physical tables unchanged until a versioned migration is available.
- Use `Business Records` (`业务记录`) and `Record Categories` (`记录分类`) in user-facing interfaces.

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

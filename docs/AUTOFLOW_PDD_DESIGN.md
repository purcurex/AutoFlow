# AutoFlow PDD Design

PDD here means product-and-process design for implementation. It turns the accepted transformation proposal into engineering-ready slices.

## 1. Design Principles

- Keep the current Vue + NestJS + PostgreSQL foundation.
- Evolve legacy note capabilities into business records instead of deleting them immediately.
- Persist AutoFlow business data before building deeper automation.
- Keep external integrations behind adapters.
- Treat FOP, built on Kingdee Cloud Cosmic, as the source of truth for formal leads, opportunities, stages, follow-up records, customer data, product cost, logistics rates, and downstream operations.
- Treat AutoFlow as the discovery, contact enrichment, outreach, and customer-quotation cockpit before and around explicit FOP handoff.
- Do not rebuild FOP product-cost or logistics-rating rules inside AutoFlow.
- Keep AutoFlow follow-up deliberately lightweight: latest outcome, next action, note, and handoff status.
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
  → Quote Orchestration
  → Lightweight Follow-Up
  → FOP Integration
  → Audit

PostgreSQL
  → workflows
  → leads
  → outreach
  → quote drafts and provider snapshots
  → local follow-up activities
  → integration calls and FOP references
  → audit events

External Systems
  → Search providers
  → AI provider
  → FOP product-cost, logistics-rate, and lead/opportunity handoff adapters
  → future Shopify integrations
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
- Create lightweight follow-up activities when status changes.

Initial entities:

- `OutreachTaskEntity`

### 3.5 `quotes`

Responsibility:

- Quote draft and customer-facing presentation orchestration.
- Ordered, non-overlapping product quantity tiers.
- Multi-country shipping requests and per-country channel comparison.
- Combined product-tier x destination-country x shipping-channel matrix.
- Invocation of FOP product-cost and logistics-rate ports.
- Immutable request/result snapshots, selected options, source version, currency, units, and validity.
- Transparent presentation arithmetic only; FOP remains responsible for cost, pricing-policy, and logistics-rating rules.

Planned entities:

- `QuoteDraftEntity`
- `ProductQuoteLineEntity`
- `ProductQuoteTierEntity`
- `ShippingQuoteRequestEntity`
- `ShippingQuoteOptionEntity`
- `QuoteCombinationEntity`
- `IntegrationCallEntity`

### 3.6 `follow-up`

Responsibility:

- Keep the latest local outcome, next action, next-action time, and short notes needed to complete outreach, quotation, and handoff.
- Show FOP handoff and synchronization status.
- Avoid duplicating FOP opportunity stages, ownership decisions, and authoritative follow-up history.

Initial entities:

- `CrmActivityEntity` as a compatibility implementation of `FollowUpActivity`.

### 3.7 `fop-integration`

Responsibility:

- Expose `FopProductCostPort`, `FopLogisticsRatePort`, and `FopCrmHandoffPort` to domain services.
- Map AutoFlow contracts to Kingdee Cloud Cosmic transport contracts without leaking dynamic-object fields into the domain.
- Enforce timeout, idempotency, correlation, retry classification, redaction, and source tracking.
- Persist FOP lead/opportunity references and conflicts without overwriting FOP master data.

The exact FOP URLs, authentication, bill/form IDs, field mappings, and error catalogue remain configurable and `TBD` until the FOP API inventory is approved. See `AUTOFLOW_FOP_INTEGRATION_SPEC.md`.

### 3.8 `audit`

Responsibility:

- Append-only event logs.
- Trace workflow, lead, outreach, quote, and ownership actions.

Initial entities:

- `AuditEventEntity`

### 3.9 P1-A Persistence Schema

| Entity | Table | Ownership | Main Relations |
|---|---|---|---|
| `WorkflowRunEntity` | `workflow_runs` | `owner_user_id`, optional `team_id` | Has workflow steps and discovered leads |
| `WorkflowStepEntity` | `workflow_steps` | Inherited from workflow | Belongs to one workflow run; one row per stage |
| `LeadEntity` | `leads` | `owner_user_id`, optional `team_id` | Optionally belongs to a workflow; has contacts, outreach tasks, and CRM activities |
| `LeadContactEntity` | `lead_contacts` | Inherited from lead | Belongs to one lead; unique by lead, type, and value |
| `OutreachTaskEntity` | `outreach_tasks` | `owner_user_id`, optional `team_id` | Belongs to one lead |
| `CrmActivityEntity` | `crm_activities` | `owner_user_id`, optional `team_id` | Temporary local follow-up/action log before or around FOP handoff |
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

### Planned Quote And FOP APIs

```text
GET    /api/autoflow/leads/:id/quotes
POST   /api/autoflow/leads/:id/quotes
GET    /api/autoflow/quotes/:id
PATCH  /api/autoflow/quotes/:id
POST   /api/autoflow/quotes/:id/product-cost-requests
POST   /api/autoflow/quotes/:id/shipping-rate-requests
POST   /api/autoflow/quotes/:id/compose
POST   /api/autoflow/leads/:id/fop-handoffs
GET    /api/autoflow/fop-handoffs/:id
```

Contract rules:

- The frontend calls AutoFlow APIs only; it never calls Kingdee Cloud Cosmic directly.
- Product-cost requests contain product/SKU mapping references and ordered quantity tiers.
- Shipping-rate requests contain explicit destination countries, package data, currency, weight units, and dimension units.
- Combined quote cells reference immutable product-cost and shipping-rate snapshots.
- Missing live FOP configuration returns a clear unavailable state; it does not return invented values.
- Request and response shapes, idempotency, failure handling, and live-enablement gates are defined in `AUTOFLOW_FOP_INTEGRATION_SPEC.md`.

## 5. Frontend Pages

| Page | Purpose |
|---|---|
| Dashboard | Sales command center, metrics, next actions |
| Workflows | Workflow list and workflow progress |
| Discovery | Create workflow and run discovery |
| Leads | Lead pool, filters, scoring |
| Lead Detail | Store evidence, contacts, local next action, outreach, quotes, and FOP handoff |
| Outreach | Human-review message queue |
| Quotes | Product tier editor, destination freight comparison, combined quote matrix, and history |
| Follow-Up | Lightweight next-action queue and FOP synchronization state |
| Admin | User/config/audit foundation |

## 6. Frontend Store Design

Current `useAutoFlowStore` can remain for the first round, but should be split after persistence:

- `useWorkflowStore`
- `useLeadStore`
- `useOutreachStore`
- `useQuoteStore`
- `useFollowUpStore`
- `useFopIntegrationStore` only when asynchronous handoff polling requires separate state

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

### Lead And Follow-Up Status

The existing P1 lead enum remains the compatibility state machine until a versioned migration is approved. It represents AutoFlow work progress only and must not mirror or overwrite FOP opportunity stages. FOP handoff/sync status is stored separately.

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
draft → awaiting_product_cost
draft → awaiting_shipping_rate
awaiting_product_cost → awaiting_shipping_rate
awaiting_shipping_rate → ready
ready → shared
awaiting_product_cost → failed
awaiting_shipping_rate → failed
failed → awaiting_product_cost
failed → awaiting_shipping_rate
ready → awaiting_product_cost
ready → awaiting_shipping_rate
draft / ready / shared → expired
```

## 9. Engineering Ground Rules

- Every new backend endpoint must use DTO validation.
- Every new status update must validate allowed transitions.
- Every persisted object must include owner or team ownership where relevant.
- Every cross-module action should create an audit event.
- Quote calculations must go through replaceable FOP provider ports; domain services must not import Kingdee transport DTOs.
- Money uses decimal-safe storage and explicit currency; countries and measurement units are explicit.
- Production quote providers fail closed when FOP is unavailable or not configured.
- Search provider adapters must expose mock/dev behavior explicitly.
- Production must not silently use mock data.
- Test each module at service level first, then API level.

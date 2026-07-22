# AutoFlow Technical Architecture

## 1. Product Architecture

AutoFlow is an AI-assisted outbound workflow platform for Dropshipping sales teams.

Core business pipeline:

```text
Product keyword / product image
  -> ad discovery
  -> Shopify/store detection
  -> lead cleaning and scoring
  -> AI outreach draft
  -> semi-automated outreach
  -> contact response and lightweight next action
  -> product tier and destination freight quotation
  -> combined customer quote
  -> FOP lead/opportunity handoff
```

The first implementation keeps the original Vue + NestJS full-stack foundation and adds an AutoFlow workbench on top of it.

## 2. Current Runtime Architecture

```text
Vue 3 SPA
  - Vite
  - TypeScript
  - Pinia
  - Vue Router
  - Tailwind CSS
        |
        | /api/*
        v
NestJS API
  - Auth / Users
  - Owner-scoped AutoFlow API
  - Discovery adapters and workflow executor
  - Legacy Notes / Folders
  - Shopify Search provider client
  - Facebook Ads provider client
  - AI service
        |
        v
PostgreSQL via TypeORM

External services:
  - Anthropic API for AI writing
  - SerpAPI for search and Google Lens
  - Host.io / OpenPageRank for traffic estimates
  - Kingdee Cloud Cosmic FOP for formal CRM records, product cost, and logistics rates
```

## 3. Frontend Structure

Important paths:

```text
frontend/src/api/autoflow.ts
frontend/src/stores/autoflow.ts
frontend/src/views/autoflow/
frontend/src/components/layout/
frontend/src/router/index.ts
```

Primary routes:

```text
/                 Dashboard
/workflows        Workflow list
/workflows/new    Create workflow
/leads            Lead pool
/leads/:id        Lead detail
/outreach         Outreach queue
/quotes           Product and freight quote workspace (planned)
/follow-ups       Lightweight next-action and FOP handoff queue (planned)
/crm              Compatibility route for the current lightweight scaffold
/settings         Account settings
/admin            Admin
```

State flow:

```text
View
  -> useAutoFlowStore()
  -> autoflowApi
  -> /api/autoflow/*
```

The frontend currently consumes scaffold API data but is shaped around the future persistent model.

## 4. Backend Structure

Important paths:

```text
backend/src/modules/autoflow/
backend/src/modules/auth/
backend/src/modules/shopify-search/
backend/src/modules/facebook-ads/
backend/src/modules/ai/
backend/src/app.module.ts
```

Current AutoFlow API:

```text
GET   /api/autoflow/dashboard
GET   /api/autoflow/workflows
POST  /api/autoflow/workflows
POST  /api/autoflow/workflows/:id/start-discovery
GET   /api/autoflow/leads
GET   /api/autoflow/leads/:id
POST  /api/autoflow/leads/:id/messages
GET   /api/autoflow/outreach-tasks
PATCH /api/autoflow/outreach-tasks/:id
GET   /api/autoflow/crm
```

P1 and P2 persistence are implemented. `AutoflowService` uses owner-scoped TypeORM repositories, paginated list contracts, explicit status transition maps, and transactions that synchronize outreach, lead status, and CRM activity. The P2 runner persists discovery evidence, progress, errors, deduplicated leads, workflow links, and score snapshots.

Discovery execution is scheduled through the PostgreSQL-backed `workflow_jobs` queue. Workers claim work with `FOR UPDATE SKIP LOCKED`, renew time-bounded leases with heartbeats, retry failures with bounded exponential backoff, and reclaim expired leases after process interruption. Persisted workflow steps remain the business-level checkpoints, so a retried job resumes completed discovery stages instead of discarding evidence.

## 5. Target Domain Model

Current persistent entities:

```text
WorkflowRun
WorkflowStep
WorkflowJob
Lead
LeadContact
OutreachTask
CrmActivity
```

Implemented discovery entities:

```text
AdCreative
ShopifyStore
LeadScore
```

Planned entities:

```text
ProductSeed
MessageDraft
IntegrationAccount
QuoteDraft
ProductQuoteLine
ProductQuoteTier
ShippingQuoteRequest
ShippingQuoteOption
QuoteCombination
IntegrationCall
FopReference
```

Recommended ownership:

```text
workflow-runs       Orchestrates a prospecting run
ad-discovery        Calls ad/search providers
store-detection     Detects Shopify/DTC stores
lead-scoring        Computes lead quality
ai-messaging        Generates outreach copy
outreach            Manages semi-automated sending
follow-up           Tracks only local next actions and handoff state
quote-orchestration Builds reproducible customer quote views from FOP snapshots
fop-integration     Adapts product cost, freight rating, and CRM handoff capabilities
integrations        Stores encrypted provider configurations
```

## 6. FOP Integration Architecture

```text
Vue Quote / Lead Detail pages
  -> AutoFlow quote and handoff APIs
  -> Quote / Handoff application services
  -> FOP provider ports
  -> Kingdee Cloud Cosmic adapter
  -> configured FOP backend operations
```

Architecture boundary:

- AutoFlow owns discovery evidence, contact review, outreach preparation, quote interaction, and reproducible snapshots.
- FOP owns formal leads, opportunities, stages, follow-up history, customer records, product-cost rules, and logistics-rating rules.
- The browser never receives FOP credentials or calls FOP directly.
- Domain code depends on `FopProductCostPort`, `FopLogisticsRatePort`, and `FopCrmHandoffPort`.
- Kingdee Cloud Cosmic URLs, authentication, bill/form IDs, and dynamic-object mappings remain adapter configuration.
- The canonical contract is `docs/AUTOFLOW_FOP_INTEGRATION_SPEC.md`.

Quote dimensions:

```text
product / SKU
x quantity tier
x destination country
x selected shipping channel
= traceable combined customer quote
```

AutoFlow may perform transparent addition and presentation formatting, but it does not reproduce FOP pricing or freight-rating rules. Production calls fail closed when FOP is unavailable.

## 7. Security and Production Rules

Implemented:

- Production no longer falls back to a default JWT secret.
- `JWT_EXPIRES_IN` is now respected.
- Search modules no longer silently return mock data in production unless `ENABLE_MOCK_SEARCH=true`.
- P1-A schema changes use versioned TypeORM migrations with synchronization disabled by default.

Required before production:

- Add request throttling and cost budgets for integration endpoints.
- Add audit logging for lead export and outreach.
- Move integration keys into encrypted storage.
- Add role-based guards for admin and future team workspaces.
- Add idempotency, correlation IDs, timeouts, retry classification, and redacted FOP request logs.

## 8. Build and Local Development

Build commands:

```powershell
npm.cmd run build --workspace=backend
npm.cmd run build --workspace=frontend
```

Migration commands:

```powershell
npm.cmd run db:migration:show
npm.cmd run db:migrate
```

Dev command:

```powershell
npm.cmd run dev
```

Known Windows note:

- `npm` may be blocked by PowerShell execution policy; use `npm.cmd`.
- Vite/concurrently can hit Windows `spawn EPERM` in restricted shells.

## 9. Next Architecture Iterations

Priority order after P2:

1. Rewrite AI message generation around persistent lead context and human review.
2. Add WhatsApp deep-link outreach and channel templates.
3. Add provider idempotency keys and telemetry before paid provider calls.
4. Expand discovery with verified ad-to-store matching and contact enrichment.
5. Add quote navigation, product-tier editor, destination selector, result states, and combined matrix shell.
6. Implement FOP provider ports and contract-test adapters without inventing live Kingdee endpoints.
7. Replace the CRM-oriented page with a lightweight follow-up and FOP handoff queue.
8. Enable live FOP adapters only after the interface inventory and sandbox reconciliation pass.

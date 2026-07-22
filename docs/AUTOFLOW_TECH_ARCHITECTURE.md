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
  -> WhatsApp conversion
  -> CRM follow-up
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
/crm              CRM pipeline
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

The current scheduler runs asynchronously inside one API instance. PostgreSQL state supports explicit restart/resume through the start endpoint, but multi-instance deployment requires a persistent queue worker.

## 5. Target Domain Model

Current persistent entities:

```text
WorkflowRun
WorkflowStep
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
```

Recommended ownership:

```text
workflow-runs       Orchestrates a prospecting run
ad-discovery        Calls ad/search providers
store-detection     Detects Shopify/DTC stores
lead-scoring        Computes lead quality
ai-messaging        Generates outreach copy
outreach            Manages semi-automated sending
crm                 Tracks follow-up and conversion
integrations        Stores API keys/provider configs
```

## 6. Security and Production Rules

Implemented:

- Production no longer falls back to a default JWT secret.
- `JWT_EXPIRES_IN` is now respected.
- Search modules no longer silently return mock data in production unless `ENABLE_MOCK_SEARCH=true`.
- P1-A schema changes use versioned TypeORM migrations with synchronization disabled by default.

Required before production:

- Add request throttling for search and auth endpoints.
- Add audit logging for lead export and outreach.
- Move integration keys into encrypted storage.
- Add role-based guards for admin and future team workspaces.

## 7. Build and Local Development

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

## 8. Next Architecture Iterations

Priority order after P2:

1. Rewrite AI message generation around persistent lead context and human review.
2. Add WhatsApp deep-link outreach and channel templates.
3. Add a persistent queue worker before horizontal scaling.
4. Expand the lead scoring rules engine with verified ad-to-store matching.
5. Add CRM activity timeline UI.
6. Add CSV/Excel export for leads.
7. Continue legacy user-facing language cleanup.

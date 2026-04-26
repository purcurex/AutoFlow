# AutoFlow Refactor Plan

## Product Direction

AutoFlow is being repositioned from a note-taking app into an AI-assisted outbound workflow platform for Dropshipping sales teams.

Core workflow:

```text
Product keyword or product image
  -> Ad discovery
  -> Shopify/store detection
  -> Lead cleaning and scoring
  -> AI message generation
  -> Semi-automated outreach
  -> WhatsApp conversion
  -> CRM follow-up
```

## First-Version Goal

The first refactor should not attempt full automation. It should establish the durable product architecture and a usable workflow shell:

- Sales dashboard as the new home screen.
- Workflow creation and tracking.
- Lead pool and lead detail model.
- Outreach task surface.
- CRM pipeline surface.
- Backend domain modules that can later absorb the existing Shopify, Facebook Ads, AI, and notes capabilities.

## Architectural Principles

- Treat `WorkflowRun` as the primary business process.
- Treat `StoreLead` as the primary sales object.
- Keep legacy notes as secondary remarks/history, not the main product center.
- Use staged workflow steps so each stage can be retried or improved independently.
- Prefer semi-automated outreach first to avoid platform risk.
- Make production failures explicit; do not silently return mock leads in production.
- Keep this first pass scaffold-oriented and buildable, then iterate.

## Target Backend Domains

```text
auth
users
workflow-runs
product-seeds
ad-discovery
store-detection
lead-scoring
ai-messaging
outreach
crm
integrations
admin
legacy-notes
```

## First Backend Scope

Create a new `autoflow` domain module with a consolidated first-pass API:

- `GET /api/autoflow/dashboard`
- `GET /api/autoflow/workflows`
- `POST /api/autoflow/workflows`
- `GET /api/autoflow/leads`
- `GET /api/autoflow/leads/:id`
- `POST /api/autoflow/leads/:id/messages`
- `GET /api/autoflow/outreach-tasks`
- `PATCH /api/autoflow/outreach-tasks/:id`
- `GET /api/autoflow/crm`

This module may use in-memory seed data for the first UI shell, but the data contracts should match the future persistent entities.

## Target Data Contracts

### WorkflowRun

- `id`
- `name`
- `seedType`: `keyword | image`
- `seedValue`
- `targetMarket`
- `status`: `draft | running | completed | failed`
- `currentStage`
- `progress`
- `leadCount`
- `createdAt`
- `updatedAt`

### StoreLead

- `id`
- `workflowRunId`
- `brandName`
- `domain`
- `storeUrl`
- `source`
- `country`
- `language`
- `category`
- `shopifyConfidence`
- `adActivityScore`
- `trafficScore`
- `contactScore`
- `totalScore`
- `status`: `new | qualified | contacted | replied | opportunity | won | lost | invalid`
- `recommendedAngle`
- `contacts`
- `createdAt`

### OutreachTask

- `id`
- `leadId`
- `channel`: `whatsapp | email | instagram | facebook`
- `status`: `draft | ready | sent | replied | skipped`
- `message`
- `nextFollowUpAt`
- `owner`

## Target Frontend Information Architecture

```text
/dashboard        Sales dashboard
/workflows        Workflow list
/workflows/new    Create workflow
/leads            Lead pool
/leads/:id        Lead detail
/outreach         Outreach tasks
/crm              CRM pipeline
/templates        Message templates
/settings         Account and integrations
/admin            Admin
```

## First Frontend Scope

- Rename product shell to AutoFlow.
- Add new dashboard, workflows, leads, outreach, and CRM pages.
- Keep login/register/settings/admin routes functional.
- Add an AutoFlow-specific API client and Pinia store.
- Build a dense, operational UI suitable for daily sales work.

## Agent Team Plan

### Coordinator

Owner: main agent

- Maintain this plan and status file.
- Resolve integration conflicts.
- Run builds.
- Update final summary and next-step backlog.

### Backend Agent

Owner: worker

- Add first-pass `autoflow` backend module.
- Define DTO-like TypeScript interfaces/types.
- Implement scaffold service and controller.
- Register module in `AppModule`.

### Frontend Agent

Owner: worker

- Add AutoFlow API client and store.
- Create dashboard, workflows, leads, outreach, CRM pages.
- Update routes and main layout navigation.
- Remove first known build blocker in AI chat import if touched.

### Docs/Continuity Agent

Owner: worker or coordinator

- Keep `AUTOFLOW_EXECUTION_STATUS.md` current.
- Record changed files and next actions.
- Capture build/test results.

## Quality Gates

- Backend build passes.
- Frontend build passes.
- Existing auth routes remain present.
- New AutoFlow routes compile.
- Status document updated before final response.

## Known Legacy Risks To Address

- Chinese text encoding corruption across docs and source.
- Frontend build failure from unused imports.
- Production JWT default secret fallback.
- No database migration workflow.
- No meaningful tests.
- Mock search results can be mistaken for real results.

## Next Iteration Backlog

- Replace in-memory AutoFlow data with TypeORM entities and migrations.
- Convert existing Shopify and Facebook modules into workflow steps.
- Add background job queue for discovery/scoring/message generation.
- Add lead scoring rules engine.
- Add WhatsApp deep-link outreach.
- Add CRM activity timeline.
- Add CSV/Excel export for leads.

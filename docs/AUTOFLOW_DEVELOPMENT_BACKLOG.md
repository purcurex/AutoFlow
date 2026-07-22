# AutoFlow Development Backlog

This backlog is the execution checklist before and during the formal AutoFlow transformation.

## 0. Resume Protocol

When work is interrupted, resume in this order:

1. Read `docs/AUTOFLOW_PRODUCT_SPEC.md`.
2. Read `docs/AUTOFLOW_PDD_DESIGN.md`.
3. Read `docs/AUTOFLOW_BDD_SCENARIOS.md`.
4. Read this backlog.
5. Read `docs/AUTOFLOW_EXECUTION_STATUS.md`.
6. Run `git status --short`.
7. Continue from the first unchecked P0 task.

## 1. P0 Foundation Tasks

### P0-A Brand And Positioning

- [x] Replace user-facing `NoteFlow` with `AutoFlow`.
- [x] Replace smart-note positioning with outbound sales workflow positioning.
- [x] Update login page copy.
- [x] Update register page copy.
- [x] Update README product description.
- [x] Update DEPLOY product naming where safe.
- [x] Update email verification product copy.
- [x] Update seed admin email/domain decision.
- [x] Review all visible navigation labels.
- [x] Keep migration notes where historical NoteFlow references are useful.

### P0-B Legacy Note Repositioning

- [x] Decide final UI term: `Business Records` (`业务记录`).
- [x] Hide `/notes/:id` from primary navigation.
- [x] Reword note export to business record export.
- [x] Reword folders as record categories where visible.
- [x] Keep backend `notes` module until record migration is implemented.
- [x] Document whether old notes link to leads/workflows in P1 or P2.

### P0-C Development Workflow

- [x] Add frontend Vitest baseline.
- [x] Add backend test command verification.
- [x] Add a root-level `test` or `ci:local` script.
- [x] Add a docs-based definition of done.
- [x] Ensure generated `dist`, `deploy`, and archives remain ignored.
- [x] Confirm Docker database `hyperzone` connection instructions.
- [x] Verify Docker database `hyperzone` connectivity from host and container.
- [x] Remove tracked legacy frontend build artifacts from `backend/public`.

### P0-D Contract Cleanup

- [x] Choose one source for AutoFlow frontend API types.
- [x] Remove or align duplicate AutoFlow interfaces in `frontend/src/types/index.ts`.
- [x] Define backend DTOs for workflow creation and outreach updates.
- [x] Ensure controller methods use DTO classes instead of plain interfaces for writes.

## 2. P1 Persistence Tasks

### P1-A Entities

- [x] Create `WorkflowRunEntity`.
- [x] Create `WorkflowStepEntity`.
- [x] Create `LeadEntity`.
- [x] Create `LeadContactEntity`.
- [x] Create `OutreachTaskEntity`.
- [x] Create `CrmActivityEntity`.
- [x] Add ownership fields: `ownerUserId`, optional `teamId`.
- [x] Add indexes for owner, workflow, lead status, and timestamps.

### P1-B Services

- [x] Replace in-memory workflow list with TypeORM repository.
- [x] Replace in-memory lead list with TypeORM repository.
- [x] Replace in-memory outreach queue with TypeORM repository.
- [x] Implement lead status transition guard.
- [x] Implement outreach status transition guard.
- [x] Create CRM activity on important status changes.

### P1-C Tests

- [x] Test workflow creation persistence.
- [x] Test lead list owner isolation.
- [x] Test lead detail not found across owners.
- [x] Test outreach task update.
- [x] Test invalid status transition rejection.

### P1-D Security And Engineering Gate

- [x] Prevent profile role/property escalation with runtime DTO validation.
- [x] Disable fixed-password admin creation by default.
- [x] Fail closed when production email verification is unavailable.
- [x] Add authentication and throttling to external search endpoints.
- [x] Add normalized lead domains and workflow discovery links.
- [x] Add backend/frontend lint commands.
- [x] Add PostgreSQL API E2E tests.
- [x] Add GitHub Actions CI and database health endpoint.
- [x] Remove vulnerable frontend `xlsx` dependency and use backend export.

## 3. P2 Discovery Workflow Tasks

### P2-A Adapter Integration

- [x] Create discovery service facade.
- [x] Wrap Shopify Search as store discovery adapter.
- [x] Wrap Facebook Ads Search as ad discovery adapter.
- [x] Normalize adapter results into lead candidates.
- [x] Save ad creative records.
- [x] Save Shopify store detection records.

### P2-B Workflow Execution

- [x] Add `POST /api/autoflow/workflows/:id/start-discovery`.
- [x] Add workflow step updates.
- [x] Add discovery progress state.
- [x] Create leads from normalized discovery results.
- [x] Mark workflow completed or failed.

### P2-C Tests

- [x] Test mock adapter behavior in development.
- [x] Test production missing key behavior.
- [x] Test discovery creates leads.
- [x] Test workflow step progression.

### P0-R Release And Security Reopen

- [x] Fix `start:prod` to use the actual Nest build entry.
- [x] Define and automate frontend static hosting or deployment packaging.
- [x] Add a production startup + `/api/health` CI smoke test.
- [x] Sanitize rich-text `v-html` rendering and add security headers/CSP.
- [x] Harden the frontend admin route fallback and align password validation with the backend.

### P2-D Production Discovery And Execution Hardening

- [x] Replace the process-local active-run guard with a PostgreSQL queue/lease worker before paid-provider or multi-instance usage.
- [x] Add startup recovery, heartbeat, expired-lease recovery, and bounded retry budgets.
- [ ] Add provider request idempotency and provider telemetry before enabling paid providers.
- [ ] Replace search-hint advertising records with approved real ad evidence where provider access allows.
- [x] Strengthen Shopify verification and ad-to-store linkage confidence.
- [x] Add contact enrichment with source and verification state.
- [x] Recalibrate scoring so ad activity and contact completeness are evidence-driven rather than fixed values.

## 4. P3 AI Outreach Tasks

- [x] Rewrite AI system prompt for Dropshipping sales outreach.
- [ ] Add message templates for WhatsApp and Email.
- [x] Add persistent lead context to AI outreach generation.
- [x] Generate outreach task from lead detail.
- [x] Add human-review `draft -> ready` status flow.
- [ ] Add next follow-up suggestion.
- [x] Test AI unavailable behavior.
- [x] Test outreach task creation.

## 5. P4 FOP-Backed Quote Workspace Tasks

### P4-A Quote Surface And Domain Contracts

- [x] Add Quotes navigation and lead-detail entry.
- [ ] Add quote draft, version, source, validity, and provider-status UI states.
- [ ] Add product/SKU line editor.
- [x] Add ordered, non-overlapping quantity-tier editor with explicit unit and currency.
- [x] Add multi-country destination selector and package condition editor.
- [ ] Add per-country logistics channel comparison.
- [x] Add product/SKU x quantity tier x destination country x shipping channel matrix shell.
- [ ] Define validated quote DTOs and decimal-safe monetary fields.
- [ ] Persist quote/provider snapshots only after the quote migration is reviewed.

### P4-B FOP Provider Ports And Placeholder Adapters

- [x] Define `FopProductCostPort`.
- [x] Define `FopLogisticsRatePort`.
- [ ] Define integration-call status, idempotency, correlation, timeout, and retry contracts.
- [ ] Add explicit test adapters and fixtures for development/test only.
- [ ] Return a clear unavailable response when production FOP configuration is absent.
- [ ] Preserve source, external request ID, version/effective time, expiration, units, and currency.
- [x] Add authenticated FOP capability discovery that fails closed until live adapters exist.
- [x] Ensure no local mock or estimate is presented as a real FOP price.
- [ ] Add product-tier, multi-country freight, matrix, validation, failure, and duplicate-request tests.

### P4-C Live FOP Enablement Gate

- [ ] Inventory Kingdee Cloud Cosmic authentication, endpoints/operations, bill/form IDs, and field mappings.
- [ ] Confirm FOP product/SKU mapping source and cost contract.
- [ ] Confirm FOP country/channel/package fields and logistics-rate contract.
- [ ] Reconcile approved sandbox fixtures against FOP results.
- [ ] Configure secrets, redaction, metrics, alerts, rollback, and production enablement flag.

Live FOP integration is blocked by the interface inventory, not by the quote UI work. The canonical contract is `AUTOFLOW_FOP_INTEGRATION_SPEC.md`.

## 6. P5 Lightweight Follow-Up And FOP Handoff Tasks

- [x] Reposition `/crm` as a lightweight follow-up/next-action queue and keep a compatibility redirect.
- [ ] Keep only latest outcome, next action, next-action time, note, and handoff status in AutoFlow.
- [x] Define `FopCrmHandoffPort`.
- [ ] Add validated handoff DTOs with the live handoff API.
- [ ] Add FOP lead ID, opportunity ID, sync status, conflicts, and last-sync time references.
- [ ] Add an explicit, idempotent handoff action from lead detail and quote result.
- [ ] Display FOP duplicate, ownership, and stage conflicts without overwriting FOP data.
- [ ] Add handoff activity/audit events and retry handling.
- [ ] Add handoff contract and API tests.
- [ ] Do not implement FOP opportunity stages, ownership rules, or authoritative follow-up history in AutoFlow.

## 7. Suggested Execution Order

1. P0-A Brand And Positioning.
2. P0-B Legacy Note Repositioning.
3. P0-C Development Workflow.
4. P0-D Contract Cleanup.
5. P1-A Entities.
6. P1-B Services.
7. P1-C Tests.
8. P2 Discovery Workflow.
9. P0-R Release And Security Reopen.
10. P2-D Production Discovery And Execution Hardening.
11. P3 AI Outreach.
12. P4-A Quote Surface And Domain Contracts.
13. P4-B FOP Provider Ports And Placeholder Adapters.
14. P5 Lightweight Follow-Up And FOP Handoff.
15. P4-C Live FOP Enablement after the FOP interface inventory and sandbox are available.

## 8. Current Foundation Closeout Changes

These files were changed while closing formal development readiness gaps:

- `.gitignore`
- `package.json`
- `backend/package.json`
- `backend/jest.config.js`
- `backend/src/modules/autoflow/autoflow.service.spec.ts`
- `backend/src/app.module.ts`
- `backend/src/database/seed.ts`
- `backend/src/modules/auth/verification.service.ts`
- `backend/src/modules/seeder/seeder.service.ts`
- `package-lock.json`
- `README.md`
- `DEPLOY.md`
- `docs/AUTOFLOW_DEVELOPMENT_BACKLOG.md`
- `docs/AUTOFLOW_FOUNDATION_READINESS.md`
- removed tracked `backend/public` legacy build artifacts

Verification command:

```powershell
npm.cmd run ci:local
```

Database verification:

```powershell
docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
Test-NetConnection -ComputerName localhost -Port 5432
docker exec hyperzone psql -U postgres -d noteflow -c "select current_database() as database, current_user as user_name;"
```

## 9. P0-B And P0-D Closeout Decisions

- User-facing legacy note terminology is `Business Records` (`业务记录`).
- User-facing legacy folder terminology is `Record Categories` (`记录分类`).
- The `/notes/:id` route remains a compatibility route and is not present in primary navigation.
- Backend `notes` and `folders` modules and their database tables remain unchanged until a versioned migration exists.
- P1 defines nullable record relationships to workflow runs and leads after the new entities exist.
- P2 exposes those relationships in discovery workflows and can create linked records automatically.
- `frontend/src/api/autoflow.ts` is the single source for current AutoFlow frontend API types.
- AutoFlow backend write endpoints use DTO classes from `backend/src/modules/autoflow/dto/autoflow.dto.ts`.

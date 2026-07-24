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
- [x] Add owner-scoped workflow display IDs from `01` to `999999`.
- [x] Backfill historical workflow IDs deterministically and preserve creation timestamps.

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
- [x] Test concurrent workflow ID allocation and cross-owner sequence isolation.

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
- [x] Return workflow short ID, workflow name, workflow creation time, discovery time, and workflow-specific score for every lead discovery occurrence.
- [x] Group the lead pool by source workflow and sort score first, discovery time second.
- [x] Display the workflow name and owner-scoped short ID together in each lead-pool group heading.
- [x] Add a composite workflow/score/discovery-time index for lead-pool retrieval.

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
- [x] Add request correlation IDs and structure access completion logs.
- [x] Persist redacted write-operation audit events without request bodies or secrets.
- [x] Add workflow queue health metrics and stale/failed warning signals.
- [x] Move browser JWT storage from JavaScript-accessible local storage to an HttpOnly SameSite session cookie.
- [x] Lazy-load PDF export dependencies and split legacy editor vendor chunks below the build warning threshold.
- [x] Remove `html2pdf.js` and document the remaining ExcelJS transitive `uuid` moderate-risk exception.

### P2-D Production Discovery And Execution Hardening

- [x] Replace the process-local active-run guard with a PostgreSQL queue/lease worker before paid-provider or multi-instance usage.
- [x] Add startup recovery, heartbeat, expired-lease recovery, and bounded retry budgets.
- [ ] Add provider request idempotency and provider telemetry before enabling paid providers.
- [ ] Replace search-hint advertising records with approved real ad evidence where provider access allows.
- [x] Strengthen Shopify verification and ad-to-store linkage confidence.
- [x] Add contact enrichment with source and verification state.
- [x] Recalibrate scoring so ad activity and contact completeness are evidence-driven rather than fixed values.

### P2-E PipiAds Production Discovery

- [x] Confirm PipiAds/PipiSpy as the primary phase 1 advertising-intelligence provider.
- [x] Add keyword ad discovery through the documented AdSpy list API.
- [x] Add image submission, status polling, similar-ad search, and detail hydration.
- [x] Derive store candidates from landing-page and advertiser-domain evidence.
- [x] Label PipiAds data as secondary evidence requiring official/source-page verification.
- [x] Fail closed in production when `PIPIADS_API_KEY` is unavailable.
- [ ] Obtain the commercial API agreement and written persistence/display rights.
- [ ] Configure the production API key through the deployment secret store.
- [ ] Complete a 14-day latency, coverage, duplicate-rate, and landing-page-validity PoC.

### P2-F Alibaba 1688 Product Sourcing

- [x] Select the official keyword and image-search capabilities from the current Alibaba Open Platform console.
- [x] Add a Git-ignored server-side 1688 credential file and tracked configuration template.
- [x] Require AppKey, AppSecret, access token, and HTTPS gateway when the provider is enabled.
- [x] Freeze the boundary that `1688货源` does not affect customer contact or total scoring.
- [ ] Confirm application approval for `跨境ERP/独立站SaaS数字化解决方案` or the buyer-edition fallback.
- [ ] Confirm `图搜跨境商品` permission for the image-search API.
- [ ] Obtain an authorized 1688 buyer access token and record its expiry/refresh behavior.
- [ ] Capture redacted real responses for keyword search and image search.
- [x] Freeze the cross-border keyword, image, and product-detail API contracts from the downloaded Ocean SDK.
- [ ] Verify the request-signature implementation against the official online API tool.
- [x] Add the TypeScript Param2 client and cross-border keyword/image/detail adapters.
- [x] Add sourcing search, offer, and supplier entities with a reviewed migration.
- [x] Add workflow-sidecar execution, idempotent reuse, manual force retry, and redacted provider telemetry.
- [x] Add the workflow `1688货源` result section and independent sourcing-score explanation.
- [x] Prove through automated tests that sourcing records never alter `contactScore` or customer `totalScore`.

## 4. P3 AI Outreach Tasks

- [x] Rewrite AI system prompt for Dropshipping sales outreach.
- [x] Add message templates for WhatsApp and Email.
- [x] Add persistent lead context to AI outreach generation.
- [x] Generate outreach task from lead detail.
- [x] Add human-review `draft -> ready` status flow.
- [x] Add next follow-up suggestion.
- [x] Test AI unavailable behavior.
- [x] Test outreach task creation.
- [x] Replace Anthropic with the China-region Zhipu GLM REST API.
- [x] Add configurable GLM model, timeout, token limit, and fail-closed behavior.
- [x] Upgrade the default text model to the latest account-authorized flagship `glm-5.2`.
- [x] Keep thinking disabled for short outreach by default and expose validated opt-in reasoning configuration.
- [x] Persist owner-scoped multi-turn outreach conversations and ordered messages.
- [x] Generate strict English and Simplified Chinese draft structures with facts and warnings.
- [x] Preserve immutable bilingual draft versions and supersede prior working drafts.
- [x] Allow human editing before acceptance and create the ready outreach task from English.
- [x] Restore saved conversation options in the lead-detail AI workspace.
- [x] Lock accepted conversations against further messages or draft generation.
- [x] Cover owner isolation, bilingual validation, acceptance, queue creation, and UI restoration.
- [ ] Configure and validate the production `ZHIPU_API_KEY` without committing it.

## 5. Phase 2: P4 FOP-Backed Quote Workspace Tasks

Status: internal contracts and UI foundation active; live Kingdee Cloud Cosmic adapters remain gated by the FOP interface inventory.

### P4-A Quote Surface And Domain Contracts

- [x] Add Quotes navigation and lead-detail entry.
- [x] Add quote draft, version, source, validity, and provider-status UI states.
- [x] Add product/SKU line editor.
- [x] Add ordered, non-overlapping quantity-tier editor with explicit unit and currency.
- [x] Add multi-country destination selector and package condition editor.
- [x] Add two-level FOP custom/actual logistics-channel selection with actual-channel multi-select.
- [x] Add per-country and per-selected-channel logistics comparison.
- [x] Add FOP purchase-cost fields and user-defined product gross margin.
- [x] Add per-selected-channel logistics gross margin.
- [x] Add product/SKU x quantity tier x destination country x shipping channel matrix shell.
- [x] Define validated quote DTOs and decimal-safe monetary fields.
- [x] Persist immutable quote request/provider snapshots through reviewed migrations.
- [x] Export a selected immutable quotation version as a HyperZone template-style Excel workbook.
- [x] Preserve cost, margin, channel, carrier, country, customer amount, source version, and quote version in the export.
- [x] Protect quotation exports with the same owner scope as quotation detail APIs.

### P4-B FOP Provider Ports And Placeholder Adapters

- [x] Define `FopProductCostPort`.
- [x] Define `FopLogisticsRatePort`.
- [x] Define `FopLogisticsCatalogPort` for custom and actual channel master data.
- [x] Define integration-call status, idempotency, correlation, timeout, and retry contracts.
- [x] Add explicit test adapters and fixtures for development/test only.
- [x] Return a clear unavailable response when production FOP configuration is absent.
- [x] Preserve source, external request ID, version/effective time, expiration, units, and currency.
- [x] Add authenticated FOP capability discovery that fails closed until live adapters exist.
- [x] Ensure no local mock or estimate is presented as a real FOP price.
- [x] Add product-tier, multi-country freight, validation, unavailable, and contract-identity tests.
- [ ] Add live matrix, provider failure, timeout, and duplicate-request reconciliation tests.

### P4-C Live FOP Enablement Gate

- [ ] Inventory Kingdee Cloud Cosmic authentication, endpoints/operations, bill/form IDs, and field mappings.
- [ ] Confirm FOP product/SKU mapping source and cost contract.
- [ ] Confirm FOP custom-channel/actual-channel codes, status fields, country/channel/package fields, and logistics-rate contract.
- [ ] Reconcile approved sandbox fixtures against FOP results.
- [ ] Configure secrets, redaction, metrics, alerts, rollback, and production enablement flag.
- [ ] Obtain Kingdee Cloud Cosmic authentication, operation/form IDs, field mappings, and error envelopes.
- [ ] Confirm lightweight SKU/product reference synchronization and real-time pricing/freight ownership.

Live FOP integration is blocked by the interface inventory, not by the quote UI work. The canonical contract is `AUTOFLOW_FOP_INTEGRATION_SPEC.md`.

## 6. P5 Lightweight Follow-Up And FOP Handoff Tasks

- [x] Reposition `/crm` as a lightweight follow-up/next-action queue and keep a compatibility redirect.
- [ ] Keep only latest outcome, next action, next-action time, note, and handoff status in AutoFlow.
- [x] Define `FopCrmHandoffPort`.
- [x] Add validated handoff DTOs with the handoff API.
- [x] Add FOP lead ID, opportunity ID, sync status, conflicts, and last-sync time references.
- [x] Add an explicit, idempotent handoff action from lead detail.
- [ ] Add the same handoff action from a completed quote result.
- [x] Display FOP duplicate, ownership, and stage conflicts without overwriting FOP data.
- [x] Add handoff activity/audit events and retry handling.
- [x] Add handoff contract and API tests.
- [x] Do not implement FOP opportunity stages, ownership rules, or authoritative follow-up history in AutoFlow.

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

## 10. P3 Outreach Workspace And Navigation Closeout

- [x] Move AI prompt templates from personal settings to an authenticated top-level route and sidebar entry.
- [x] Preserve independent `ai_prompt_templates` and `ai_prompt_bindings` persistence with per-user active bindings.
- [x] Make Facebook the default outreach channel, followed by WhatsApp, email, Instagram, and other.
- [x] Add an explicit manual target for the other outreach channel.
- [x] Return linked customer basics and current contact channels with each outreach task.
- [x] Display the linked customer profile, store entry, score, status, and contact channels on the outreach board.
- [x] Make dashboard and follow-up metric cards navigate to corresponding lists.
- [x] Apply lead and outreach status filters from route query parameters.
- [x] Add and apply the PostgreSQL `other` channel enum migration.
- [ ] Update the operation manual only after the user confirms feature optimization is complete.

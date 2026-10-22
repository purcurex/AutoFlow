# AutoFlow Execution Status

## Current Objective

Build the first AutoFlow architecture shell from the previous NoteFlow codebase:

- Persist the refactor plan.
- Add backend AutoFlow API scaffold.
- Add frontend AutoFlow workbench pages.
- Keep the app buildable.

## Resume Instructions

If execution is interrupted, continue from this file:

1. Read `docs/AUTOFLOW_REFACTOR_PLAN.md`.
2. Read this status file.
3. Inspect changed files listed below.
4. Run:

```powershell
npm.cmd run build --workspace=backend
npm.cmd run build --workspace=frontend
```

5. Continue from the first unchecked task.

## Task Board

- [x] Create persistent refactor plan.
- [x] Add backend AutoFlow module and API.
- [x] Register backend module.
- [x] Add frontend AutoFlow API client and store.
- [x] Add dashboard/workflow/leads/outreach/CRM pages.
- [x] Update routes and layout navigation.
- [x] Fix current frontend build blocker.
- [x] Run backend build.
- [x] Run frontend build.
- [x] Update this status file with final changed files and build results.

## Changed Files

- `docs/AUTOFLOW_REFACTOR_PLAN.md`
- `docs/AUTOFLOW_EXECUTION_STATUS.md`
- `backend/src/modules/autoflow/autoflow.types.ts`
- `backend/src/modules/autoflow/dto/autoflow.dto.ts`
- `backend/src/modules/autoflow/autoflow.service.ts`
- `backend/src/modules/autoflow/autoflow.controller.ts`
- `backend/src/modules/autoflow/autoflow.module.ts`
- `backend/src/app.module.ts`
- `frontend/src/api/autoflow.ts`
- `frontend/src/api/index.ts`
- `frontend/src/stores/autoflow.ts`
- `frontend/src/stores/index.ts`
- `frontend/src/types/index.ts`
- `frontend/src/views/autoflow/DashboardView.vue`
- `frontend/src/views/autoflow/WorkflowsView.vue`
- `frontend/src/views/autoflow/LeadsView.vue`
- `frontend/src/views/autoflow/LeadDetailView.vue`
- `frontend/src/views/autoflow/OutreachView.vue`
- `frontend/src/views/autoflow/CrmView.vue`
- `frontend/src/router/index.ts`
- `frontend/src/components/layout/AppLayout.vue`
- `frontend/src/components/layout/Header.vue`
- `frontend/src/components/layout/Sidebar.vue`
- `frontend/src/components/layout/AutoFlowHeader.vue`
- `frontend/src/components/layout/AutoFlowSidebar.vue`
- `frontend/src/components/ai/AIChatPanel.vue`

## Build Results

- Backend: passed with `npm.cmd run build --workspace=backend`.
- Frontend: passed with `npm.cmd run build --workspace=frontend` after running outside the sandbox. The sandboxed Vite build failed with Windows `spawn EPERM`, but type-checking and production build passed when rerun with approval.

## Notes

- Root folder is now `E:\VSCode\AutoFlow`.
- Main app folder is still `E:\VSCode\AutoFlow\work-app`.
- Existing code still contains significant Chinese encoding corruption from the legacy NoteFlow version.
- Historical note: the first scaffold used in-memory data; P1 now uses owner-scoped TypeORM repositories.
- Actual layout currently imports `Header.vue` and `Sidebar.vue`; `AutoFlowHeader.vue` and `AutoFlowSidebar.vue` were added during integration and can be reviewed/removed or reused in the next cleanup pass.


## Formal Transformation Foundation - 2026-07-22

Completed the pre-development foundation for the accepted AutoFlow transformation proposal.

New planning and execution documents:

- `docs/AUTOFLOW_PRODUCT_SPEC.md`
- `docs/AUTOFLOW_BDD_SCENARIOS.md`
- `docs/AUTOFLOW_PDD_DESIGN.md`
- `docs/AUTOFLOW_TEST_PLAN.md`
- `docs/AUTOFLOW_DEVELOPMENT_BACKLOG.md`
- `docs/AUTOFLOW_FOUNDATION_READINESS.md`

Resume order for formal transformation work:

1. Read `docs/AUTOFLOW_PRODUCT_SPEC.md`.
2. Read `docs/AUTOFLOW_PDD_DESIGN.md`.
3. Read `docs/AUTOFLOW_BDD_SCENARIOS.md`.
4. Read `docs/AUTOFLOW_TEST_PLAN.md`.
5. Read `docs/AUTOFLOW_DEVELOPMENT_BACKLOG.md`.
6. Continue from the first unchecked task in `AUTOFLOW_DEVELOPMENT_BACKLOG.md`.

Completed foundation implementation phase:

- P0-A Brand And Positioning.
- P0-B Legacy Note Repositioning.
- P0-C Development Workflow.
- P0-D Contract Cleanup.

Next implementation phase:

- P2 discovery persistence, adapters, and asynchronous workflow execution.


## Latest Optimization Pass - 2026-04-26 17:26:32

Completed high-priority optimizations:

- Added docs/AUTOFLOW_TECH_ARCHITECTURE.md as the technical architecture entry point.
- Added ackend/src/modules/auth/jwt.config.ts.
- Removed production fallback to a default JWT secret. Production now requires JWT_SECRET.
- JWT_EXPIRES_IN is now read from environment configuration.
- Reworked legacy Shopify search service into a clean, buildable adapter with explicit production behavior.
- Reworked legacy Facebook Ads service into a clean, buildable adapter with explicit production behavior.
- Search mock data is only allowed outside production, unless ENABLE_MOCK_SEARCH=true is explicitly set.
- Removed unused rontend/src/components/layout/AutoFlowHeader.vue and rontend/src/components/layout/AutoFlowSidebar.vue.

Build verification:

- Backend: passed with 
pm.cmd run build --workspace=backend.
- Frontend: passed with 
pm.cmd run build --workspace=frontend.

Remaining high-priority work:

- Add discovery persistence and workflow execution on top of P1 repositories.
- Add tests for auth, AutoFlow API, search fallback behavior, and outreach state updates.
- Continue phased cleanup of legacy Chinese encoding corruption in user-facing files.

## P0 Foundation Closeout - 2026-07-22

Completed P0-B Legacy Note Repositioning:

- Selected `Business Records` (`业务记录`) and `Record Categories` (`记录分类`) as user-facing terms.
- Kept `/notes/:id` as a compatibility route and out of primary navigation.
- Kept backend `notes` and `folders` modules unchanged pending a versioned migration.
- Reworded record editing, administration, settings, and export surfaces.
- Assigned relationship modeling to P1 and discovery-facing linkage to P2.

Completed P0-D Contract Cleanup:

- Centralized frontend AutoFlow API contracts in `frontend/src/api/autoflow.ts`.
- Removed conflicting AutoFlow interfaces from `frontend/src/types/index.ts`.
- Switched AutoFlow controller write methods to validated DTO classes.
- Aligned workflow, message-generation, and outreach-update request fields across frontend, controller, and service.
- Added DTO contract tests and legacy-record frontend regression tests.

Verification:

```powershell
npm.cmd run ci:local
```

- Frontend: 2 test files, 3 tests passed; production build passed.
- Backend: 2 test suites, 8 tests passed; Nest production build passed.
- Known non-blocking warning: legacy record/export routes still produce frontend chunks over 500 kB.

P0 verification remains reproducible with the root `ci:local` command.

## P1-A Persistence Foundation - 2026-07-22

Completed:

- Added `WorkflowRunEntity`, `WorkflowStepEntity`, `LeadEntity`, `LeadContactEntity`, `OutreachTaskEntity`, and `CrmActivityEntity`.
- Added owner/team fields, foreign keys, enum contracts, score/progress checks, and operational indexes.
- Added nullable workflow/lead links to legacy business records.
- Added a reusable TypeORM CLI DataSource and explicit migration commands.
- Disabled schema synchronization by default in favor of versioned migrations.
- Added a legacy schema baseline migration and a reversible AutoFlow core migration.
- Applied both migrations to Docker database `hyperzone/noteflow`.
- Made startup admin seeding idempotent across both email and username uniqueness.

Database verification:

- Migration history contains `BaselineLegacySchema1784700000000` and `AddAutoFlowCoreEntities1784700060000`.
- New tables: `workflow_runs`, `workflow_steps`, `leads`, `lead_contacts`, `outreach_tasks`, `crm_activities`.
- Legacy row counts remained unchanged: 4 users, 5 folders, 66 notes.
- TypeORM `schema:log` reports that the schema is up to date.
- Backend: 5 test suites, 25 tests passed.
- Nest `AppModule` initializes and closes cleanly against the migrated database with synchronization disabled.

Resume from P2-A in `docs/AUTOFLOW_DEVELOPMENT_BACKLOG.md`.

## P0.5 And P1 Closeout - 2026-07-22

Completed:

- Closed profile role escalation, fixed-password admin bootstrap, production verification-code leakage, anonymous Facebook Ads access, and unthrottled external endpoints.
- Added production environment validation and a database-backed `/api/health` endpoint.
- Removed frontend `xlsx`; Excel export now uses the authenticated backend ExcelJS endpoint.
- Froze the P1 status model and added versioned enum alignment migration.
- Added normalized lead domains and `workflow_leads` discovery evidence with a versioned migration.
- Replaced all AutoFlow in-memory collections with owner-scoped TypeORM repositories.
- Added paginated list contracts, transition guards, and transactional CRM activity updates.
- Added ESLint, isolated PostgreSQL E2E tests, production dependency audit, and GitHub Actions CI.

Verification target:

```powershell
npm.cmd run ci:local
```

Next phase: P2 Discovery Workflow.

## P1 Quality Gate Verification - 2026-07-22

Final verification completed after increasing the PostgreSQL E2E suite timeout to 30 seconds for migration and Nest application startup:

- Frontend lint passed.
- Backend lint passed.
- Frontend: 2 test files, 3 tests passed.
- Backend: 9 test suites, 38 tests passed.
- PostgreSQL E2E: 1 test suite, 5 tests passed.
- Frontend production build passed.
- Backend production build passed.
- All four TypeORM migrations are applied to `hyperzone/noteflow`.
- The isolated `autoflow_test` database is empty after E2E cleanup.
- `git diff --check` passed.

Production dependency audit has no high or critical findings. Two moderate findings remain through ExcelJS's internal `uuid@8` dependency and are documented as an accepted, reviewed exception in `docs/AUTOFLOW_SECURITY_BASELINE.md`.

P0.5 and P1 are ready to be committed as the baseline for P2-A Adapter Integration.

## P2-A Discovery Adapter Foundation - 2026-07-22

Completed:

- Added `AdCreativeEntity`, `ShopifyStoreEntity`, and structured `LeadScoreEntity` persistence.
- Added migration `AddDiscoveryEvidence1784710000000` with ownership, team extension fields, constraints, indexes, and reversible table creation.
- Wrapped Facebook Ads and Shopify Search behind provider-neutral discovery adapter contracts.
- Added an owner-scoped discovery facade that validates workflow ownership before external calls.
- Added deterministic ad evidence keys and normalized-domain store deduplication.
- Normalized Shopify detections into lead candidates without prematurely creating CRM leads.
- Preserved provider evidence in JSONB for later scoring and audit work.

Database verification:

- All five TypeORM migrations are applied to `hyperzone/noteflow`.
- TypeORM `schema:log` reports no schema drift.
- Legacy row counts remain unchanged: 4 users, 5 folders, 66 business records.
- New discovery tables are empty before P2-B workflow execution.

Quality gate:

- Frontend: 2 test files, 3 tests passed.
- Backend: 11 test suites, 49 tests passed.
- PostgreSQL E2E: 1 test suite, 5 tests passed.
- Frontend and backend production builds passed.
- Production dependency audit has no high or critical findings.

Next phase: P2-B Workflow Execution.

## P2-B And P2-C Discovery Execution - 2026-07-22

Completed:

- Added owner-scoped `POST /api/autoflow/workflows/:id/start-discovery` with `202 Accepted`.
- Added workflow-list start/retry controls with automatic progress refresh.
- Added single-instance asynchronous execution with duplicate-run protection.
- Persisted workflow progress, step output, step errors, completion, and failure state.
- Reused completed discovery evidence when resuming an interrupted workflow.
- Promoted store candidates into leads with `owner_user_id + normalized_domain` upsert behavior.
- Linked workflows, leads, and Shopify detections without duplicating stable customer assets.
- Added explainable `rules-v1` score snapshots and an upsert-compatible unique index.
- Kept seed-level ad evidence out of store-specific ad scores until a verified match exists.
- Marked deferred message, outreach, and CRM steps as `skipped` instead of reporting false completion.
- Added development mock and production provider fail-closed tests.
- Added PostgreSQL E2E coverage for the complete discovery workflow and owner isolation.

Recovery contract:

- Active duplicate starts return without scheduling another run.
- Failed or process-interrupted runs can be started again and resume from persisted step/evidence state.
- Completed and cancelled workflows reject discovery restarts.
- A persistent queue worker remains required before horizontal or multi-instance deployment.

Quality gate:

- Frontend: 2 test files, 3 tests passed.
- Backend: 13 test suites, 55 tests passed.
- PostgreSQL E2E: 1 test suite, 6 tests passed.
- All seven TypeORM migrations are applied and `schema:log` reports no drift.
- Frontend and backend production builds passed.
- Production dependency audit has no high or critical findings.

Next phase: P3 AI Outreach.

## 14. 2026-07-22 Scope Alignment: Quote And FOP

Decision:

- AutoFlow focuses on product/store discovery, contact enrichment, rapid qualification, outreach preparation, and customer quotation efficiency.
- FOP is built on Kingdee Cloud Cosmic and remains the system of record for formal leads, opportunities, opportunity stages, follow-up records, customers, product cost, and logistics rates.
- AutoFlow will not build a full CRM or duplicate FOP product-cost and freight-rating models.
- Existing `CrmActivityEntity` remains a compatibility implementation for lightweight local next actions until a versioned rename is justified.

Quotation scope:

- Product quotation supports ordered quantity tiers.
- Freight quotation supports multiple destination countries and FOP-returned channels.
- Combined quotation supports product/SKU x quantity tier x destination country x shipping channel.
- AutoFlow stores traceable request/result snapshots and composes customer-facing output from selected FOP results.
- This phase reserves page controls, internal APIs, provider ports, test adapters, and failure states; it does not claim a live FOP connection.

Planning artifacts updated:

- `AUTOFLOW_PRODUCT_SPEC.md`
- `AUTOFLOW_PDD_DESIGN.md`
- `AUTOFLOW_FOP_INTEGRATION_SPEC.md`
- `AUTOFLOW_BDD_SCENARIOS.md`
- `AUTOFLOW_TEST_PLAN.md`
- `AUTOFLOW_DEVELOPMENT_BACKLOG.md`
- `AUTOFLOW_TECH_ARCHITECTURE.md`
- `AUTOFLOW_TRANSFORMATION_PROPOSAL.md`

Revised delivery order:

1. Close production-startup and rich-text security blockers.
2. Add persistent workflow execution before production paid-provider usage.
3. Complete real discovery/contact enrichment and P3 human-reviewed outreach.
4. Build P4-A quote UI/domain contracts and P4-B FOP provider ports/test adapters.
5. Build P5 lightweight follow-up and idempotent FOP handoff.
6. Enable P4-C live FOP adapters only after interface inventory and sandbox reconciliation.

## 15. 2026-07-22 Code Alignment Pass

Completed release and security work:

- Fixed the production Nest entry and automated Vue packaging into generated `backend/dist/public`.
- Added SPA route fallback and a production smoke test for database health, frontend serving, CSP, and security headers.
- Added Helmet, explicit DOMPurify sanitization, fail-closed admin routing, and frontend/backend password-rule alignment.
- Removed six unused duplicate AutoFlow view implementations.

Completed Spec alignment work:

- Replaced the hard-coded outreach message with the AI sales-outreach service and persistent lead context.
- AI failures no longer create empty tasks; successful generations start as `draft` and require human review before `ready`.
- Added legal state-aware actions to the outreach queue.
- Replaced the CRM navigation surface with `/follow-ups`; `/crm` remains a compatibility redirect.
- Added quote navigation, lead-detail entry, product/SKU reference, quantity tiers, multi-country/package conditions, and a combined quote matrix shell.
- Added FOP product-cost, logistics-rate, and CRM-handoff provider ports plus authenticated capability discovery.
- FOP capabilities report `not_implemented` and return no price values until real Kingdee Cloud Cosmic adapters are available.

Quality gate:

- Frontend: 3 test files, 6 tests passed.
- Backend: 15 test suites, 59 tests passed.
- PostgreSQL E2E: 1 test suite, 7 tests passed.
- Production build/package/start smoke passed.
- Production dependency audit has no high or critical findings; two moderate transitive `uuid` findings remain through ExcelJS.

## 16. 2026-07-22 Persistent Workflow Queue

Completed execution reliability work:

- Added the `workflow_jobs` PostgreSQL entity and migration with one durable job per workflow run.
- Replaced process-local scheduling with transactional enqueue and row-level workflow locking.
- Added multi-instance-safe job claiming through `FOR UPDATE SKIP LOCKED`.
- Added worker leases, periodic heartbeat, expired-lease recovery, bounded retry attempts, and exponential retry delay.
- Preserved `workflow_steps` as business checkpoints so retries reuse completed discovery evidence.
- Added migration, entity, worker retry, and PostgreSQL E2E assertions for final job completion.

Verification:

- New migration applied successfully to the local `autoflow` database.
- Queue-focused unit and metadata tests: 30 passed.
- PostgreSQL E2E: 7 passed, including `workflow_jobs.status = completed` and `attempts = 1`.
- Backend build and lint passed.

## 17. 2026-07-22 Discovery Evidence And Scoring

Completed discovery-quality work:

- Added store verification status, timestamp, evidence, and persisted contact evidence.
- Added production storefront HTML verification with Shopify marker detection and bounded response size/time.
- Added outbound URL controls that reject localhost, private IPv4, link-local, and private IPv6 targets before requests.
- Added Email, WhatsApp, Instagram, Facebook, LinkedIn, and website extraction with source URL, source type, verification state, and confidence.
- Added conservative ad-to-store matching based on advertiser identity or multiple shared evidence tokens.
- Replaced fixed ad/contact/risk values with `rules-v2-evidence` scoring.
- Kept local provider fixtures explicitly marked `mock`; they do not become verified storefronts.
- Exposed contact evidence status, confidence, and source in the lead detail UI.

Verification:

- Discovery, adapter, worker, migration, entity, and SSRF-control tests: 37 passed.
- PostgreSQL E2E: 7 passed with three persisted contact evidence records and evidence-driven score snapshots.
- Local database migration `AddDiscoveryVerificationEvidence1784713000000` applied successfully.

## 18. 2026-07-22 Versioned Quotation Foundation

Completed quote-domain work:

- Added owner-scoped `quotations` and immutable `quotation_versions` entities.
- Added validated product/SKU, ordered quantity-tier, multi-country, and package DTOs.
- Kept customer prices as decimal strings in API snapshots to avoid binary floating-point money errors.
- Added request snapshots, provider result snapshots, independent product-cost/logistics statuses, source version, effective time, and expiration fields.
- Added create, list, detail, and create-new-version APIs under `/api/autoflow/quotes`.
- Added pessimistic locking when allocating the next quotation version.
- Connected the quote workspace Save action; each subsequent save creates a new immutable version.
- Kept FOP request controls unavailable until real capabilities exist; saving a draft never invents provider results.

Verification:

- Migration/entity tests: 32 passed.
- PostgreSQL E2E: 8 passed, including owner isolation and version 1 to version 2 snapshots.
- Full backend/frontend lint and production build passed.
- Local database migration `AddQuotationSnapshots1784714000000` applied successfully.

## 19. 2026-07-22 FOP Modes And Contract Fixtures

Completed FOP integration preparation:

- Added explicit `disabled`, non-production `sandbox`, and `live` modes.
- Added fail-closed capability reasons and a `syntheticData` marker.
- Added deterministic development/test adapters for product cost, logistics rates, and CRM handoff.
- Added contract reconciliation tests for product lines, quantity tiers, currencies, countries, channels, request identity, and source version.
- Prohibited sandbox capability advertisement in production.
- Added `AUTOFLOW_FOP_CONFIGURATION_INVENTORY.md` with required configuration, authentication questions, operation/form IDs, field mappings, error cases, and live reconciliation gate.
- Updated `.env.example` with AutoFlow database naming, storefront controls, and FOP configuration placeholders.

Verification:

- FOP capability and contract tests: 6 passed.
- PostgreSQL application E2E: 8 passed with default FOP mode remaining unavailable.
- Full lint and backend build passed.

External gate:

- Live mode remains unavailable until Kingdee Cloud Cosmic endpoints/operation IDs, credentials, field mappings, and approved sandbox evidence are supplied and reconciled.

## 20. 2026-07-22 Idempotent FOP Handoff

Completed lightweight handoff work:

- Added one owner-scoped `fop_handoffs` record per AutoFlow lead.
- Added a stable unique idempotency key, attempt count, retryable unavailable/failed states, and fresh-pending suppression.
- Added FOP lead ID, opportunity ID, conflicts, last error, and last-sync time without copying FOP opportunity stages.
- Added authenticated read/create APIs at `/api/autoflow/leads/:leadId/fop-handoff`.
- Added a lead-detail action and visible sync/conflict state.
- Added a lightweight handoff activity record for local next-action history.
- Default disabled mode persists an honest `unavailable` result instead of fabricating FOP identifiers.

Verification:

- Migration, entity, capability, and FOP contract tests: 40 passed.
- PostgreSQL E2E: 9 passed, including owner isolation, retry attempt increment, stable idempotency key, and one-row uniqueness.
- Full lint and production build passed.
- Local database migration `AddFopHandoffs1784715000000` applied successfully.

## 21. 2026-07-22 Semi-Automated Outreach Delivery

Completed outreach ergonomics:

- Added channel-specific WhatsApp, Email, Instagram, and Facebook AI template rules.
- Added persisted target contact, Email subject, and template version to outreach tasks.
- Selects the highest-confidence verified contact for the requested channel.
- Added WhatsApp and Email deep links only after human approval; AutoFlow does not send automatically.
- Added state-aware next-action suggestions for review, manual send, follow-up, reply qualification, and retry.
- Added visible subject, next action, and manual channel-open action in the outreach queue.

Verification:

- AI, outreach service, and migration tests: 18 passed.
- PostgreSQL E2E: 9 passed, including WhatsApp target selection, template identity, and encoded send URL.
- Local database migration `AddOutreachDeliveryContext1784716000000` applied successfully.

## 22. 2026-07-22 Audit And Observability

Completed operational visibility:

- Added accepted-or-generated `X-Correlation-ID` propagation on every API request/response.
- Added structured request completion logs with correlation ID, method, path, status, outcome, duration, and actor ID.
- Added persistent write-operation audit events for successful and failed POST/PUT/PATCH/DELETE requests.
- Audit records intentionally exclude request/response bodies, authorization headers, credentials, and provider secrets.
- Added owner-scoped audit history at `/api/autoflow/audit-events`.
- Extended public health output with aggregate workflow queue status and stale-lease counts only.
- Added server warning signals when failed jobs or stale leases require attention.

Verification:

- Migration/entity tests: 37 passed.
- PostgreSQL E2E: 10 passed, including correlation response propagation and payload-free audit persistence.
- Full lint and backend build passed.
- Local database migration `AddAuditEvents1784717000000` applied successfully.

## 23. 2026-07-22 Browser Security And Frontend Packaging

Completed security and packaging work:

- Replaced JavaScript-accessible JWT storage with an `HttpOnly`, `SameSite=Lax`, path-scoped session cookie.
- Production cookies require HTTPS through the `Secure` flag.
- Login/register responses no longer expose JWT values to frontend JavaScript.
- Added cookie logout/clear behavior and cookie extraction while retaining Bearer compatibility for non-browser clients.
- Converted Axios, upload, streaming AI, and Shopify fetch calls to credentialed cookie requests.
- Removed static `html2pdf.js`, reusing lazy `jsPDF`/`html2canvas` exports instead.
- Split Tiptap/ProseMirror and syntax-highlight vendor code into lazy editor chunks.
- Reduced Settings from about 946 kB to about 10 kB and NoteDetail route code from about 552 kB to about 17 kB; no build chunk exceeds 500 kB.
- Added `AUTOFLOW_SECURITY_RISK_REGISTER.md` for the remaining two moderate ExcelJS/UUID findings.

Verification:

- Cookie-authenticated PostgreSQL E2E: 10 passed, including HttpOnly/SameSite assertions and absence of a token response field.
- Frontend tests: 6 passed.
- Frontend/backend builds and lint passed.
- Production audit has zero high/critical findings. Two moderate findings remain accepted and monitored because the observed ExcelJS call path uses unaffected UUID v4 without a buffer; forced remediation would downgrade ExcelJS across a major compatibility boundary.

## 24. 2026-07-22 Ordered Optimization Closeout

Final gate results:

- Root `npm run ci:local`: passed in full.
- Frontend: 3 test files, 6 tests passed.
- Backend: 18 test suites, 79 tests passed.
- PostgreSQL E2E: 10 tests passed.
- Migrations: all 13 source migrations applied to the local `autoflow` database.
- Local API/database health: `status=ok`, `database=up`, `workflowQueue.stale=0`.
- Production frontend package, Nest startup, SPA fallback, CSP/security headers, and health smoke: passed.
- Production dependency gate: zero high or critical findings; two documented moderate findings.
- Browser title and first-viewport branding use `AutoFlow`.

Conclusion:

The project now has a sustainable development baseline for AutoFlow discovery, evidence-backed lead qualification, human-reviewed outreach, versioned quotations, lightweight FOP handoff, durable execution, security, and observability. It is ready for the next controlled implementation phase and internal acceptance testing.

The project is not yet ready to claim live FOP or real advertising-library production integration. Those capabilities remain correctly fail-closed pending external Kingdee Cloud Cosmic interface inventory, credentials, approved sandbox evidence, and an approved real ad-evidence provider.

Next implementation boundary:

1. Connect an approved real ad-library evidence source and reconcile ad-to-store matches.
2. Complete FOP live authentication/operation/field inventory and staging adapters.
3. Add multi-product quote line editing, live provider request execution, country/channel comparison, and combined result selection.
4. Add quote-result-to-FOP handoff and live duplicate/timeout/partial-result reconciliation tests.
5. Complete lightweight local next-action fields without duplicating FOP opportunity stages or authoritative CRM history.

## 25. 2026-07-22 Phase 1 Provider And Scope Decision

Implemented in code:

- Confirmed PipiAds as the primary Phase 1 keyword and image advertising discovery provider.
- Added normalized PipiAds evidence, bounded image-task polling, request deduplication, production fail-closed behavior, and clearly labelled development fixtures.
- Kept Shopify classification independent: candidate domains are verified through storefront enrichment before Shopify is asserted.
- Replaced Anthropic integration with backend-only Zhipu GLM REST integration, configurable through `ZHIPU_API_KEY` and `ZHIPU_MODEL`.
- Upgraded the default GLM model to `glm-5.2`; short outreach defaults to no thinking, while complex analysis can opt into validated reasoning settings.
- Completed the two P0 FOP contract gaps: product pricing policy/margin context and freight origin/product context.
- Deferred live Kingdee Cloud Cosmic adapters and quotation expansion to `AUTOFLOW_PHASE_2_PLAN.md`.

Pending external enablement:

1. Inject PipiAds and Zhipu credentials through the environment secret store.
2. Run the documented PipiAds 14-day accuracy and freshness validation before production reliance.
3. Begin FOP Phase 2 only after the Kingdee interface inventory, master-data ownership, and approved sandbox evidence are available.

Verification:

- Root `npm.cmd run ci:local`: passed in full.
- Frontend: 3 test files, 6 tests passed.
- Backend: 19 test suites, 88 tests passed.
- PostgreSQL E2E: 10 tests passed, including the PipiAds evidence and no-fabricated-contact boundary.
- Frontend/backend production build and packaged SPA smoke: passed.
- Production dependency gate: zero high or critical findings; the two previously documented ExcelJS/UUID moderate findings remain.

## 26. 2026-07-22 GLM-5.2 Default Model Upgrade

Completed:

- Changed the default Zhipu text model from `glm-4.7-flash` to the latest account-authorized flagship `glm-5.2`.
- Kept deep thinking disabled by default for short outreach, summarization, translation, and polishing requests.
- Added validated opt-in `ZHIPU_THINKING_TYPE` and `ZHIPU_REASONING_EFFORT` settings for future complex analysis.
- Aligned the default temperature with the GLM-5.2 migration recommendation while retaining an environment override.
- Preserved server-only API key handling, bounded tokens/timeouts, and redacted provider failures.

Verification:

- AI service tests: 4 passed, including default GLM-5.2 and explicit reasoning configuration.
- Full backend: 19 test suites, 89 tests passed.
- Backend lint and production build passed.
- Live GLM validation remains pending until `ZHIPU_API_KEY` is configured.

## 27. 2026-07-22 Provider Credential Handoff

Completed:

- Added the Git-ignored `backend/.env.providers.local` file for Zhipu and PipiAds credentials.
- Added a tracked `.env.providers.local.example` template with GLM-5.2 and bounded PipiAds defaults.
- Configured Nest to load the provider-local file before the existing application `.env`.
- Added `npm.cmd run test:providers:live` for a redacted, low-cost live contract check.
- The live check uses one minimal GLM completion and requests at most one PipiAds result.

Next handoff:

1. The project owner enters `ZHIPU_API_KEY` and `PIPIADS_API_KEY` locally.
2. Engineering runs the live smoke and reconciles actual provider payloads with normalized evidence.
3. Engineering executes a real keyword workflow, a real image workflow, store verification, contact extraction, and reviewed GLM outreach generation.

Verification:

- Provider smoke script syntax and missing-key fail-before-network behavior passed.
- Git ignore verification for `.env.providers.local` passed.
- Backend lint and production build passed.
- Backend: 19 test suites, 89 tests passed.
- PostgreSQL E2E: 10 tests passed with the provider-local configuration file present.

## 28. 2026-07-22 Live Provider Integration Attempt

Observed against the configured local credentials:

- Both `ZHIPU_API_KEY` and `PIPIADS_API_KEY` were loaded without exposing their values.
- Zhipu reached the GLM endpoint but returned HTTP 429 with provider code `1113`: no balance or usable resource package.
- PipiAds reached the Open API gateway but returned provider code `442`: credits not enough.
- No real model output or advertising record was returned, persisted, or presented as successful evidence.

Hardening completed from the live finding:

- Provider smoke checks now run independently, retry bounded HTTP 429 responses, and emit redacted provider codes/messages.
- The smoke can target one provider with `--provider=zhipu` or `--provider=pipiads`.
- A configured PipiAds provider failure no longer falls back to mock evidence in development.
- Synthetic discovery remains available only when the PipiAds key is absent outside production.

External unblock conditions:

1. Add a usable BigModel balance/resource package for the general `glm-5.2` API endpoint.
2. Add PipiAds Open API credits.
3. Re-run the live smoke before keyword, image, storefront, contact, and outreach end-to-end validation.

Regression verification:

- Root `npm.cmd run ci:local`: passed in full after fail-closed hardening.
- Frontend: 3 test files, 6 tests passed.
- Backend: 19 test suites, 90 tests passed.
- PostgreSQL E2E: 10 tests passed.
- Production build, packaged SPA smoke, and high/critical dependency gate passed.

## 29. 2026-07-22 Bilingual UI And HyperZone Visual Refresh

Completed:

- Added `vue-i18n` with Simplified Chinese as the default interface language and English as the alternate language.
- Persisted language choice in `autoflow-locale`; all routed AutoFlow pages, authentication, settings, administration, status labels, legacy record detail, export dialog, AI panel, and editor tooltips use the shared translation catalog.
- Added persistent white and black themes through `autoflow-theme`, with immediate switching from the header and settings page.
- Integrated the transparent HyperZone logo asset into authentication, desktop navigation, and mobile navigation.
- Rebuilt the shared visual system for buttons, inputs, panels, tables, metrics, notices, status badges, empty states, focus states, and responsive spacing.
- Reworked the application shell with collapsible desktop navigation, mobile drawer/overlay behavior, localized page titles, compact user controls, and consistent quick actions.
- Refreshed Dashboard, Workflows, Leads, Lead detail, Outreach, Quotes, Follow-up, Settings, Admin, Login, Register, Not Found, and legacy record detail layouts.
- Extended the real-browser screenshot script to capture Chinese light, English, black theme, and 390 px mobile states.

Verification:

- Frontend lint passed.
- Frontend tests: 4 files, 8 tests passed, including language and theme persistence.
- Frontend production build passed.
- Real authenticated screenshots were reviewed at 1440 x 960 and 390 x 844; no incoherent overlap, blank page, clipped form, or broken mobile navigation was observed.
- Simplified Chinese operation manual and screenshots were synchronized with the refreshed interface.

## 30. 2026-07-22 Simplified Chinese HTML Operation Manual

Completed:

- Added the standalone `docs/AUTOFLOW_USER_MANUAL_ZH-CN.html` operation manual with a 15-chapter responsive table of contents.
- Documented the complete product boundary, layered system architecture blueprint, end-to-end business flow, four-role swimlane, decision branches, and exception handling.
- Added step-by-step guidance for login, workflow creation, lead qualification, AI outreach, quotation entry, FOP handoff, settings, and administration.
- Embedded the refreshed Chinese light-theme, English, black-theme, and mobile interface screenshots from `docs/assets/user-manual/`.
- Added local HyperZone branding, offline styles, print page rules, and a one-click browser print/PDF action without external CDN dependencies.

Verification:

- All 15 table-of-contents anchors resolve to document sections.
- All 15 local image references resolve; no missing manual assets were found.
- Desktop browser rendering at 1440 px and mobile browser rendering at 390 px were visually reviewed.
- The HTML works as a local file and the final diff passes whitespace validation.

## 31. 2026-07-22 Light Manual Visual Standard

Completed:

- Standardized all referenced operation-manual screenshots on the light theme and removed the obsolete black-theme screenshot asset and references.
- Replaced the HTML cover, architecture blueprint, swimlane, decision end state, numbered steps, and footer dark surfaces with light-blue or white high-contrast surfaces.
- Updated the desktop login presentation panel from black to light blue and recaptured the Chinese login screenshot.
- Standardized the HyperZone icon container on a white background with a subtle border in both the application and HTML manual.
- Updated the screenshot automation to force Simplified Chinese light mode before capture and stop generating a dark dashboard screenshot.

Verification:

- Frontend lint and production build passed.
- The refreshed login screenshot was reviewed at 1440 x 960.
- The HTML cover and architecture blueprint were reviewed in Edge at 1440 px; labels, arrows, boxes, and notes remained readable.
- No active manual, frontend, or screenshot-script reference to the obsolete dark dashboard screenshot remains.

## 32. 2026-07-22 Priority Target Market Selector

Completed:

- Replaced free-text target-market entry with five single-select cards ordered as US, EU, CA, AU, and OT.
- Added stable flag assets for the United States, European Union, Canada, and Australia; OT uses a globe icon and means region-unrestricted search.
- Preserved normalized backend values while expanding the European Union to all 27 member-state region codes for PipiAds requests.
- Added bilingual market names and guidance, responsive two-column mobile behavior, and synchronized HTML/Markdown manual instructions and screenshots.

Verification:

- Desktop and 390 px mobile browser rendering passed with five market radio controls and United States selected by default.
- Frontend lint, 8 tests, and production build passed.
- Backend lint, production build, and all 8 PipiAds service tests passed.

## 33. 2026-07-23 Workflow Failure Recovery And Lifecycle

Completed:

- Added persisted workflow revision lineage with parent workflow, root workflow, revision number, and archive timestamp.
- Added owner-scoped workflow details, deletion-impact preview, revision creation, archive, and safe-delete APIs.
- Classified provider failures into unavailable provider, insufficient credits, unreachable image, no results, and unknown failure states.
- Added direct retry for unchanged searches and “revise and rerun” for corrected product seeds, markets, and Google search options.
- Added failure-details, archive, and deletion confirmation dialogs in Simplified Chinese and English.
- Physical deletion is limited to draft, failed, and cancelled workflows without revision descendants.
- Workflow deletion removes workflow-specific jobs, steps, evidence, and links while preserving owner-level lead records.
- Archived workflows are excluded from active workflow lists and dashboard activity.
- The operation manual remains unchanged until the user confirms that feature optimization is complete.

Verification:

- Backend unit tests: 20 suites, 107 tests passed.
- Frontend tests: 8 files, 20 tests passed.
- PostgreSQL E2E: 14 tests passed, including revision lineage, owner isolation, archive visibility, and lead-preserving deletion.
- Frontend lint and production build passed.

## 34. 2026-07-23 Global External Link Navigation

Completed:

- Added an application-wide external-link policy that distinguishes AutoFlow internal routes from outbound destinations.
- Storefronts, product pages, Facebook profiles, evidence URLs, WhatsApp, email, telephone, and other external destinations now open in a new browser tab.
- Added `noopener noreferrer` protections while preserving any existing link relationship attributes.
- Added click and auxiliary-click safeguards plus mutation observation for links rendered dynamically after startup.
- Updated the rich-text editor to persist secure new-tab attributes on generated links.
- Existing internal Vue Router navigation remains in the current tab.
- The operation manual remains unchanged until the user confirms that feature optimization is complete.

Verification:

- Frontend lint passed.
- Frontend tests: 9 files, 23 tests passed, including static, dynamic, internal, and external link cases.
- Frontend production build passed.

## 35. 2026-07-23 Multi-Turn Bilingual AI Outreach

Completed:

- Replaced the lead-detail one-click AI draft surface with an owner-scoped GLM collaboration workspace.
- Added persisted conversations and ordered user/assistant messages so a sales rep can refine product focus, value proposition, tone, quotation mode, and call to action over multiple turns.
- Added versioned bilingual drafts with English and Simplified Chinese subjects/messages, facts used, missing facts, and human-review warnings.
- Kept English as the outbound source of truth and Simplified Chinese as the internal semantic-reference version.
- Retained active per-user prompt modules for business style while enforcing immutable anti-fabrication and structured-output system rules.
- Added human editing and explicit acceptance; acceptance creates a `ready` outreach task and locks the accepted conversation.
- Restored saved channel, quotation, visual, supplier, and logistics options when resuming a conversation.
- Fixed the outreach-task pagination order expressions that could return HTTP 500 after a bilingual draft was accepted.
- Added migration `1784723000000-AddAiOutreachConversations`.
- The operation manual and screenshots remain unchanged until the user confirms that feature optimization is complete.

Verification:

- Backend unit tests: 20 suites, 111 tests passed.
- PostgreSQL E2E: 15 tests passed, including conversation ownership, multi-turn sequencing, bilingual editing, acceptance, queue creation, and post-acceptance locking.
- Frontend tests: 10 files, 24 tests passed, including resumed Email configuration and bilingual presentation.
- Backend lint and production build passed.
- Frontend lint and production build passed.
- Migration `1784723000000` was applied to the local PostgreSQL database; all 19 migrations are current.
- Local runtime health passed: API status `ok`, database `up`, and frontend HTTP 200 at port 5173.
- Root `npm.cmd run ci:local` passed, including packaged frontend assets and the production smoke at port 3199.
- The production dependency gate found no high or critical vulnerability. Two moderate `uuid` advisories remain through `exceljs`; the available forced fix is a breaking dependency downgrade and was not applied.
- Automated real-browser control was unavailable in the current session; visual behavior remains covered by component rendering tests pending the next manual acceptance pass.

## 36. 2026-07-23 Classified Contact Evidence

Completed:

- Replaced raw contact URL presentation with classified Email, Phone, WhatsApp, Facebook, Instagram, and LinkedIn evidence cards.
- Added direct “Open Contact” and “View Evidence” actions; both follow the secure external new-tab policy.
- Added an owner-scoped “Analyze Contacts” action for existing leads.
- Extended storefront analysis from the homepage to up to four prioritized same-origin Contact, Support, About, and policy pages.
- Added extraction from mailto/tel/WhatsApp/social profile links, labelled telephone text, and JSON-LD email, telephone, and `sameAs` data.
- Persisted source page URL, page title, page type, extraction method, verification status, confidence, and the contact type proved by the evidence.
- Normalized contact URLs and removed query fragments so duplicate social accounts collapse to one displayed contact.
- Rejected private-network targets, Facebook share/dialog links, Instagram posts/reels/stories, and non-profile LinkedIn URLs.
- Removed storefront and product-detail URLs from the contact evidence pipeline and contact scoring.
- Existing legacy `website` contact rows remain in storage for history but are excluded from the lead-detail contact contract.
- The operation manual and screenshots remain unchanged until feature optimization is confirmed complete.

Verification:

- Backend unit tests: 20 suites, 112 tests passed.
- PostgreSQL E2E: 16 tests passed, including owner isolation and structured contact-evidence persistence.
- Frontend tests: 11 files, 26 tests passed, including readable account labels and direct contact actions.
- Backend and frontend lint and production builds passed.

## 37. 2026-07-23 Priority Contact Scoring And Ad Evidence

Completed:

- Added a shared contact-scoring domain function used by workflow scoring and manual contact reanalysis.
- Raised phone, WhatsApp, and store-owner Facebook profile evidence above email and general social pages.
- Distinguished a Google owner/founder profile candidate from a storefront Facebook business page.
- Enforced a hard contact-score ceiling of 50 when email is the only usable contact channel.
- Increased the total lead-score contact contribution from 10% to 25% and recorded priority channel coverage in score reasons.
- Replaced stale maximum-score retention with the current `rules-v3-priority-contact-ads` snapshot values.
- Recalculated lead and latest score-snapshot values after owner-scoped manual contact analysis.
- Added labelled WhatsApp-number extraction from public storefront text and prioritized strong contacts in API/UI ordering.
- Normalized PipiAds provider, platform, ad ID, direct-ad-link status, and explicit `pipiads_api` or `pipiads_mock` source.
- Generated an official Facebook Ads Library URL from a PipiAds Facebook ad ID when no direct provider URL is returned.
- Returned attributable ad evidence on lead detail and added secure new-tab actions with a visible `PipiAds API` badge.
- Fixed TypeORM relation synchronization during contact rescoring by using owner-scoped field updates.
- The operation manual and screenshots remain unchanged until feature optimization is confirmed complete.

Verification:

- Backend unit tests: 21 suites, 116 tests passed.
- Frontend tests: 11 files, 26 tests passed.
- PostgreSQL E2E: 16 tests passed, including the email-only score cap and contact-analysis ownership.
- Backend and frontend lint passed.
- Backend and frontend production builds passed.

## 38. 2026-07-23 Alibaba 1688 Sourcing Foundation

Completed:

- Replaced the earlier generic API proposal with the confirmed cross-border family:
  - `com.alibaba.fenxiao.crossborder:product.search.keywordQuery-1`.
  - `com.alibaba.fenxiao.crossborder:product.search.imageQuery-1`.
  - `com.alibaba.fenxiao.crossborder:product.search.queryProductDetail-1`.
- Added the canonical design `docs/AUTOFLOW_1688_SOURCING_INTEGRATION_SPEC.md`.
- Added the Git-ignored local configuration file `backend/.env.alibaba1688.local`.
- Added the tracked configuration template `backend/.env.alibaba1688.local.example`.
- Added 1688 configuration to the backend environment-file loading order.
- Added fail-fast validation for AppKey, AppSecret, access token, and HTTPS gateway when the provider is enabled.
- Implemented the Param2 HMAC-SHA1 signer in TypeScript and verified its output against the downloaded Ocean Java SDK.
- Implemented real Axios form calls, stable response normalization, timeout handling, provider error normalization, and secret-redacted logging.
- Added owner-scoped `sourcing_searches`, `sourcing_suppliers`, and `sourcing_offers` entities plus migration `1784724000000`.
- Applied migration `1784724000000` to the local PostgreSQL database; all 20 migrations are current.
- Added workflow-sidecar keyword/image sourcing and bounded product-detail hydration for the first five offers.
- Added supplier and offer deduplication, persisted failures, completed-result reuse, and manual force refresh.
- Added an independent 100-point sourcing score for relevance, price, MOQ, supplier reliability, delivery readiness, and customization.
- Added owner-scoped APIs:
  - `GET /api/autoflow/workflows/:workflowRunId/sourcing`.
  - `POST /api/autoflow/workflows/:workflowRunId/sourcing/search`.
- Added the bilingual `1688货源` result page and workflow-list entry, including secure new-tab product and supplier links.
- Defined `1688货源` as procurement evidence with an independent sourcing score.
- Excluded 1688 sourcing from customer contacts, `contactScore`, and customer `totalScore`.

Verification:

- Backend unit tests: 28 suites, 154 tests passed.
- PostgreSQL E2E: 17 tests passed, including owner isolation and the explicit unconfigured/no-fabricated-offer contract.
- Frontend tests: 12 files, 30 tests passed.
- Backend and frontend lint and production builds passed.
- Local runtime health passed: API status `ok`, database `up`, frontend HTTP 200, and the sourcing route is registered.

Remaining Live Enablement:

- The local AppKey and AppSecret are configured.
- `ALIBABA_1688_ENABLED` remains `false` because no access token or refresh token is configured.
- Obtain an authorized 1688 buyer access token and confirm all three cross-border API permissions.
- Compare the first signed request with the Alibaba online API tool.
- Capture redacted keyword, image, and detail responses for final live-response contract validation.

## 39. 2026-07-24 FOP Quote Channel And Margin Foundation

Completed:

- Extended immutable quotation request snapshots with FOP purchase cost, product gross margin, selected custom/actual logistics-channel identities, and per-channel logistics gross margin.
- Added authenticated server-side FOP contracts:
  - `POST /api/autoflow/integrations/fop/products/purchase-costs`.
  - `GET /api/autoflow/integrations/fop/logistics/custom-channels`.
  - `GET /api/autoflow/integrations/fop/logistics/custom-channels/:customChannelCode/actual-channels`.
  - `POST /api/autoflow/quotes/:quoteId/request-fop`.
- Added `FopLogisticsCatalogPort` with explicit sandbox and unavailable adapters; production remains fail-closed until a live Kingdee adapter is supplied.
- Added two-level logistics selection in the quote workspace: choose a custom logistics channel, then multi-select actual channels.
- Added per-tier read-only FOP purchase-cost display, user-defined product gross margin, and per-selected-channel logistics gross margin.
- Added the transparent formulas:
  - customer product price = FOP purchase cost / (1 - product gross margin).
  - customer freight = FOP freight cost / (1 - logistics gross margin).
- Expanded the combined matrix to quantity tier x destination country x selected actual channel, preserving both FOP cost and customer-facing amounts.
- Kept all FOP credentials and operation IDs server-side and left `FOP_LOGISTICS_CHANNEL_OPERATION` as a live-integration configuration placeholder.
- The operation manual and screenshots remain unchanged until feature optimization is confirmed complete.

Verification:

- Backend unit tests: 30 suites, 158 tests passed.
- Frontend tests: 13 files, 35 tests passed.
- PostgreSQL E2E: 17 tests passed, including owner isolation and fail-closed FOP quote persistence.
- Backend and frontend lint and production builds passed.
- Local runtime health passed: API status `ok`, database `up`, frontend HTTP 200, and Docker PostgreSQL `hyperzone` running.

Remaining Live Enablement:

- Confirm the Kingdee Cloud Cosmic operation and field mapping for custom logistics channels and actual logistics channels.
- Confirm product-master purchase-cost currency, unit, effective-time, and quantity-tier semantics.
- Confirm whether FOP logistics channel availability is destination-specific before filtering on the AutoFlow page.
- Reconcile product and freight margin examples against approved FOP staging fixtures.

## 40. 2026-07-24 Workflow-Grouped Lead Pool

Completed:

- Preserved the global owner/domain lead deduplication boundary while exposing every workflow discovery occurrence.
- Added workflow name, workflow creation time, lead discovery time, and workflow-specific score to the lead API response.
- Grouped the lead-pool UI by source workflow.
- Sorted workflow groups by workflow creation time descending.
- Sorted leads inside each workflow by workflow-specific score descending, with discovery time descending as the tie-breaker.
- Added a historical unassigned fallback for legacy lead snapshots without workflow discovery links.
- Added the PostgreSQL index `idx_workflow_leads_run_score_discovered`.
- Kept the operation manual unchanged until the user confirms all feature optimization is complete.

Verification:

- Backend unit tests: 30 suites, 159 tests passed.
- Frontend tests: 14 files, 37 tests passed.
- PostgreSQL E2E: 17 tests passed, including one deduplicated prospect attributed to two workflows.
- Backend/frontend lint and production builds passed.
- Local runtime: API `ok`, database `up`, 22 leads returned with workflow discovery metadata, frontend `/leads` HTTP 200.

## 41. 2026-07-24 AI Prompt Menu, Outreach Context, And Dashboard Drill-Down

Completed:

- Moved AI prompt-template management out of personal settings into the top-level `/prompt-templates` route and sidebar.
- Preserved independent prompt-template and active-binding persistence; added the system fallback module for other outreach channels.
- Changed the default outreach channel to Facebook and ordered channels as Facebook, WhatsApp, email, Instagram, and other.
- Added a required manual target for the other outreach channel.
- Extended outreach task responses with the linked customer profile and current contact channels.
- Added customer profile, store, market, category, score, status, and contact-channel context to the outreach workspace.
- Added status and channel filters to the outreach workspace.
- Made all six dashboard metrics and all follow-up stage metrics navigate to their corresponding lists.
- Applied query-string status filters in lead and outreach lists.
- Applied migration `1784726000000-AddOutreachOtherChannel`.
- Kept the operation manual and screenshots unchanged pending final feature confirmation.

Verification:

- Backend unit tests: 30 suites, 160 tests passed.
- Frontend tests: 14 files, 39 tests passed.
- PostgreSQL E2E: 17 tests passed.
- Backend and frontend lint and production builds passed.

## 42. 2026-07-24 Default Product Gross Margin

- Changed the default product gross margin for a new quotation from 30% to 20%.
- Kept the frontend quotation request snapshot and the FOP sandbox fallback aligned at 20%.
- The value remains editable per quotation.

## 43. 2026-07-24 Template-Style Quotation Excel Export

Completed:

- Analyzed `E:\VSCode\AutoFlow\报价模版.xlsx`, including its single-sheet layout, merged header/notes areas, HyperZone branding, product/logistics matrix, internal cost fields, customer-price fields, styles, and print setup.
- Added a server-side ExcelJS quotation exporter generated from one immutable quotation version.
- Added `GET /api/autoflow/quotes/:quoteId/versions/:version/export.xlsx` with authenticated owner scope.
- Added an `Export Excel` action to the combined quotation matrix after a version is saved.
- Preserved product/SKU, quantity tier, unit, destination, two-level logistics channel, carrier, purchase cost, FOP freight, product/logistics gross margin, customer product amount, customer freight, total amount, currency, quotation ID, quotation version, and FOP source version.
- Kept missing FOP values blank instead of substituting estimates.
- Recreated the reference template's branded heading, quotation notes, cyan table header, highlighted internal cost columns, highlighted total-price column, frozen header, filters, landscape print settings, and one-page-width scaling.
- Added the current HyperZone logo as a packaged backend export asset.
- Kept the operation manual and screenshots unchanged pending final feature confirmation.

Verification:

- Backend quotation unit tests: 3 suites, 5 tests passed.
- Full backend unit tests: 31 suites, 162 tests passed.
- Quote export E2E: owner download passed, non-owner access returned 404, and the response contained a valid XLSX `PK` header.
- Frontend tests: 14 files, 39 tests passed.
- Backend and frontend lint passed.
- Backend and frontend production builds passed.
- Generated and rendered a 12-row matrix sample and a final A3 logo/layout check in Excel; matrix layout, amount formats, print scaling, packaged logo, and page footer were visually checked.
- Local runtime health passed: API status `ok`, database `up`, frontend `/quotes` HTTP 200, and the unauthenticated export route returned 401.

## 44. 2026-07-24 Owner-Scoped Workflow IDs And Creation Dates

Completed:

- Added a short numeric workflow display ID with the sequence `01` through `99`, then `100` through `999999`.
- Scoped the sequence independently to each user through `users.next_workflow_number`.
- Allocated IDs under a pessimistic user-row lock in the workflow creation transaction.
- Added database uniqueness and numeric-range constraints; deleted IDs are not reused and an exhausted sequence fails explicitly.
- Backfilled existing workflows per owner in deterministic `created_at, id` order.
- Added workflow ID and `YYYY-MM-DD` creation date to the workflow list.
- Added workflow ID and creation date to recent dashboard activity.
- Applied migration `1784727000000-AddOwnerScopedWorkflowDisplayIds` to the local PostgreSQL database.
- Kept the operation manual and screenshots unchanged pending final feature confirmation.

Verification:

- Local historical workflows were backfilled as `01`, `02`, `03`, and `04`; the owner's next counter is `05`.
- Other local users retain independent next counters beginning at `01`.
- Backend unit tests: 31 suites, 163 tests passed.
- PostgreSQL E2E: 18 tests passed, including concurrent allocation and cross-owner isolation.
- Frontend tests: 15 files, 41 tests passed.
- Backend and frontend lint and production builds passed.
- Runtime health passed: API status `ok`, database `up`, and frontend `/workflows` HTTP 200.

## 45. 2026-07-24 Lead-Pool Workflow Attribution

Completed:

- Extended each lead workflow-discovery occurrence with `workflowDisplayId`.
- Preserved the internal workflow UUID for filtering and relations while exposing the owner-scoped short ID for business identification.
- Displayed the source workflow name and short ID together in every lead-pool group heading.
- Preserved the historical unassigned group without presenting a fabricated workflow ID.
- Added frontend grouping assertions and PostgreSQL E2E assertions for workflow name and short-ID attribution.
- Kept the operation manual and screenshots unchanged pending final feature confirmation.

Verification:

- Backend unit tests: 31 suites, 163 tests passed.
- PostgreSQL E2E: 18 tests passed, including multi-workflow lead attribution.
- Frontend tests: 15 files, 41 tests passed.
- Backend and frontend lint and production builds passed.

## 46. 2026-07-31 New-Environment Deployment Package

Completed:

- Added the Simplified Chinese installation, build, PostgreSQL migration, backup, restore, startup, rollback, and acceptance guide.
- Added PostgreSQL 16 Docker Compose and production environment templates without real credentials.
- Added source installation, production runtime installation, compiled migration, database backup, guarded restore, startup, runtime verification, and deployment packaging scripts.
- Added optional PostgreSQL TLS configuration through `DB_SSL` and `DB_SSL_REJECT_UNAUTHORIZED`.
- Generated `AutoFlow-Deployment-20260731.zip` with compiled backend, packaged frontend, 23 compiled migrations, runtime manifests, deployment templates, scripts, and guide.
- Excluded real `.env`, provider credentials, local uploads, `node_modules`, and database data from the package.

Verification:

- Backend and frontend production build passed.
- Backend unit tests: 31 suites, 163 tests passed.
- Backend and frontend lint passed.
- PowerShell and Node deployment-script syntax checks passed.
- Deployment ZIP required-entry validation passed with 656 archive entries and 23 compiled migrations.
- Clean extracted package installed 520 production dependency packages successfully.
- Extracted compiled migration runner connected to PostgreSQL: 23 registered, 23 applied, no pending migration.
- Extracted production runtime served the frontend and returned API `ok`, database `up`, CSP, and security headers.
- Docker backup script produced a valid custom-format PostgreSQL archive with 274 catalog entries.

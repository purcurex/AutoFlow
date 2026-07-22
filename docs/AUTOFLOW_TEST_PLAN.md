# AutoFlow Test Plan

## 1. Testing Goals

- Verify the AutoFlow sales workflow behaves correctly.
- Prevent legacy NoteFlow cleanup from breaking authentication, routing, and record features.
- Ensure workflow, lead, outreach, quote, and FOP handoff transitions are controlled.
- Verify that AutoFlow does not duplicate FOP CRM, product-cost, or logistics-rating rules.
- Keep FOP integrations testable through ports, contract fixtures, and explicitly labelled test adapters.

## 2. Test Layers

| Layer | Tooling | Purpose |
|---|---|---|
| Frontend unit / component | Vitest, Vue Test Utils, jsdom | Components, stores, route shell |
| Backend unit | Jest or Nest testing utilities | Services, scoring, quote orchestration, tier validation |
| Backend API | Supertest or Nest e2e | Auth-protected endpoints and DTO validation |
| Integration contract | Mocked providers and approved fixtures | Shopify/Facebook/AI/FOP port behavior and mapping |
| Manual smoke | Browser + local dev server | Login, workflow, contact review, quote entry, failure states |

## 3. Current Test Baseline

Already added:

- `frontend/src/tests/App.test.ts`
- `frontend/src/tests/legacy-records.test.ts`
- `backend/src/modules/autoflow/autoflow.service.spec.ts`
- `backend/src/modules/autoflow/dto/autoflow.dto.spec.ts`
- `backend/src/modules/autoflow/entities/autoflow.entities.spec.ts`
- `backend/src/database/tests/autoflow.migrations.spec.ts`
- `backend/src/modules/seeder/seeder.service.spec.ts`
- `backend/src/modules/ai/ai.service.spec.ts`
- `backend/src/modules/fop-integration/fop-integration.service.spec.ts`
- `frontend/src/tests/security-routing.test.ts`
- Root `npm.cmd run ci:local` verification command.

Required next:

- Production startup smoke test.
- Route guard and rich-text sanitization tests.
- Product-tier, multi-country freight, combined quote, and FOP failure contract tests.

Implemented P1 integration baseline:

- Supertest API harness against isolated PostgreSQL database `autoflow_test`.
- Workflow persistence and cross-owner isolation.
- Profile escalation rejection.
- Lead status transition rejection and owner-scoped not-found behavior.
- Outreach-to-lead-to-compatibility-activity transaction flow.
- Database-backed `/api/health` readiness check.

Implemented P2 integration baseline:

- Development mock and production fail-closed provider tests.
- Owner-scoped asynchronous discovery start API.
- PostgreSQL verification for workflow steps, ad creatives, Shopify stores, leads, workflow links, and score snapshots.
- Completed workflow restart rejection and cross-owner start rejection.

Implemented release/spec alignment baseline:

- Stored rich-text sanitization and admin-route fallback tests.
- Legacy `/crm` to `/follow-ups` compatibility test.
- AI unavailable and human-review draft creation tests.
- Authenticated FOP capability discovery that returns no fake quote values.
- Production startup, PostgreSQL health, packaged SPA, CSP, and security-header smoke test.

## 4. Test Case Matrix

| ID | Area | Case | Priority | Automation |
|---|---|---|---|---|
| TC-001 | Brand | Login page shows AutoFlow positioning | P0 | Frontend component |
| TC-002 | Brand | Register page shows AutoFlow positioning | P0 | Frontend component |
| TC-003 | Routing | Unauthenticated user redirects to login | P0 | Frontend unit |
| TC-004 | Auth | Admin role can access admin page | P1 | Frontend/API |
| TC-005 | Workflow | Create workflow with keyword | P0 | API + frontend store |
| TC-006 | Workflow | Reject empty seed value | P0 | API |
| TC-007 | Workflow | Created workflow persists after reload | P0 | API |
| TC-008 | Discovery | Shopify adapter maps stores to leads | P1 | Backend unit |
| TC-009 | Discovery | Facebook adapter maps ads to ad creatives | P1 | Backend unit |
| TC-010 | Discovery | Development fallback returns mock results | P1 | Backend unit |
| TC-011 | Discovery | Production missing provider key fails | P1 | Backend unit |
| TC-012 | Lead | Lead list filters by status | P0 | API |
| TC-013 | Lead | Lead detail returns contacts and score | P0 | API |
| TC-014 | Lead | Invalid lead status transition rejected | P0 | Backend unit/API |
| TC-015 | Scoring | Complete lead receives higher contact score | P1 | Backend unit |
| TC-016 | Scoring | Risk signal lowers recommendation | P1 | Backend unit |
| TC-017 | Outreach | Generate WhatsApp message creates a draft that requires human review | P0 | API |
| TC-018 | Outreach | Mark sent updates task and lead status | P0 | API |
| TC-019 | Outreach | Mark replied creates lightweight local follow-up activity | P1 | API |
| TC-020 | Outreach | Missing AI config produces clear error | P1 | Backend unit |
| TC-021 | Quote | Product tiers are ordered, non-overlapping, unit-aware, and currency-aware | P0 | Backend unit/API |
| TC-022 | FOP Product Cost | Request forwards tier and SKU mapping context and persists a source/version snapshot | P0 | Contract + API |
| TC-023 | FOP Freight | Multi-country request returns channels grouped by country with explicit units and currency | P0 | Contract + API |
| TC-024 | Combined Quote | Matrix references exact product-tier and shipping-option snapshots | P0 | Backend unit + frontend component |
| TC-025 | FOP Failure | Unavailable provider preserves draft and never fabricates cost or freight | P0 | Contract + API |
| TC-026 | FOP Handoff | Duplicate idempotency key does not create duplicate lead/opportunity handoff | P0 | Contract + API |
| TC-027 | Follow-Up | Local next action persists without claiming FOP CRM authority | P1 | API |
| TC-028 | Build | Frontend build passes | P0 | CI script |
| TC-029 | Build | Backend build passes | P0 | CI script |
| TC-030 | Regression | Legacy record route stays out of primary navigation and export uses business-record terminology | P0 | Frontend component |
| TC-031 | Contract | AutoFlow write DTOs accept supported fields and reject invalid enum/date values | P0 | Backend unit |
| TC-032 | Persistence | P1-A entities map to the expected tables, ownership columns, links, and indexes | P1 | Backend metadata unit |
| TC-033 | Migration | Core migration creates all P1-A tables and reverts without dropping legacy tables | P1 | Backend migration unit |
| TC-034 | Discovery | Start endpoint returns 202 and persists provider evidence | P0 | PostgreSQL E2E |
| TC-035 | Discovery | Candidate stores create deduplicated leads and workflow links | P0 | PostgreSQL E2E |
| TC-036 | Workflow | Discovery steps complete and deferred stages are explicitly skipped | P0 | PostgreSQL E2E |
| TC-037 | Scoring | Workflow creates one structured score snapshot per lead | P1 | PostgreSQL E2E |
| TC-038 | Quote UI | Lead detail opens quote workspace with tier and destination controls | P0 | Frontend component |
| TC-039 | Quote Validation | Unsupported country, missing unit, invalid tier, and missing SKU mapping are explicit errors | P0 | Backend unit/API |
| TC-040 | FOP Contract | Product-cost and freight fixtures reconcile with approved FOP sandbox output | P0 before live enablement | Contract integration |
| TC-041 | FOP Authority | Duplicate/ownership/stage conflict is displayed and does not overwrite FOP data | P1 | Contract + API |
| TC-042 | Production | Build output starts successfully and health endpoint reaches PostgreSQL | P0 | CI smoke |
| TC-043 | Audit | Workflow, quote-provider call, and FOP handoff actions write redacted audit events | P1 | Backend unit/API |

## 5. BDD To Test Mapping

| BDD Feature | Test IDs |
|---|---|
| Brand Positioning | TC-001, TC-002 |
| Workflow Creation | TC-005, TC-006, TC-007 |
| Discovery And Lead Generation | TC-008, TC-009, TC-010, TC-011, TC-034, TC-035, TC-036, TC-037 |
| Lead Scoring | TC-015, TC-016 |
| AI Outreach | TC-017, TC-020 |
| Outreach Queue | TC-018, TC-019 |
| FOP-Backed Quote Workspace | TC-021, TC-022, TC-023, TC-024, TC-025, TC-038, TC-039, TC-040 |
| Lightweight Follow-Up And FOP Handoff | TC-026, TC-027, TC-041 |

## 6. Local Verification Commands

```powershell
npm.cmd --workspace frontend run test
npm.cmd --workspace frontend run build
npm.cmd --workspace backend run test
npm.cmd --workspace backend run build
npm.cmd run ci:local
```

## 7. Definition Of Done For Each Feature

- Requirement is linked to a BDD scenario.
- API contract is documented or updated.
- FOP-related contracts remain aligned with `AUTOFLOW_FOP_INTEGRATION_SPEC.md`.
- DTO validation is implemented for backend write endpoints.
- Status transition rules are tested.
- Production adapters fail closed and never substitute mock cost or freight.
- Frontend state path is tested or manually verified.
- Build passes.
- Relevant docs and task checklist are updated.

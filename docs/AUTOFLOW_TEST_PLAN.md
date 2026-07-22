# AutoFlow Test Plan

## 1. Testing Goals

- Verify the AutoFlow sales workflow behaves correctly.
- Prevent legacy NoteFlow cleanup from breaking authentication, routing, and record features.
- Ensure workflow, lead, outreach, and quote status transitions are controlled.
- Keep future integrations testable through adapters and mocks.

## 2. Test Layers

| Layer | Tooling | Purpose |
|---|---|---|
| Frontend unit / component | Vitest, Vue Test Utils, jsdom | Components, stores, route shell |
| Backend unit | Jest or Nest testing utilities | Services, scoring, quote calculation |
| Backend API | Supertest or Nest e2e | Auth-protected endpoints and DTO validation |
| Integration adapter | Mocked providers | Shopify/Facebook/AI adapter behavior |
| Manual smoke | Browser + local dev server | Login, dashboard, workflow creation |

## 3. Current Test Baseline

Already added:

- `frontend/src/tests/App.test.ts`
- `frontend/src/tests/legacy-records.test.ts`
- `backend/src/modules/autoflow/autoflow.service.spec.ts`
- `backend/src/modules/autoflow/dto/autoflow.dto.spec.ts`
- `backend/src/modules/autoflow/entities/autoflow.entities.spec.ts`
- `backend/src/database/tests/autoflow.migrations.spec.ts`
- `backend/src/modules/seeder/seeder.service.spec.ts`
- Root `npm.cmd run ci:local` verification command.

Required next:

- Quote calculation tests.
- Route guard tests.

Implemented P1 integration baseline:

- Supertest API harness against isolated PostgreSQL database `autoflow_test`.
- Workflow persistence and cross-owner isolation.
- Profile escalation rejection.
- Lead status transition rejection and owner-scoped not-found behavior.
- Outreach-to-lead-to-CRM transaction flow.
- Database-backed `/api/health` readiness check.

Implemented P2 integration baseline:

- Development mock and production fail-closed provider tests.
- Owner-scoped asynchronous discovery start API.
- PostgreSQL verification for workflow steps, ad creatives, Shopify stores, leads, workflow links, and score snapshots.
- Completed workflow restart rejection and cross-owner start rejection.

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
| TC-017 | Outreach | Generate WhatsApp message creates ready task | P0 | API |
| TC-018 | Outreach | Mark sent updates task and lead status | P0 | API |
| TC-019 | Outreach | Mark replied creates CRM activity | P1 | API |
| TC-020 | Outreach | Missing AI config produces clear error | P1 | Backend unit |
| TC-021 | Quote | Quote margin calculated correctly | P0 | Backend unit |
| TC-022 | Quote | Margin below 15% shows warning | P0 | Backend unit |
| TC-023 | Quote | Margin below 10% requires approval | P0 | Backend unit |
| TC-024 | Quote | Quote expiration date is calculated | P1 | Backend unit |
| TC-025 | CRM | Add follow-up record to lead timeline | P0 | API |
| TC-026 | CRM | Next follow-up time can be updated | P1 | API |
| TC-027 | Audit | Workflow create writes audit event | P1 | Backend unit/API |
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

## 5. BDD To Test Mapping

| BDD Feature | Test IDs |
|---|---|
| Brand Positioning | TC-001, TC-002 |
| Workflow Creation | TC-005, TC-006, TC-007 |
| Discovery And Lead Generation | TC-008, TC-009, TC-010, TC-011, TC-034, TC-035, TC-036, TC-037 |
| Lead Scoring | TC-015, TC-016 |
| AI Outreach | TC-017, TC-020 |
| Outreach Queue | TC-018, TC-019 |
| Quote Foundation | TC-021, TC-022, TC-023, TC-024 |
| CRM Follow-Up | TC-025, TC-026, TC-027 |

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
- DTO validation is implemented for backend write endpoints.
- Status transition rules are tested.
- Frontend state path is tested or manually verified.
- Build passes.
- Relevant docs and task checklist are updated.

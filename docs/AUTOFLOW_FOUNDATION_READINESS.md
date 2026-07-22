# AutoFlow Foundation Readiness

## 1. Purpose

This document defines the ground preparation required before formal AutoFlow transformation development starts.

## 2. Foundation Status

| Area | Status | Notes |
|---|---|---|
| Workspace | Ready | Main project path: `E:\VSCode\AutoFlow\note-app` |
| Database | Ready | Docker instance `hyperzone` exposes PostgreSQL on `localhost:5432` |
| Frontend Dev Server | Ready | Verified at `http://127.0.0.1:5173` |
| Frontend Test Baseline | Ready | Vitest + Vue Test Utils + jsdom installed |
| Backend Test Baseline | Ready | Jest + ts-jest installed with AutoFlow service smoke tests |
| Frontend Build | Ready | Build passes with chunk size warning |
| Backend Build | Ready | Nest build passes |
| Root CI Script | Ready | `npm.cmd run ci:local` runs lint, unit/E2E tests, builds, and production dependency audit |
| Legacy Build Artifacts | Ready | Tracked `backend/public` frontend bundle removed and ignored |
| Local Docker Database | Ready | Docker container `hyperzone` is running, `localhost:5432` is reachable, and database `noteflow` accepts the app credentials |
| AutoFlow Product Spec | Ready | See `AUTOFLOW_PRODUCT_SPEC.md` |
| BDD Scenarios | Ready | See `AUTOFLOW_BDD_SCENARIOS.md` |
| PDD Design | Ready | See `AUTOFLOW_PDD_DESIGN.md` |
| Test Plan | Ready | See `AUTOFLOW_TEST_PLAN.md` |
| Development Backlog | Ready | See `AUTOFLOW_DEVELOPMENT_BACKLOG.md` |
| Legacy Note Repositioning | Ready | UI uses business records and record categories while legacy routes and tables remain compatible |
| AutoFlow API Contracts | Ready | Frontend types are centralized and backend write endpoints use validated DTO classes |
| P1 Persistence | Ready | Repository-backed owner-scoped services and four versioned migrations are applied to `hyperzone/noteflow` |
| Security Gate | Ready | Profile allowlist, explicit admin bootstrap, production email fail-closed, endpoint guards, and throttling are active |
| API Integration Tests | Ready | Supertest runs against isolated PostgreSQL database `autoflow_test` |
| GitHub CI | Ready | Workflow provisions PostgreSQL and runs the complete local CI gate |

## 3. Required Before Coding Each Iteration

- Confirm target phase: P0, P1, P2, P3, P4, or P5.
- Read the matching section in `AUTOFLOW_DEVELOPMENT_BACKLOG.md`.
- Map the task to at least one BDD scenario.
- Define expected tests before implementation.
- Check `git status --short`.
- Avoid reverting unrelated user changes.

## 4. Local Commands

```powershell
npm.cmd run ci:local
npm.cmd --workspace frontend run test
npm.cmd --workspace frontend run build
npm.cmd --workspace backend run test
npm.cmd run test:e2e
npm.cmd --workspace backend run build
docker exec hyperzone psql -U postgres -d noteflow -c "select current_database() as database, current_user as user_name;"
```

Start frontend:

```powershell
npm.cmd --workspace frontend run dev -- --host 127.0.0.1
```

Check Docker database:

```powershell
docker ps -a --filter name=hyperzone --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"
```

## 5. Definition Of Ready

A development task is ready when:

- Business goal is documented.
- User role is clear.
- API or UI behavior is described.
- Acceptance criteria exist.
- Test case exists or is listed as manual verification.
- Data model impact is known.
- Legacy NoteFlow impact is known.

## 6. Definition Of Done

A development task is done when:

- Code is implemented.
- Related BDD scenario is satisfied.
- Relevant automated tests pass or manual verification is documented.
- Frontend and backend build impact is checked.
- Documentation and backlog status are updated.
- No generated build artifacts or archives are committed.

## 7. Next Formal Development Recommendation

P0, P0.5, and the P1/P2 development baselines are complete. The production-startup and stored-rich-text security blockers identified by the 2026-07-22 audit were closed in the release-alignment pass. Continue with the remaining P2-D hardening and P3 AI Outreach work:

1. Add channel-specific WhatsApp and email templates on top of the new sales-outreach AI method.
2. Add contact enrichment and evidence-driven scoring before wider outreach use.
3. Add next-action suggestions and WhatsApp deep-link sending after human review.
4. Replace the process-local workflow guard with durable queue/lease execution before paid-provider or multi-instance use.

Before horizontal scaling, replace the P2 in-process scheduler with a persistent queue worker. The current single-instance runner stores every step and error in PostgreSQL and can resume through the same start endpoint after a restart.

Approved downstream scope:

- P4 builds a quotation interaction and orchestration layer, not a local product-cost or logistics-rating engine.
- Product quotation supports quantity tiers.
- Freight quotation supports multiple destination countries and multiple FOP logistics channels.
- Combined quotation supports product/SKU x quantity tier x destination country x shipping channel.
- FOP, built on Kingdee Cloud Cosmic, remains authoritative for product cost, freight rating, formal leads, opportunities, stages, and follow-up records.
- P5 is limited to lightweight AutoFlow next actions and explicit FOP handoff.
- Live FOP enablement requires the inventory and acceptance gates in `AUTOFLOW_FOP_INTEGRATION_SPEC.md`.

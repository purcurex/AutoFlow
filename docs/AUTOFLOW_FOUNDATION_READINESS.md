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
| Root CI Script | Ready | `npm.cmd run ci:local` runs tests and builds |
| Legacy Build Artifacts | Ready | Tracked `backend/public` frontend bundle removed and ignored |
| Local Docker Database | Ready | Docker container `hyperzone` is running, `localhost:5432` is reachable, and database `noteflow` accepts the app credentials |
| AutoFlow Product Spec | Ready | See `AUTOFLOW_PRODUCT_SPEC.md` |
| BDD Scenarios | Ready | See `AUTOFLOW_BDD_SCENARIOS.md` |
| PDD Design | Ready | See `AUTOFLOW_PDD_DESIGN.md` |
| Test Plan | Ready | See `AUTOFLOW_TEST_PLAN.md` |
| Development Backlog | Ready | See `AUTOFLOW_DEVELOPMENT_BACKLOG.md` |

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

## 7. First Formal Development Recommendation

Start with P0-A and P0-B:

1. Replace product-facing NoteFlow language with AutoFlow.
2. Reposition legacy notes as business records.
3. Keep the existing routes stable while changing visible product meaning.
4. Run frontend test/build and backend build.

This gives the team a clean product foundation before deeper persistence and workflow refactoring.

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

- [ ] Create discovery service facade.
- [ ] Wrap Shopify Search as store discovery adapter.
- [ ] Wrap Facebook Ads Search as ad discovery adapter.
- [ ] Normalize adapter results into lead candidates.
- [ ] Save ad creative records.
- [ ] Save Shopify store detection records.

### P2-B Workflow Execution

- [ ] Add `POST /api/autoflow/workflows/:id/start-discovery`.
- [ ] Add workflow step updates.
- [ ] Add discovery progress state.
- [ ] Create leads from normalized discovery results.
- [ ] Mark workflow completed or failed.

### P2-C Tests

- [ ] Test mock adapter behavior in development.
- [ ] Test production missing key behavior.
- [ ] Test discovery creates leads.
- [ ] Test workflow step progression.

## 4. P3 AI Outreach Tasks

- [ ] Rewrite AI system prompt for Dropshipping sales outreach.
- [ ] Add message templates for WhatsApp and Email.
- [ ] Add lead context builder.
- [ ] Generate outreach task from lead detail.
- [ ] Add human-review status flow.
- [ ] Add next follow-up suggestion.
- [ ] Test AI unavailable behavior.
- [ ] Test outreach task creation.

## 5. P4 Quote Workspace Tasks

- [ ] Create quote entities.
- [ ] Create quote calculation service.
- [ ] Add product cost fields.
- [ ] Add logistics cost fields.
- [ ] Add margin calculation.
- [ ] Add 15% margin warning.
- [ ] Add 10% approval-required flag.
- [ ] Add quote validity date.
- [ ] Add quote UI entry from lead detail.
- [ ] Add quote tests.

## 6. P5 CRM/FOP Handoff Tasks

- [ ] Add FOP customer number placeholder.
- [ ] Add registration status field.
- [ ] Add store connection status field.
- [ ] Add order intent status field.
- [ ] Add handoff activity type.
- [ ] Add manager dashboard metrics.
- [ ] Document future FOP API integration points.

## 7. Suggested Execution Order

1. P0-A Brand And Positioning.
2. P0-B Legacy Note Repositioning.
3. P0-C Development Workflow.
4. P0-D Contract Cleanup.
5. P1-A Entities.
6. P1-B Services.
7. P1-C Tests.
8. P2 Discovery Workflow.
9. P3 AI Outreach.
10. P4 Quote Workspace.
11. P5 CRM/FOP Handoff.

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

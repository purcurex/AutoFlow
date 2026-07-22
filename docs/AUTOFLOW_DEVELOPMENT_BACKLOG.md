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

- [ ] Replace user-facing `NoteFlow` with `AutoFlow`.
- [ ] Replace smart-note positioning with outbound sales workflow positioning.
- [ ] Update login page copy.
- [ ] Update register page copy.
- [ ] Update README product description.
- [ ] Update DEPLOY product naming where safe.
- [ ] Update email verification product copy.
- [ ] Update seed admin email/domain decision.
- [ ] Review all visible navigation labels.
- [ ] Keep migration notes where historical NoteFlow references are useful.

### P0-B Legacy Note Repositioning

- [ ] Decide final UI term: `Records`, `Materials`, or `Customer Notes`.
- [ ] Hide `/notes/:id` from primary navigation.
- [ ] Reword note export to business record export.
- [ ] Reword folders as record categories where visible.
- [ ] Keep backend `notes` module until record migration is implemented.
- [ ] Document whether old notes link to leads/workflows in P1 or P2.

### P0-C Development Workflow

- [x] Add frontend Vitest baseline.
- [ ] Add backend test command verification.
- [ ] Add a root-level `test` or `ci:local` script.
- [ ] Add a docs-based definition of done.
- [ ] Ensure generated `dist`, `deploy`, and archives remain ignored.
- [ ] Confirm Docker database `hyperzone` connection instructions.

### P0-D Contract Cleanup

- [ ] Choose one source for AutoFlow frontend API types.
- [ ] Remove or align duplicate AutoFlow interfaces in `frontend/src/types/index.ts`.
- [ ] Define backend DTOs for workflow creation and outreach updates.
- [ ] Ensure controller methods use DTO classes instead of plain interfaces for writes.

## 2. P1 Persistence Tasks

### P1-A Entities

- [ ] Create `WorkflowRunEntity`.
- [ ] Create `WorkflowStepEntity`.
- [ ] Create `LeadEntity`.
- [ ] Create `LeadContactEntity`.
- [ ] Create `OutreachTaskEntity`.
- [ ] Create `CrmActivityEntity`.
- [ ] Add ownership fields: `ownerUserId`, optional `teamId`.
- [ ] Add indexes for owner, workflow, lead status, and timestamps.

### P1-B Services

- [ ] Replace in-memory workflow list with TypeORM repository.
- [ ] Replace in-memory lead list with TypeORM repository.
- [ ] Replace in-memory outreach queue with TypeORM repository.
- [ ] Implement lead status transition guard.
- [ ] Implement outreach status transition guard.
- [ ] Create CRM activity on important status changes.

### P1-C Tests

- [ ] Test workflow creation persistence.
- [ ] Test lead list filtering.
- [ ] Test lead detail not found.
- [ ] Test outreach task update.
- [ ] Test invalid status transition rejection.

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

## 8. Current Known Dirty Files

These files were changed while adding the frontend test baseline and spec foundation:

- `frontend/package.json`
- `frontend/vite.config.ts`
- `package-lock.json`
- `frontend/src/tests/App.test.ts`
- `docs/AUTOFLOW_PRODUCT_SPEC.md`
- `docs/AUTOFLOW_BDD_SCENARIOS.md`
- `docs/AUTOFLOW_PDD_DESIGN.md`
- `docs/AUTOFLOW_TEST_PLAN.md`
- `docs/AUTOFLOW_DEVELOPMENT_BACKLOG.md`


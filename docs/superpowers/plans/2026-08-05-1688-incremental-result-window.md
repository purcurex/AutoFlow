# 1688 Incremental Result Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent 100-item sourcing result window that users can expand by 100 without prefetching or reloading previously fetched pages.

**Architecture:** Keep provider totals as the immutable first-page snapshot, persist a separate per-search `resultLimit`, and derive client-visible totals from the smaller value. Add an idempotent target-limit extension endpoint; the Vue view expands the window and then requests only the next page through the existing cache-aware flow.

**Tech Stack:** NestJS, TypeORM/PostgreSQL, Jest, Vue 3, TypeScript, Vitest.

## Global Constraints

- Initial result limit is exactly 100 records.
- One extension opens at most the next 100 records and must be retry-idempotent.
- Do not prefetch 100 records and do not change the 1688 adapter contract.
- Preserve owner/workflow isolation, current page cache, supplier-name cache, and re-sourcing behavior.
- Preserve existing 10/20/50 page-size compatibility with 20 as default.

---

### Task 0: Repair image workflow input and sourcing

**Files:**
- Modify: `backend/src/modules/sourcing/sourcing-image-resolver.service.ts`
- Test: `backend/src/modules/sourcing/sourcing-image-resolver.service.spec.ts`
- Modify: `frontend/src/views/autoflow/WorkflowsView.vue`
- Test: `frontend/src/tests/workflow-revision-view.test.ts`

**Interfaces:**
- Consumes: PNG/JPG/WebP source bytes up to 8MB or a public HTTP/HTTPS URL.
- Produces: provider-ready JPEG/PNG bytes no larger than 5MB and a visible persisted/public URL preview.

- [x] Trace the live image workflow, sourcing search, and page records to separate PipiAds failure from successful 1688 imageId search.
- [x] Write and verify failing tests for 5-8MB inputs, public HTTP input, revision preview, and typed-URL preview.
- [x] Implement size normalization, SSRF-safe HTTP support, and unified preview derivation.
- [x] Run the resolver, executor, image-input, and revision-view tests.

### Task 1: Persist and derive the result window

**Files:**
- Create: `backend/src/database/migrations/1784731000000-AddSourcingResultLimit.ts`
- Modify: `backend/src/modules/sourcing/entities/sourcing-search.entity.ts`
- Modify: `backend/src/modules/sourcing/sourcing-response.types.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts`
- Test: `backend/src/modules/sourcing/entities/sourcing.entities.spec.ts`
- Test: `backend/src/modules/sourcing/sourcing.service.spec.ts`

**Interfaces:**
- Produces: persisted `resultLimit: number` and response fields `providerTotalRecords`, `resultLimit`, `canExpand`.
- Produces: client-visible `totalRecords/totalPages` capped by `resultLimit`.

- [ ] Write failing entity and service tests for a 536-record provider snapshot exposed as 100 records / 5 pages at pageSize 20.
- [ ] Run the focused backend tests and verify failures are caused by missing result-window behavior.
- [ ] Add the migration, entity field, response fields, and a small pagination-window derivation method.
- [ ] Run the focused tests and commit the passing result.

### Task 2: Add idempotent result-window extension

**Files:**
- Create: `backend/src/modules/sourcing/dto/extend-sourcing-window.dto.ts`
- Modify: `backend/src/modules/sourcing/sourcing.controller.ts`
- Modify: `backend/src/modules/sourcing/sourcing.service.ts`
- Test: `backend/src/modules/sourcing/sourcing.service.spec.ts`

**Interfaces:**
- Consumes: `targetLimit: number` equal to the current limit or exactly current limit plus 100.
- Produces: `SourcingWindowResponse` containing the current capped totals and expansion state.

- [ ] Write failing tests for one-step expansion, duplicate-target idempotency, invalid multi-step expansion, unknown totals, terminal totals, and page access beyond the current window.
- [ ] Run the focused service tests and verify the expected failures.
- [ ] Implement owner/workflow-scoped transactional extension with a pessimistic row lock and update request-page validation.
- [ ] Run focused backend tests and commit the passing result.

### Task 3: Add the continue-search interaction

**Files:**
- Modify: `frontend/src/api/autoflow.ts`
- Modify: `frontend/src/views/autoflow/SourcingView.vue`
- Modify: `frontend/src/i18n/index.ts`
- Test: `frontend/src/tests/sourcing-view.test.ts`

**Interfaces:**
- Consumes: backend pagination metadata and `extendWorkflowSourcingWindow(id, searchId, targetLimit)`.
- Produces: last-page button that extends once and then requests the next page.

- [ ] Write failing view tests for metadata, button visibility, loading state, automatic next-page navigation, and terminal hiding.
- [ ] Run the focused frontend test and verify failures are caused by the missing interaction.
- [ ] Add API types/method, localized text, metadata display, and guarded expansion flow reusing `changePage`.
- [ ] Run focused frontend tests and commit the passing result.

### Task 4: Verify and integrate

**Files:**
- Verify all changed files and migration state.

- [ ] Run related backend and frontend test suites.
- [ ] Run `npm.cmd run test`, `npm.cmd run lint`, and `npm.cmd run build`.
- [ ] Run the migration and verify it is listed as applied.
- [ ] Verify backend health and the local frontend URL.
- [ ] Review the diff for unrelated changes, merge to local `dev_01`, and re-run the relevant tests on the merged branch.

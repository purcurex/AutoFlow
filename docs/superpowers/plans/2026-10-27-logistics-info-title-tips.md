# Logistics information and title tips implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge dispatch carrier/tracking columns into typed logistics information and collapse descriptive title subtitles into a shared information tooltip throughout business pages.
**Architecture:** Optional canonical logisticsInfo groups retain each carrier and its typed tracking numbers. BFF allowlists the payload after authorization; frontend and Excel show the same groups. A shared InfoTip Vue component hides heading explanations until hover/focus/tap and supports Escape dismissal.
**Tech Stack:** Vue 3, TypeScript, NestJS, ExcelJS, Vitest/Jest; no new dependencies.
**Spec:** Latest user request in this conversation; exact column title 物流信息, type labels 全程/头程/尾程, carrier above tracking lines. Global heading descriptions become an i icon after the title.

## Global constraints
- Reuse the current checkout and preserve existing uncommitted work and running demo. No Git commit or production FOP edits in this request.
- Preserve pending-only dispatch eligibility, authorization, counts, sorting and page width. Warehouse list columns stay unchanged.
- logisticsInfo?: { carrierName: string|null; trackingNumbers: { type: 'full'|'first_mile'|'last_mile'; number: string }[] }[]|null.
- FOP full/last facts come from verified source fields; first-mile mapping needs IT confirmation. Never infer a type from a number prefix or mislabel provider-internal order IDs.
- Legacy untyped tracking remains visible without an invented type. New grouped data never cross-pairs carriers and numbers.
- Collapse business heading explanations, not field validation, error/empty-state messages, actionable alerts or record data. Preserve explanations in accessible tips.
- Regenerated HTML uses the shared HyperZone standard; update OpenAPI and handoff docs.

## Review focus
- Mixed carriers/multiple packages: preserve group association and all valid numbers.
- Missing/invalid typed fields and legacy responses: no fabricated stage or data loss.
- Tooltip near viewport edges and dark mode: readable, unclipped and keyboard dismissible.
- Shared header coverage: business pages/charts/panel headings; don't hide actionable warnings.
- Export and source mappings: same merged data, no permissions or pending-queue regression.

### Task 1: Typed logistics information
**Files:** backend fop-data types/service/new logistics-info helper/demo/export; corresponding frontend types/fixtures/FopOrdersView and tests.
**Interfaces:** normalizeLogisticsInfo(unknown) returns the canonical groups or null; frontend LogisticsInfo component accepts groups plus legacy carrier/tracking.
- [x] Add meaningful HTTP normalization/allowlist, Excel grouping and UI merged-column regressions; observe RED.
- [x] Implement canonical types, normalization, Demo coverage of all three types/multiple groups, merged dispatch column and Excel. Leave shipping unchanged.
- [x] Run relevant frontend, backend and FOP HTTP tests; expected PASS.

### Task 2: Global title tips
**Files:** new frontend/src/components/ui/InfoTip.vue, shared PageHeader, business page/chart/panel headings; FopOrdersView includes both queue description and FOP read-only note.
**Interfaces:** InfoTip default slot contains explanatory text; optional label gives accessible trigger name. No tooltip rendered visibly until activation.
- [x] Add hover/focus/Escape/outside-click/component cleanup tests; observe RED.
- [x] Implement the common tip, migrate heading descriptions, and retain actionable content in place.
- [x] Run frontend tests and browser checks for dispatch + common business pages; expected PASS.

### Task 3: Contract, documentation and final verification
- [x] Update OpenAPI schema/examples, requirements 9.27, source evidence, IT follow-ups and agent.md.
- [x] Run full frontend/backend tests (backend serial due known shared temporary-directory race), HTTP tests, lint/build and docs generation; expected PASS.
- [x] Fresh final review of this task's delta; resolve material findings, document limits. Save UI screenshots. No commit requested.

## Progress
- Plan created after source/UI inspection. Existing helper identifies full and last-mile numbers; no first-mile source is established.

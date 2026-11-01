# Completed Workbench Lists Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. Preserve existing uncommitted amount and stock-summary work.

**Goal:** Add a completed list to all five workbenches, with phase-specific completion dates and a default rolling week.

**Architecture:** Reuse FopOrdersView and existing queue read permissions with a validated completed=true filter. Route queue=completed maps each workbench to its existing phase queue. Procurement purchase-group mode shares the same completion filter, dates and exports. No database permission migration or FOP writes.

**Tech Stack:** Vue 3, TypeScript, NestJS, ExcelJS, Vitest, Jest.

**Spec:** User-confirmed 2026-10-30 requirements in this chat: sales approved; dispatch successfully synced to Shopify; procurement fully ordered and paid with applicable platform push complete; allocation approved; warehouse outbound completed. Warehouse wording is 已出库清单. Filters use each phase's actual completion time: 1w/1m/3m, default 1w.

## Global Constraints
- Authorization precedes filters, totals, pagination and export; completed lists never widen access.
- Missing, invalid and future completion dates are excluded; do not substitute other timestamps.
- Completion lists are read-only; no repeat approvals, stock queries or supplier催办 actions.
- Preserve original pending queue semantics, navigation defaults and amount totals.
- Mock examples cover recent week/month/quarter and older records; real timestamps require trusted gateway facts.

## Review Focus
- A forged completed flag cannot turn an unpaid queue into an archive or bypass queue permissions.
- Later workflow progress does not remove a prior completed phase; cancelled/refunded/unknown facts are not completed.
- Default range applies even when omitted by API clients; list and export use the same clock/filter.
- Switching between pending/completed clears incompatible task-state filters and stale selections.
- Purchase-group detail and exports cannot include pending or out-of-range fulfillment rows.

## Tasks
- [x] Add failing tests for completion classification, date boundaries/defaults, missing dates, cancelled/partial records, scoped list/export and UI navigation.
- [x] Implement backend completion helpers, DTO validation, timestamps, authorization-preserving filters and exports.
- [x] Reuse frontend lists for five completed tabs, completion-date filter/column/sort and read-only actions; retain procurement view modes.
- [x] Extend demo facts, gateway/OpenAPI contracts and source mapping with explicit production integration limits.
- [x] Run frontend/backend tests, lint, type/build checks; visually verify all five tabs in light/dark layouts.

Ruling: completed=true reuses the five original phase queues instead of adding permission types; frontend queue=completed remains stable through filter/sort/page recovery.

Review: independent review found pending-only response validation, navigation overwriting completed, receipt sort default ambiguity, and procurement sort wording. Fixed with real completed-row, completion-date, filter persistence, page recovery and receipt-sort tests. Frontend API mocks remain isolated.

Verification note: 12 live localhost XLSX exports (five queues and purchase groups, filtered and selected) returned 200 and included the correct phase completion column. Recent mock dates rotate independently of owner index so even-sized teams retain a week of completed outbound examples for each salesperson.

Final verification: frontend 69 files / 536 tests; full backend 74 suites / 731 tests before final export-label and purchase-stage boundary refinements, followed by 51 targeted backend tests and 202 HTTP isolation tests on the final code; lint, frontend production build, backend no-emit typecheck and git diff --check passed. Five workbenches, procurement modes/details, 1w↔1m navigation and light/dark appearance checked in the local app at 1920×1080. Warehouse label 已出库清单.

Ruling: procurement completion does not additionally require sales approval, preserving the original procurement queue contract; sales/dispatch/allocation/outbound keep their approval prerequisites. Real upstream completion timestamps remain a documented gateway requirement.

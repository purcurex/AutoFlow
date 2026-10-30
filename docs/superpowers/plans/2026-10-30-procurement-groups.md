# Procurement Groups Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; review the completed change once.

**Goal:** Implement the user-approved procurement grouping alongside the existing fulfillment view.
**Architecture:** A complete subject-bound purchase-link snapshot feeds server-side permission intersection, obligation queues, filters and grouped totals. Separate read/export endpoints support a paginated, expandable Vue view; existing fulfillment and dashboard contracts remain unchanged.
**Tech Stack:** NestJS, TypeScript, Vue3, ExcelJS, Jest, Vitest.
**Spec:** docs/superpowers/specs/2026-10-30-procurement-groups.md

## Constraints / rulings
- Reuse current feature checkout and preserve all preceding uncommitted user changes. No FOP repository mutations or credential changes.
- Keep financial totals out of group headers. Quantities refer to source fulfillment units. Whole-purchase header payment status requires independent purchase permission; shipment totals are visible-source totals.
- Snapshot explicitly distinguishes unknown linkage, confirmed uncreated obligations and no outstanding obligation. Never infer absence from an incomplete response.
- New live employee-gateway method is a documented integration requirement, not a claim that cloud FOP is connected.

## Tasks
- [x] 1. Add procurement-groups types, aggregation/validation, DTOs and pure tests for many-to-many linkage, unauthorized siblings, queue independence, unknown and absent purchase, search and pagination counts.
- [x] 2. Wire FopDataService/provider/HTTP routes, Demo complete snapshots and independent grants. Add grouped details and Excel export with fresh authorization/selection checks. Test service and HTTP isolation.
- [x] 3. Add procurement API and grouped Vue view, source filters, group/detail pagination, expand/copy/contact, export, view switch and session-safe refresh. Test actual rendered interaction and stale responses.
- [x] 4. Update agent contract and integration handoff, run relevant tests/build/lint, browser check and independent review; fix findings and report production dependencies.

## Verification ledger
Initial state: branch codex/company-directory-access; prior user changes retained. API interfaces owned by tasks 1/2 and consumed by task 3 must match. Snapshot is separate from paid-only supplier follow-up.


Final verification (2026-10-30):
- Backend all unit suites: 69 suites / 654 tests passed. HTTP isolation: 188 passed.
- Frontend all suites: 68 suites / 473 tests passed. Both production builds passed; changed backend lint and frontend lint passed; git diff --check passed.
- Independent review found current-ownership race and cross-queue follow-up rejection. Both reproduced RED in HTTP tests, corrected, then all relevant suites GREEN. Demo follow-up IDs/quantities unified with grouped purchase linkage (RED→GREEN).
- Browser: default grouping renders a purchase containing four visible fulfillment orders; same purchase ID in source follow-up dialog; original fulfillment view loads and toggles back. Screenshot stored in .runtime/procurement-groups/purchase-groups.png.
- Decision: reuse current feature checkout; preserve existing uncommitted theme, stock and payment-label work. Leave changes uncommitted for the user's existing workflow; no merge, push or FOP source edits.
- Live dependency remains explicit: employee gateway /purchase-links plus independent purchase authorization and authoritative source quantity/payment/shipment mapping. Local Demo success is not cloud FOP integration evidence.

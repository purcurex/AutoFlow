# HyperZone Collections Performance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for independent source investigation and frontend work. User explicitly authorized direct implementation; no further approval gate.

**Goal:** Implement scheme 2: paid/approved fulfillment collections plus paid/approved full-payment stocking collections in the UTC+8 payment month, excluding deposit stocking and avoiding prepaid inventory double counting.

**Architecture:** Add an independently authorized normalized receipt-line resource to the FOP provider. Dashboard and customer amounts share this ledger; fulfillment counts remain order-based. Receipt drill-down lives in the workbench and uses the same cohort, date, warehouse and permission filters. Real FOP network access remains unconfigured until published endpoints are available.

**Tech Stack:** Vue 3, NestJS, TypeScript, ECharts, OpenAPI 3.1.1.

**Spec:** User-approved scheme 2 in this chat and `agent.md`; verified source evidence in `docs/analytics/HYPERZONE_FOP_SOURCE_MAPPING.md`.

## Global constraints

- Existing checkout and local authoritative release workflow retained by user authorization.
- No modifications to `/Library/VSCode/dtr5b`; source is read-only evidence.
- UTC+8 labels and fixed offset date/month grouping; payment date controls attribution, audit controls inclusion.
- Actual receipt line amount drives performance; preserve order amount and handling fee separately. Never sum a receipt header per line.
- Stocking collections have no carrier and never count as fulfillment orders or logistics volume.
- New receipt grants fail closed when missing; tenant/employee/department scopes and revocation rechecks apply.
- No scheme 1 restoration in the performance amount. No invented production FOP endpoints.

## Review focus

- Paid unapproved orders/receipts, unpaid/deposit/void records and permissions cannot inflate statistics.
- Cross-month UTC+8 boundary, previous December, late approval, prepaid use and zero additional payment.
- Stock-only customers are searchable and appear in total/other; Top 10 membership is still ranked by fulfillment counts.
- Warehouse totals, receipt source totals and paginated drill-down agree; other cohort does not rerank on drill.
- Receipt IDs are line-level; duplicate or malformed authorized records fail safely, no per-header duplication.

## Tasks

- [x] Record backend facts and source mappings; define receipt contract and test failures before implementation.
- [x] Implement scoped receipt provider, deterministic Mock, UTC+8 helpers, shared collection eligibility/aggregation, receipt endpoints and tests.
- [x] Update frontend amounts, source breakdown, workbench receipt details, date labels, zero-order customer behavior and interaction tests.
- [x] Revise requirements, backend/frontend diagnosis, README and OpenAPI; regenerate validated MD/HTML.
- [x] Run lint, full unit/E2E, compile/build, live schema checks and browser smoke; independently review and fix meaningful issues. Release commit/push evidence is recorded by Git and the final handoff.

## Execution record

- Ruling: User accepted scheme 2 and direct execution; write and execute this plan without a second design approval.
- Ruling: Receipt line `entryentity.hzkj_real_receive_amt` is the actual collection basis; source also contains order charge and fees. Preserve both to make business reconciliation explicit.
- Ruling: Paid and approved source documents plus approved/received receipt lines are required. Historical periods reflect current valid status; no new financial close/adjustment subsystem is invented.
- Ruling: Receipt resource is separately authorized, not inferred from an order allowlist. New fields and mock data must share the public contract.

- Verification: 152 frontend + 226 backend + 90 E2E = 468 tests passed; lint, builds, packaging, isolated production smoke, 19 live HTTP schema/reconciliation checks passed. OpenAPI: 17 operations / 69 models / 186 validated examples. HTML: 108 tables / 57 field tables / 17 response tables / 15 valid local anchors / two embedded logos.
- Independent review fixes: reject duplicate authorized receipt IDs and malformed nested references; keep receipt-only customers out of fulfillment Top10 (unless explicitly selected); show oldest task time in UTC+8. Targeted failing tests preceded fixes; fresh full suites then passed.
- Browser verification: department monthly receipt drill and source filtering reconcile; STC001 zero fulfillment orders with positive stock receipts, HZ receipt drill matches warehouse amount. No production FOP connection claimed.

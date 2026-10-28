# Procurement payment time and shipment reminders

> **For agentic workers:** Use superpowers:executing-plans.

**Goal:** Replace creation time in procurement_shipping with actual supplier payment time and mark outstanding shipments orange after 24h, red after 48h (confirmed by user).
**Architecture:** Add optional procurementPaidAt to the trusted order contract, normalize to UTC/null, show UTC+8 and export the same field. Shared list computes age from current computer time, updates while open and on focus; missing/invalid/future timestamps never falsely flag overdue. Keep queue/status enums, permissions and default oldest receipt ordering unchanged.
**Tech Stack:** Vue/TypeScript, NestJS, Vitest/Jest, OpenAPI.
**Spec:** Current request, confirmed 48h response, agent.md and FOP PaidOrderAmountSyncService (1688 baseInfo.payTime; hzkj_paydate is due date).

## Constraints and decisions

- Only procurement_shipping changes its date column; no creation/receipt/consumer time fallback.
- For multiple effective paid purchase obligations still awaiting shipment, gateway supplies the earliest actual payment timestamp; already shipped/cancelled/refunded obligations are excluded. Do not expose unauthorized purchase details. Real mapping/persistence remains IT work, no FOP production changes.
- Strict boundaries: <=24h normal; >24h and <=48h orange; >48h red. Partial shipment also has outstanding work. Keep current status text and add explanatory hover text, no extra column.
- Preserve existing checkout changes. No Git commit requested.

## Review focus

Boundary instants, missing/invalid/future dates, switching queues, timer lifecycle/offline state, correct API/Excel source, stable Demo times, scope preservation.

## Task 1

- [x] Add UI boundary/live time tests, HTTP timestamp normalization/scope tests and Excel field tests; observe failures.
- [x] Implement timestamp contract/normalization, shared list coloring and timer, Demo and Excel.
- [x] Update requirements/OpenAPI/source mapping and regenerate MD/HTML; run suites, lint/build, browser checks and one independent final review.

Completed: frontend400, backend577, FOP HTTP175 tests passed; lint/build/package and432 OpenAPI examples passed. Browser checked actual date/status colors. Final review found a minor Demo midnight timestamp reset; reproduced with regression then fixed by anchoring the open backlog dates. Real FOP payment persistence/aggregation mapping remains documented IT integration work.

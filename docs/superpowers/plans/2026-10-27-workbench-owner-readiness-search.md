# Workbench owner layout, allocation dates and search reset

> Execute inline with superpowers:executing-plans. User requested direct implementation; reuse the active checkout and preserve existing changes. No Git commit requested.

**Goal:** Combine salesperson/department in two lines, reserve single-line identifier space, show actual allocation completion or consumer payment time, simplify warehouse choice and auto-reset cleared searches.
**Spec:** Latest user message; agent.md business rules; FOP hzkj_alloc_bill.hzkj_complete_time metadata and AllocationService refresh/release logic.
**Architecture:** Shared FopOrdersView handles all nine queues. Add nullable allocationReadyAt to trusted order contract; normalize only for existing ready allocations. Extend existing consumerPaidAt sort to allocation. Match Excel date/owner presentation, preserve source fields for filters/authorization. No FOP production edits.
**Tech:** Vue, NestJS, TypeScript, ExcelJS, OpenAPI.

## Constraints
- Salesperson cell: owner.name (fallback salesperson) then department.name, fixed two lines with missing values as —. No separate department column; department filter/API remains.
- Preserve outer-page scrolling and existing responsive cards; never introduce horizontal scrolling. Reserve numeric ID widths; long exceptional values may truncate with original title and copy retained.
- allocation_review displays allocationReadyAt from current FOP complete_time, not creation/audit time. Release resets it; reallocation uses current stored completion. allocation uses consumerPaidAt with existing time sorting; default paidAt asc remains.
- Empty user input after an applied search clears only search, returns page1, retains all filters/sort/pageSize/permissions. Initial load, ordinary editing and automated route hydration do not trigger extra search. Stale requests cannot overwrite cleared results.
- Warehouse all option is 全部 / All. Excel has combined two-line salesperson and appropriate time column.

## Review focus
Missing/invalid completion timestamps and released allocations; search clear during requests or browser back; preserving filters/authorization; nine queue column counts and long identifiers at desktop/card sizes; consistency of sorting/export.

## Task 1
- [x] Add failing UI search clear/race and allocation date tests, HTTP normalization/allocation consumer sort tests and Excel tests.
- [x] Implement shared layout/search/date changes, FE/BFF/Demo contract and Excel; run targeted tests.
- [x] Update requirements9.35, source mapping, OpenAPI, IT handoff; regenerate standard MD/HTML.
- [x] Run relevant full suites, lint/build, browser layout checks and one fresh final review; record actual results.

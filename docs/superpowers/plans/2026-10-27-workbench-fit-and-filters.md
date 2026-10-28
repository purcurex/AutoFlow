# Workbench fit and filters implementation plan

> Use superpowers:executing-plans inline, followed by one fresh independent review.

**Goal:** Apply the latest requested column order, inline SKU quantities, clean demo customer names, warehouse filter and carrier search; no horizontal scrolling and every field visible.
**Architecture:** Common FopOrdersView stays the single implementation for all queues. Wide content uses a fixed-width wrapping table; narrower content renders the same order cells as a labelled grid, with no hidden/collapsed fields. Keep selection, totals and sorting accessible in both modes. Backend filters permissions first, then warehouse/search, then totals/sorting/pagination/export.
**Tech stack:** Existing Vue/NestJS/ExcelJS/OpenAPI, no dependencies.
**Spec:** Latest user request plus explicit clarification: no left/right scroll; all fields must display within screen.

## Decisions
- Customer name immediately before store; order amount immediately after Shopify order. Quantity moves next to each SKU; remove separate quantity column, retain total units in product footer and detailed export sheet.
- Remove salesperson dropdown only. Retain free-text owner search, owner API compatibility and visible clearable legacy owner filter when an old URL contains ownerId.
- warehouseCode optional HZ/SZ, omitted=all; filter inherited by both Excel modes. Carrier search matches display name and code, case-insensitive, inside existing scope.
- Demo customer names lose salesperson suffix; actual salesperson field remains available.
- Ruling: user rejected internal horizontal scrolling. Use container-responsive labelled order grid below 1500px content width, wrapping table above. No hidden fields; narrow mode has separate sort controls and page selection.
- Do not change queue or Dashboard predicates, grants or FOP source code. No Git action requested this turn.

## Tasks
- [x] Tests: warehouse/carrier filtering and exports before pagination under permissions; UI request propagation, column order/inline quantities/no owner dropdown; legacy owner filter visible.
- [x] Implement DTO/client/service/demo, common responsive table and Excel output.
- [x] Update latest requirements and OpenAPI, regenerate HTML via shared standard; verify tests/lint/build, browser wide/narrow as supported, fresh review.

Verified: frontend340, backend555, HTTP230; lint/build/docs pass. Review findings fixed (status wrapping and compact-sort aria). No horizontal overflow at1920/1280/768/390. Temporary UI harness removed.

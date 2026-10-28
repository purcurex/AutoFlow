# Order list layout and destination country plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation and a final independent review.

**Goal:** Status before search on the same row; status-only cells and separate document numbers; product SKU/variant under the name; Customer destination country flag + alpha2 on all workbench lists.
**Architecture:** Existing common FopOrdersView covers all workbench queues. Add optional nullable shippingCountryCode to provider/public order contract, normalized from FOP hzkj_country.twocountrycode, never customer profile or warehouse. Reuse installed flag-icons assets offline. Number/status separation also applies to allocation tables. Excel mirrors grouping and country column.
**Tech Stack:** Vue/TypeScript/NestJS/ExcelJS/OpenAPI.
**Spec:** Latest user request plus FOP OrderDeliveryAddressValidationService buildOrderAddress.

## Constraints
- Keep exact header Customer (tooltip identifies destination country); existing customer-name column remains distinct.
- Canonical uppercase ISO alpha2 code; legacy missing/malformed/unrecognized returns null/— with no guessed flag.
- Product column stays second; show name, SKU, variant grouped by item; multiple items stay aligned to quantities. Full text remains accessible on hover.
- One dispatch status badge, no details disclosure in any queue. Separate all related dispatch numbers for dispatch/allocation queues.
- Status + search group comes first; owner/department on the right; wrap only as needed on narrow screens.
- Permissions, queues, card counts, amounts, sorting and selected/filtered export behavior remain intact.

## Review focus
- No wrong-country inference; empty/invalid/lowercase codes; old adapters.
- Multi-item names/SKUs/variants/quantities stay associated and totals align.
- Allocation/dispatch multiple numbers visible without duplicate status text.
- Search remains usable on small screens; status first and same row on desktop.
- Excel country and grouped item data preserve text IDs and per-order amount.

## Tasks
- [x] Add country contract, normalization, mock data and tests.
- [x] Update common toolbar, product/status/country columns and Excel; add UI/export tests.
- [x] Update requirements/OpenAPI/generated docs; validate tests/build, browser and independent review.

# Allocation review completion filter and approval

Implement the explicit request in the existing checkout. Preserve order-row structure, authorization, queue totals and prior changes. No Git commit requested.

## Task 1: Data and dispatch completion
Add nullable allocationDocuments (trusted FOP id/number references) to order contract, allowlisted serialization, Demo, fixtures and allocation-review Excel/UI. One order may have multiple documents; keep one order row. Only allocation_review uses dispatch_incomplete/dispatch_complete. Complete requires nonempty effective dispatch documents all approved, independent of Shopify sync; incomplete includes missing/unconfirmed facts. Keep queue membership unchanged. Align filters, sorting and exports; migrate old bookmarked filters.

## Task 2: Approval
Enable existing single/batch approval dialog for allocation_review. Shared selection stays available for Excel; approve requires at least one selected row with completed dispatch. Preview shows blocked rows and only eligible documents can execute. Server checks completion at preview, submit and before every document write alongside existing FOP permission, version, idempotency and native audit validation. Preserve result visibility/refresh/navigation/session guards. FOP source AllocationAuditOpPlugin and AllocationDeliveryNoticeService remain authoritative for exact package relations and duplicate/invalid dispatch rejection.

## Task 3: Delivery
Write meaningful RED/GREEN tests for statuses, trusted references, exports, mixed batch and stale completion. Update OpenAPI, requirements, handoff and generated MD/HTML. Run FE/BE/HTTP tests, lint/build and browser inspection. One final fresh read-only review, one Important/Critical fix pass as needed. Keep production FOP gateway validation explicit.

## Review focus
Do not hide incomplete orders or change Dashboard counts. Do not confuse Shopify synchronization with dispatch completion. Multi-document rows must not grant permission from displayed IDs, drop blocked items or bypass changed dispatch state. Existing sales approval and navigation/session protections must remain intact. Missing or malformed upstream document references must not become fabricated identifiers.

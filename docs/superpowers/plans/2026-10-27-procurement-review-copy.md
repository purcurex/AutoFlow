# Procurement filters, sales approval and tracking copy

Implement the user's explicit 2026-10-27 changes in the existing checkout. Preserve access scope, the independent purchased/shipment queue, Dashboard deduplication and unrelated uncommitted work.

## Task 1: Procurement and department filters
- Remove application-pending and unknown choices; show purchase-order preparation directly after automatic FOP application creation.
- Merge missing dispatch and pending tracking into one preparation status, without blocking purchase-order preparation.
- Add paid/unshipped immediately before refund follow-up; confirm how the existing independent shipping tab interacts with this selection.
- Rename the unfiltered business-department label to Marketing Center without changing authorization.
- Verify frontend/backend classification, list/export filtering and queue totals with focused tests (red then green).

## Task 2: Sales review approval and tracking copy
- Put an approval action before the sales review search box, using current-page checkboxes and the existing preview/confirm/result dialog.
- Preserve server permissions, versions, idempotency, partial results, session isolation; pause refresh/navigation while reviewing/submitting and refresh after closing results.
- Add accessible quick copy for selected Shopify tracking and warehouse tracking. Copy only the raw number and keep the 17-character example on one line.
- Verify one/multiple selections, stale sessions, denied preview, navigation/refresh and exact clipboard values.

## Task 3: Delivery verification
- Update current requirements, OpenAPI descriptions and generated Markdown/HTML using the project standard.
- Run frontend tests, backend serial tests, relevant HTTP tests, lint/build; check UI with browser and screenshot.
- One fresh final read-only review of this task delta; address important findings once, then report verified outcome. Do not commit unless requested.

## Review focus
Cross-queue paid/unshipped filter must preserve scopes/export/counts and default queue exclusivity. Approval must not submit after session change, be invoked by navigation, duplicate on retry, or disappear silently during background refresh. Copy must never include TC/WC/QC or carrier labels. Preserve direct Marketing Center department scope.

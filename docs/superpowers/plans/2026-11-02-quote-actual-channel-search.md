# Quote Actual Logistics Channel Search Implementation Plan

> Execute inline with superpowers:executing-plans; retain current checkout and unrelated summary-width changes.

**Goal:** Replace the customer quote page's custom-channel selector with direct, paged actual-channel search by carrier, channel code and name.
**Architecture:** Authenticated reserved catalog search endpoint delegates to FopLogisticsCatalogPort. Sandbox supplies only explicitly synthetic fixtures; live remains unavailable until FOP catalog integration and independent resource authorization are supplied. UI receives choices only from API; internal custom/actual association and quote payload stay compatible.
**Stack:** NestJS DTO/controller/ports, Vue 3, Vitest/Jest.
**Spec:** User request dated 2026-11-02 in current chat; FOP LogisticsChannelBasePlugin.java fields number/name/hzkj_logistics_providers.

- [x] Add failing HTTP/API and UI tests: authorization, query validation, cross-category fuzzy search, pagination, retained selection and stale response protection.
- [x] Add search DTO, catalog result contract, adapter search method and GET logistics/actual-channels; preserve existing resource permission guard and legacy endpoints.
- [x] Replace custom-category UI with actual-channel search/results/paging; retain per-channel margin and association metadata; show carrier in selected channels and quote matrix.
- [x] Document reserved endpoint, FOP field mapping and production integration/permission boundary; update project facts.
- [x] Run tests, lint, frontend build/backend typecheck and inspect actual page in light/dark modes. Do not commit/push unless requested.

## Verification ledger

- RED: new catalog HTTP route returned 404; new quote UI tests failed because actual-channel search did not exist.
- GREEN: frontend 70 files / 543 tests, backend 75 suites / 753 tests, E2E 6 suites / 299 tests; lint, frontend build and backend no-emit typecheck passed. Existing English title-case test caught one new lower-case label; corrected and reran full frontend checks.
- Real local UI inspected at 1920×1080 in light and dark themes; shows actual-channel search and honest integration-pending state. No FOP credentials, live resource grants or configuration changed.
- Independent read-only review found no actionable issues.
- Ruling: keep the independent resource guard deny-by-default and live adapter unavailable because the user requested an API reservation; formal directory data and resource authorization require FOP integration. No production read access inferred from order permissions.

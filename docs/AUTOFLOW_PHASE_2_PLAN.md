# AutoFlow Phase 2 Plan: FOP And Quotation

## 1. Status

Deferred by product decision on 2026-07-22. Phase 1 focuses on product/ad discovery, store discovery, public contact verification, lead qualification, and human-reviewed outreach. No live Kingdee Cloud Cosmic FOP quote API is required for the Phase 1 release.

## 2. Foundation Retained In Phase 1

- Fail-closed FOP provider ports and capability discovery.
- Versioned quote, product-tier, shipping-option, and handoff persistence entities.
- Deterministic sandbox adapters and contract tests.
- Product pricing contract with customer/sales-organization/price-policy context.
- Product tier results with cost components, suggested customer price, margin, approval, exchange-rate, and policy metadata.
- Freight contract with origin reference and explicit product/SKU context per package.

These foundations are retained to prevent a later rewrite, but they must not be presented as live FOP capability.

## 3. Phase 2 Worklist

1. Confirm Kingdee Cloud Cosmic authentication, tenant headers, signatures, token caching, and network requirements.
2. Confirm bill/form IDs, operation IDs, field mappings, and error envelopes for SKU/product master data.
3. Define SKU, product, unit, currency, purchase-cost, packaging, and price-policy synchronization ownership.
4. Implement live product pricing adapter and reconcile quantity tiers, effective dates, exchange rates, and approval states.
5. Implement live logistics-rate adapter and reconcile origin, destination, package, product restrictions, channels, surcharges, and expiry.
6. Complete multi-product and multi-country combined quotation UI with transparent snapshot references.
7. Implement controlled FOP lead/opportunity handoff with duplicate, ownership, stage, timeout, and partial-result handling.

## 4. Entry Gate

Phase 2 implementation starts only after approved FOP sandbox credentials, request/response samples, interface ownership, master-data mapping, and business acceptance rules are available. Production enablement additionally requires staging contract reconciliation and a tested rollback switch.

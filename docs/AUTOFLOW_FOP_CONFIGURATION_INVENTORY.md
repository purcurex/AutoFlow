# AutoFlow FOP Configuration And Interface Inventory

## 1. Purpose

This document is the production enablement checklist for Kingdee Cloud Cosmic FOP integration. No live adapter may be enabled until every mandatory item is confirmed against the FOP environment and sandbox responses are reconciled with approved fixtures.

## 2. Runtime Modes

| Mode | Intended environment | Behavior |
| --- | --- | --- |
| `disabled` | Any | All FOP capabilities fail closed. |
| `sandbox` | Development and test only | Deterministic synthetic fixtures with `sourceVersion=sandbox-fixture-v1`. |
| `live` | Controlled sandbox, staging, production | Remains unavailable until the inventory below is complete and live adapters are implemented. |

Production rejects `sandbox` capability advertisement. Synthetic values must never be labeled or exported as FOP prices.

## 3. Mandatory Environment Configuration

| Variable | Purpose | Secret | Current state |
| --- | --- | --- | --- |
| `FOP_INTEGRATION_MODE` | Runtime mode | No | Implemented |
| `FOP_BASE_URL` | Kingdee Cloud Cosmic API base URL | No | Awaiting FOP value |
| `FOP_TENANT_ID` | Tenant/account isolation | Treat as sensitive | Awaiting FOP value |
| `FOP_APP_ID` | Application identity | Treat as sensitive | Awaiting FOP value |
| `FOP_APP_SECRET` | Application credential | Yes | Awaiting secret injection |
| `FOP_PRODUCT_COST_OPERATION` | Product-cost operation/endpoint ID | No | Awaiting FOP inventory |
| `FOP_LOGISTICS_RATE_OPERATION` | Freight-rating operation/endpoint ID | No | Awaiting FOP inventory |
| `FOP_CRM_HANDOFF_OPERATION` | Lead/opportunity handoff operation/endpoint ID | No | Awaiting FOP inventory |
| `FOP_REQUEST_TIMEOUT_MS` | Provider timeout budget | No | Default 15000 ms |

Secrets belong in the deployment secret store and must not be committed to `.env`, logs, snapshots, or audit payloads.

## 4. Authentication Contract To Confirm

- Authentication protocol and token endpoint/operation.
- Token request fields, signature rules, tenant headers, clock-skew tolerance, and token lifetime.
- Refresh/re-authentication behavior and concurrent token caching rules.
- Required network allowlists, TLS certificate rules, and source IP restrictions.
- FOP error envelope for invalid credentials, expired tokens, permission errors, and throttling.

## 5. Product Cost Contract To Confirm

- Product and SKU master identifiers accepted by FOP.
- Unit and currency fields and whether currency conversion occurs in FOP.
- Quantity-tier boundary semantics and decimal scale/rounding rules.
- Cost composition: purchase cost, packaging, handling, tax, and other included/excluded components.
- Source bill/form ID, operation ID, field mappings, source version, effective time, and expiration.
- Missing SKU, inactive SKU, unit mismatch, duplicate request, and partial-result behavior.

## 6. Logistics Rate Contract To Confirm

- Country code standard and destination granularity beyond country, if any.
- Package quantity, actual weight, volumetric dimensions, units, and chargeable-weight rules.
- Channel code/name, freight amount, currency, transit-day range, restrictions, and surcharges.
- Multi-package and multi-product aggregation behavior.
- Remote area, oversize, prohibited goods, no-route, partial-result, and expired-rate behavior.
- Source bill/form ID, operation ID, field mappings, source version, effective time, and expiration.

## 7. CRM Handoff Contract To Confirm

- FOP lead and opportunity create/update operation IDs and field mappings.
- Duplicate matching rules, ownership rules, organization scope, and conflict response fields.
- Whether handoff creates only a lead or may create an opportunity in the same operation.
- Idempotency support and external-reference field for `autoFlowLeadId`.
- Allowed initial stage and fields AutoFlow may populate without overwriting FOP authority.

## 8. Reconciliation Gate

Before implementing or enabling `live`:

1. Obtain approved FOP request/response samples for product cost, logistics rates, and CRM handoff.
2. Remove or redact secrets and personal data from fixtures.
3. Map every field to the canonical ports in `fop-integration.types.ts`.
4. Run contract tests for successful, partial, duplicate, timeout, permission, invalid-input, and unavailable cases.
5. Compare sandbox fixture output with FOP output for currency, units, tier boundaries, countries, channels, effective time, and expiration.
6. Record accepted differences and obtain business/technical approval.
7. Enable `live` first in staging behind an explicit feature flag and rollback switch.

## 9. Current Conclusion

AutoFlow now has fail-closed runtime modes and deterministic contract fixtures. Live FOP enablement remains blocked by the external interface inventory and approved Kingdee Cloud Cosmic sandbox evidence, not by local quote persistence.

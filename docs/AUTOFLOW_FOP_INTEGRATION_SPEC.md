# AutoFlow FOP Integration Spec

## 1. Purpose

This document is the canonical boundary and contract specification between AutoFlow and the existing FOP system built on Kingdee Cloud Cosmic.

It intentionally defines stable AutoFlow ports and business payloads without inventing FOP URLs, bill identifiers, authentication fields, or Kingdee Cloud Cosmic plug-in APIs that have not yet been inventoried.

## 2. Responsibility Boundary

| Capability | AutoFlow | FOP |
|---|---|---|
| Product/store/customer discovery | Owner | Not required |
| Contact enrichment and lead scoring | Owner | May receive selected results |
| Outreach draft and human review | Owner | May receive summarized activity |
| Lightweight next action before handoff | Owner | Receives handoff context |
| Formal lead/opportunity/stage/follow-up | Read reference/sync status only | System of record |
| Product quantity and quote presentation | Captures tiers and presents quote | Supplies authoritative product cost/pricing result |
| Freight comparison | Captures destinations and displays options | Supplies authoritative channel/rate result |
| Combined quotation | Composes selected snapshots | Supplies underlying authoritative calculations |
| Order, fulfillment, finance, after-sales | Out of scope | Owner |

## 3. Integration Principles

- Browser clients call only AutoFlow backend APIs.
- FOP credentials and endpoint configuration remain server-side.
- AutoFlow business services depend on provider ports, not Kingdee-specific transport code.
- Every write or expensive calculation request has an idempotency key and correlation ID.
- FOP request and response snapshots are versioned and redacted before persistence.
- A quotation records the source system, external request ID, effective time, expiration, currency, and units.
- No silent local fallback is allowed for production product cost or freight amounts.
- Retrying a request with the same idempotency key must not create duplicate FOP leads, opportunities, or calculation jobs.

## 4. AutoFlow Provider Ports

Conceptual interfaces:

```ts
interface FopProductCostPort {
  getProductCosts(request: ProductCostRequest): Promise<ProductCostResult>
}

interface FopLogisticsRatePort {
  getShippingRates(request: ShippingRateRequest): Promise<ShippingRateResult>
}

interface FopCrmHandoffPort {
  handoffProspect(request: ProspectHandoffRequest): Promise<ProspectHandoffResult>
}
```

Transport DTOs, Kingdee dynamic-object fields, bill identifiers, and authentication are adapter concerns and must not leak into the quote domain.

## 5. Product Cost Contract

### Request

```text
requestId
idempotencyKey
correlationId
leadId
currency
items[]
  lineId
  fopProductId or SKU mapping reference
  unit
  quantityTiers[]
    minQuantity
    maxQuantity (optional)
```

Rules:

- Tiers are ordered by `minQuantity`.
- Tiers may not overlap.
- The last tier may omit `maxQuantity`.
- Every product must have an FOP mapping reference before a live cost request.
- Currency and unit are mandatory and explicit.

### Result

```text
provider = fop
externalRequestId
sourceVersion
effectiveAt
expiresAt (optional)
currency
items[]
  lineId
  fopProductId or SKU
  tiers[]
    minQuantity
    maxQuantity (optional)
    unitCost
    returnedFees[] (optional)
warnings[]
```

AutoFlow stores the result snapshot used by the quote. It does not reconstruct FOP cost rules.

## 6. Logistics Rate Contract

### Request

```text
requestId
idempotencyKey
correlationId
leadId
currency
originReference (optional; FOP default may apply)
destinationCountries[]
packages[]
  quantity
  weight
  weightUnit
  length
  width
  height
  dimensionUnit
productContext[]
  SKU or FOP product reference
  quantity
```

Rules:

- Countries use ISO 3166-1 alpha-2 codes.
- Currency uses an ISO 4217 code.
- Weight and dimension units are never inferred.
- Invalid or unsupported destinations are returned explicitly rather than omitted silently.

### Result

```text
provider = fop
externalRequestId
sourceVersion
effectiveAt
expiresAt (optional)
currency
destinations[]
  countryCode
  status
  options[]
    channelCode
    channelName
    chargeableWeight
    freightAmount
    returnedFees[] (optional)
    minTransitDays (optional)
    maxTransitDays (optional)
    restrictions[] (optional)
warnings[]
```

AutoFlow displays options grouped by destination country and records the user's selected channel. It does not duplicate the FOP logistics-rating algorithm.

## 7. Combined Quote Contract

A combined quote is a presentation model built from selected immutable snapshots:

```text
product line
x quantity tier
x destination country
x selected shipping channel
= product amount + freight amount + explicitly returned fees
```

Each result cell stores references to:

- Product-cost snapshot and tier.
- Shipping-rate snapshot and option.
- Currency and unit assumptions.
- Customer-facing product price entered or selected by the sales rep.
- Transparent arithmetic used to produce the displayed total.

If currencies differ, AutoFlow must request a normalized FOP result or an approved exchange-rate source. It must not apply an undocumented exchange rate.

## 8. Lead And Opportunity Handoff

### Request

```text
idempotencyKey
correlationId
autoFlowLeadId
handoffReason
store identity and domain
country/market/category
verified contacts[]
score and evidence summary
latest outreach outcome
latest quote summary and reference (optional)
AutoFlow owner reference
```

### Result

```text
fopLeadId
fopOpportunityId (optional)
fopStageCode (optional)
syncStatus
conflicts[]
updatedAt
```

Handoff rules:

- Handoff is explicit and user-triggered unless a later approved automation rule exists.
- FOP duplicate detection and ownership decisions are authoritative.
- AutoFlow stores FOP identifiers and conflicts but does not silently overwrite FOP master data.
- Subsequent AutoFlow changes are not assumed to synchronize bidirectionally until a separate sync contract is approved.

## 9. AutoFlow Backend API Surface

These are stable AutoFlow-facing endpoints. They do not prescribe the external FOP URL shape.

```text
GET    /api/autoflow/leads/:leadId/quotes
POST   /api/autoflow/leads/:leadId/quotes
GET    /api/autoflow/quotes/:quoteId
PATCH  /api/autoflow/quotes/:quoteId
POST   /api/autoflow/quotes/:quoteId/product-cost-requests
POST   /api/autoflow/quotes/:quoteId/shipping-rate-requests
POST   /api/autoflow/quotes/:quoteId/compose
POST   /api/autoflow/leads/:leadId/fop-handoffs
GET    /api/autoflow/fop-handoffs/:handoffId
```

All write endpoints require authenticated ownership checks and validated DTOs.

## 10. Failure And Retry Model

Integration call status:

```text
pending -> succeeded
pending -> retryable_failed -> pending
pending -> terminal_failed
succeeded -> superseded
```

- Timeouts, temporary network failures, and FOP throttling are retryable.
- Validation, missing product mapping, unsupported country, and permission failures require user/configuration action.
- A failed request leaves the quote draft intact.
- UI errors show the failed capability, retry state, correlation ID, and actionable message.
- Logs redact credentials, personal contact values where required, and unbounded raw payloads.

## 11. Current-Phase Placeholder Rules

Before live FOP integration:

- The quote route and controls may be implemented against an explicit test adapter.
- UI must visibly identify `test`, `mock`, `not_configured`, and `fop` sources.
- Production configuration without an FOP adapter returns `503 Service Unavailable`.
- Placeholder responses must never be saved or displayed as real FOP prices.
- Exact FOP endpoint, authentication, bill/form IDs, field mappings, and error codes remain `TBD` until the FOP API inventory is supplied.

## 12. FOP Inventory Required Before Live Integration

- Kingdee Cloud Cosmic environment and API base URL per environment.
- Authentication mechanism, token lifetime, and credential rotation process.
- Product/SKU master identifiers and AutoFlow mapping source.
- Product-cost calculation operation and required fields.
- Logistics-rate calculation operation, country/channel codes, package rules, and returned fee fields.
- Lead/opportunity create-or-update operations and duplicate/ownership behavior.
- Opportunity-stage and follow-up operations needed for handoff confirmation.
- Rate limits, timeout guidance, idempotency support, and error-code catalogue.
- Test tenant, approved fixtures, and data-desensitization requirements.

## 13. Acceptance Gate For Live FOP Enablement

- Contract fixtures are approved by both AutoFlow and FOP owners.
- Sandbox requests are traceable end to end with correlation IDs.
- Duplicate handoff and duplicate quote requests are idempotent.
- Product tier and multi-country freight results reconcile with FOP for approved fixtures.
- Unsupported destination, missing SKU mapping, timeout, permission failure, and partial-result cases are tested.
- Production secrets, timeouts, retries, redaction, monitoring, and rollback are configured.

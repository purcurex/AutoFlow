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

## 5. Product Pricing Contract

### Request

```text
requestId
idempotencyKey
correlationId
leadId
currency
pricingContext (optional)
  customerReference (optional)
  salesOrganizationReference (optional)
  pricePolicyReference (optional)
items[]
  lineId
  fopProductId or SKU mapping reference
  unit
  productProfitMarginRate
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
pricingPolicyVersion
effectiveAt
expiresAt (optional)
currency
exchangeRate (optional)
  sourceCurrency
  targetCurrency
  rate
  sourceVersion
  effectiveAt
items[]
  lineId
  fopProductId or SKU
  tiers[]
    minQuantity
    maxQuantity (optional)
    unitCost
    suggestedCustomerUnitPrice
    appliedProfitMarginRate
    customerUnitPrice
    costComponents[]
      code
      name
      amount
    grossMarginRate
    pricePolicyReference (optional)
    approvalStatus
    returnedFees[] (optional)
warnings[]
```

AutoFlow stores the result snapshot used by the quote. FOP remains authoritative for purchase cost, exchange rate, price policy, and approval rules. AutoFlow's user-defined product gross margin is a presentation input and uses the explicit formula `customerUnitPrice = unitCost / (1 - productProfitMarginRate)`.

## 6. Logistics Channel Catalog Contract

FOP owns both levels of logistics master data:

```text
customLogisticsChannels[]
  code
  name
  enabled
  sortOrder (optional)

actualLogisticsChannels[]
  customChannelCode
  code
  name
  enabled
  carrierName (optional)
  serviceLevel (optional)
  supportedCountries[] (optional)
```

AutoFlow first loads custom logistics channels and then loads actual channels for the selected custom channel. Only actual channel codes may be submitted for freight calculation. AutoFlow stores names as display snapshots but treats FOP codes as the integration identity.

## 7. Logistics Rate Contract

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
  unit
selectedChannels[]
  customChannelCode
  customChannelName
  actualChannelCode
  actualChannelName
  logisticsProfitMarginRate
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
    customChannelCode
    customChannelName
    channelCode
    channelName
    chargeableWeight
    freightAmount
    logisticsProfitMarginRate
    customerFreightAmount
    returnedFees[] (optional)
    minTransitDays (optional)
    maxTransitDays (optional)
    restrictions[] (optional)
warnings[]
```

AutoFlow displays options grouped by destination country and records all selected actual channels. It does not duplicate the FOP logistics-rating algorithm. FOP `freightAmount` is preserved as the base logistics cost; AutoFlow calculates `customerFreightAmount = freightAmount / (1 - logisticsProfitMarginRate)` and stores both values.

## 8. Combined Quote Contract

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

### 8.1 Excel Export Contract

Excel export is generated from one selected immutable quotation version, never from an untracked provider response. The workbook maps:

- Product/SKU, unit, and quantity tier.
- Destination country.
- FOP custom logistics channel, actual logistics channel, and carrier.
- FOP purchase cost and freight cost.
- Product and logistics gross-margin percentages.
- Customer product price, customer freight, total price, and currency.
- Quotation ID, quotation version, FOP source version, and generation date.

Missing provider amounts remain blank. The export generator may format and group rows, but it may not recalculate FOP cost or logistics rates. The workbook is an internal quotation-review artifact because it contains cost and margin columns; the user must remove internal columns before external sharing.

## 9. Lead And Opportunity Handoff

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

## 10. AutoFlow Backend API Surface

These are stable AutoFlow-facing endpoints. They do not prescribe the external FOP URL shape.

```text
GET    /api/autoflow/integrations/fop/capabilities
POST   /api/autoflow/integrations/fop/products/purchase-costs
GET    /api/autoflow/integrations/fop/logistics/custom-channels
GET    /api/autoflow/integrations/fop/logistics/custom-channels/:customChannelCode/actual-channels
GET    /api/autoflow/quotes
POST   /api/autoflow/quotes
GET    /api/autoflow/quotes/:quoteId
POST   /api/autoflow/quotes/:quoteId/versions
GET    /api/autoflow/quotes/:quoteId/versions/:version/export.xlsx
POST   /api/autoflow/quotes/:quoteId/request-fop
GET    /api/autoflow/leads/:leadId/fop-handoff
POST   /api/autoflow/leads/:leadId/fop-handoff
```

All write endpoints require authenticated ownership checks and validated DTOs.

## 11. Failure And Retry Model

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

## 12. Current-Phase Placeholder Rules

Before live FOP integration:

- The quote route and controls may be implemented against an explicit test adapter.
- UI must visibly identify `test`, `mock`, `not_configured`, and `fop` sources.
- Production configuration without an FOP adapter returns `503 Service Unavailable`.
- Placeholder responses must never be saved or displayed as real FOP prices.
- Exact FOP endpoint, authentication, bill/form IDs, field mappings, and error codes remain `TBD` until the FOP API inventory is supplied.

## 13. FOP Inventory Required Before Live Integration

- Kingdee Cloud Cosmic environment and API base URL per environment.
- Authentication mechanism, token lifetime, and credential rotation process.
- Product/SKU master identifiers and AutoFlow mapping source.
- Product-cost calculation operation and required fields.
- Custom-logistics-channel and actual-logistics-channel query operations, status fields, ordering, and code stability rules.
- Logistics-rate calculation operation, country/channel codes, package rules, and returned fee fields.
- Lead/opportunity create-or-update operations and duplicate/ownership behavior.
- Opportunity-stage and follow-up operations needed for handoff confirmation.
- Rate limits, timeout guidance, idempotency support, and error-code catalogue.
- Test tenant, approved fixtures, and data-desensitization requirements.

## 14. Acceptance Gate For Live FOP Enablement

- Contract fixtures are approved by both AutoFlow and FOP owners.
- Sandbox requests are traceable end to end with correlation IDs.
- Duplicate handoff and duplicate quote requests are idempotent.
- Product tier and multi-country freight results reconcile with FOP for approved fixtures.
- Unsupported destination, missing SKU mapping, timeout, permission failure, and partial-result cases are tested.
- Production secrets, timeouts, retries, redaction, monitoring, and rollback are configured.

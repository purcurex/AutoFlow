# AutoFlow 1688 Sourcing Integration Spec

## 1. Decision

AutoFlow integrates directly with the Alibaba 1688 Open Platform cross-border API family and treats results as an independent product-sourcing capability.

Confirmed API family:

1. `com.alibaba.fenxiao.crossborder:product.search.keywordQuery-1` for multilingual keyword sourcing.
2. `com.alibaba.fenxiao.crossborder:product.search.imageQuery-1` for image sourcing.
3. `com.alibaba.fenxiao.crossborder:product.search.queryProductDetail-1` for offer and supplier detail hydration.

The downloaded `ocean.client.java.biz` package is used only as a contract and signing reference. AutoFlow does not ship the old Java SDK or its legacy dependencies. The production adapter is implemented in TypeScript inside the NestJS backend.

## 2. Product Boundary

`1688货源` is procurement evidence, not prospect contact evidence.

- It is linked to the product signal and workflow run.
- It is not stored as `LeadContactEntity`.
- It does not add phone, WhatsApp, Facebook, email, or other customer-contact evidence.
- It does not affect `contactScore`.
- It does not affect the customer `totalScore`; sourcing suitability is shown as a separate `sourcingScore`.
- The 1688 supplier is a procurement candidate and must not be represented as the overseas customer being developed.
- Every visible result carries the explicit source label `1688货源`.

## 3. API Selection

### 3.1 Keyword Search

API:

```text
com.alibaba.fenxiao.crossborder:product.search.keywordQuery-1
```

Request path:

```text
POST https://gw.open.1688.com/openapi/param2/1/com.alibaba.fenxiao.crossborder/product.search.keywordQuery/{APP_KEY}
```

Primary request object:

```json
{
  "offerQueryParam": {
    "keyword": "pet grooming brush",
    "beginPage": 1,
    "pageSize": 20,
    "priceStart": "1",
    "priceEnd": "100",
    "country": "en",
    "keywordTranslate": false
  }
}
```

Use this API when the workflow starts with a product keyword.

### 3.2 Image Search

API:

```text
com.alibaba.fenxiao.crossborder:product.search.imageQuery-1
```

Request path:

```text
POST https://gw.open.1688.com/openapi/param2/1/com.alibaba.fenxiao.crossborder/product.search.imageQuery/{APP_KEY}
```

Core request:

```json
{
  "offerQueryParam": {
    "imageAddress": "https://public.example.com/product.jpg",
    "beginPage": 1,
    "pageSize": 20,
    "priceStart": "1",
    "priceEnd": "100",
    "country": "en"
  }
}
```

The image URL must be publicly reachable by the Alibaba gateway. AutoFlow keeps provider image limits configurable and must not submit a local-only browser URL.

### 3.3 Product And Seller Hydration

API:

```text
com.alibaba.fenxiao.crossborder:product.search.queryProductDetail-1
```

Request path:

```text
POST https://gw.open.1688.com/openapi/param2/1/com.alibaba.fenxiao.crossborder/product.search.queryProductDetail/{APP_KEY}
```

The detail call hydrates the top search results with:

- `offerId` or `openOfferId`.
- Product title, main image, offer URL, MOQ, tier prices, SKU/attributes.
- Seller member ID, company name, shop URL, region, and supplier badges.
- Availability, delivery promise, repurchase/transaction indicators, and customization support.

Detail hydration is capped so one workflow cannot create unbounded provider traffic.

## 4. Authentication And Secrets

The two supplied search APIs require:

- `_aop_signature`.
- `access_token`.
- `AppKey` in the request path.
- `AppSecret` on the AutoFlow backend to generate the request signature.

AppKey and AppSecret alone are insufficient. Alibaba OAuth authorization returns an `access_token`; it has an expiry and must be refreshed or reauthorized according to the application's authorization type.

Local configuration:

```text
backend/.env.alibaba1688.local
```

Tracked template:

```text
backend/.env.alibaba1688.local.example
```

Required before enabling:

```dotenv
ALIBABA_1688_ENABLED=true
ALIBABA_1688_APP_KEY=your-app-key
ALIBABA_1688_APP_SECRET=your-app-secret
ALIBABA_1688_ACCESS_TOKEN=your-authorized-access-token
```

Security rules:

- AppSecret, access token, and refresh token remain server-side.
- Secrets are never returned through an API, browser bundle, log, audit payload, or provider snapshot.
- Persisted tokens must be encrypted at rest before multi-account OAuth is introduced.
- Logs may retain provider request IDs and redacted error codes, but never signatures or tokens.
- Compare the first live request with the Alibaba online API tool to verify signing.

## 5. Implemented Architecture

```text
Workflow Product Signal
        |
        v
Sourcing Orchestrator
        |
        +-- Alibaba1688Service.searchByKeyword
        +-- Alibaba1688Service.searchByImage
        +-- Alibaba1688Service.getProductDetail
        |
        v
Normalized 1688 Offers
        |
        +-- Product/Seller Hydration
        +-- Deduplication
        +-- Independent Sourcing Scoring
        |
        v
1688 Sourcing Results UI
```

Backend contract:

```text
GET  /api/autoflow/workflows/:workflowRunId/sourcing
POST /api/autoflow/workflows/:workflowRunId/sourcing/search
```

This capability belongs beside the discovery workflow, not inside contact enrichment.

## 6. Persistence Model

### `sourcing_searches`

- `id`, `workflow_run_id`, `owner_user_id`.
- `search_mode`: `keyword | image`.
- `query`, `source_asset_url`, `provider`.
- `status`, `provider_request_id`, timestamps.
- Redacted `failure_code` and `failure_message`.

### `sourcing_offers`

- `sourcing_search_id`, `provider_offer_id`.
- Product title, offer URL, image URL, category, attributes.
- MOQ, unit, price range, tier prices, currency.
- Availability, delivery commitment.
- `sourcing_score`, score reasons, retrieval time, raw snapshot hash.

### `sourcing_suppliers`

- `provider_member_id`, company and shop names, shop URL.
- Region, years on platform, supplier badges.
- Transaction, customization, and fulfillment indicators.
- Last verified time.

Offer deduplication uses `provider + provider_offer_id`. Supplier deduplication uses `provider + provider_member_id`.

## 7. Independent Sourcing Score

| Dimension | Weight |
|---|---:|
| Product/image relevance | 35 |
| Procurement price and tier suitability | 20 |
| MOQ suitability | 15 |
| Supplier reliability evidence | 15 |
| Delivery readiness | 10 |
| Customization/packaging capability | 5 |

Rules:

- Missing seller identity prevents an offer from being marked `recommended`.
- Missing price or MOQ produces `needs_review`.
- Supplier badges are evidence, not an automatic quality guarantee.
- Search-order position is never treated as supplier authority.
- No sourcing field is read by `calculateContactScore`.
- No sourcing field is added to the existing customer `totalScore`.

## 8. UI Design

Add a separate `1688货源` section to workflow results:

- Search mode, product image, and product title.
- Price range, tier prices, MOQ, and unit.
- Seller/company and 1688 shop.
- Supplier qualification, delivery, and customization indicators.
- Independent sourcing score and explainable reasons.
- `打开1688商品` and `打开1688店铺` actions in new browser tabs.
- Explicit `1688货源` source badge on every record.

Do not place 1688 supplier records in the customer-contact list. One workflow can contain both overseas prospect evidence and Chinese procurement-source evidence, but the UI must visually separate these roles.

## 9. Delivery Sequence

### P0 Configuration And Permission Check

- Configure AppKey, AppSecret, and an authorized access token.
- Confirm both search APIs are enabled for the AppKey.
- Capture one successful keyword response and one successful image response.
- Inventory current detail/supplier APIs and response fields.
- Verify signature output against the official online API tool.

### P1 Provider Adapter

- Add request signing and redacted telemetry.
- Implement keyword and image adapters.
- Normalize errors, paging, rate limits, and token expiry.
- Add provider contract fixtures from redacted real responses.

### P2 Persistence And Workflow

- Add sourcing entities and migration.
- Run sourcing in an independent queue step after the product signal is ready.
- Add idempotency, retries, deduplication, and snapshots.
- Ensure sourcing never changes contact or customer score fields.

### P3 UI And Ranking

- Add the `1688货源` result section and filters.
- Add offer/supplier detail views and sourcing-score explanation.
- Add secure external links and shortlist actions.

## 10. Acceptance Criteria

- Keyword and image search use application-authorized official 1688 APIs.
- A missing or expired access token fails clearly without fabricated fallback data.
- Every result is labelled `1688货源`.
- Offers link to the actual 1688 product and seller shop when returned.
- The same offer is not duplicated within a workflow.
- Procurement-source data is never persisted as a customer contact.
- `contactScore` and customer `totalScore` remain unchanged when sourcing results change.
- AppSecret and tokens never reach the frontend or application logs.

## 11. Official References

- Alibaba 1688 Open Platform: https://aop.alibaba.com/
- Alibaba Open Platform OAuth authorization: https://developer.alibaba.com/docs/doc.htm?articleId=102635&docType=1&treeId=1
- 1688 Open Platform announcements: https://aop.alibaba.com/doc/notice.htm

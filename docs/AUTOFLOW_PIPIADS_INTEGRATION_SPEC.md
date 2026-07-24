# AutoFlow PipiAds Integration Spec

## 1. Decision

PipiAds is the confirmed Phase 1 advertising discovery provider. It supplies keyword and image-based ad evidence plus candidate landing-page/store domains. AutoFlow treats this data as secondary discovery evidence, not as authoritative proof of business identity, contact ownership, or Shopify status.

## 2. Phase 1 Scope

- Search active ads by product keyword.
- Search similar ads from a public product image URL.
- Normalize provider records into AutoFlow ad evidence.
- Derive candidate store domains from ad landing pages.
- Independently verify storefront and Shopify signals.
- Extract and score public contact details from verified storefront evidence.
- Preserve provider timestamps, source URLs, and bounded raw evidence for audit.

Out of scope: automatic social messaging, provider-side customer lists, contact-data resale, and treating an advertiser profile as a verified customer.

## 3. Runtime Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `PIPIADS_API_KEY` | Server-side PipiAds Open API credential | none |
| `PIPIADS_BASE_URL` | Open API base URL | `https://www.pipispy.com/open-api/v1` |
| `PIPIADS_PAGE_SIZE` | Maximum records requested per page | `20` |
| `PIPIADS_REQUEST_TIMEOUT_MS` | Provider HTTP timeout | `30000` |
| `PIPIADS_IMAGE_POLL_INTERVAL_MS` | Image-task poll interval | `3000` |
| `PIPIADS_IMAGE_POLL_TIMEOUT_MS` | Image-task total wait budget | `45000` |

The key is backend-only. Production fails closed when it is absent. Non-production may return clearly labelled synthetic fixtures for repeatable workflow development.

## 4. Provider Operations

All operations are sent through PipiAds' `/open-api/v1/data` wrapper with `key`, `uri`, and `params`.

| Capability | Provider path |
| --- | --- |
| Keyword ad list | `/v3/api/open/adspy/list` |
| Ad detail | `/v3/api/open/adspy/detail` |
| Submit image URL | `/v3/api/open/ai-search/image/submit/image-url` |
| Read image task status | `/v3/api/open/ai-search/image/status` |
| Search ads by image task | `/v3/api/open/ai-search/image/search4/ad/search` |

Keyword queries request active ads and use a Shopify store-type filter. Image workflows are bounded by a deadline; timeout or provider failure produces a retryable workflow failure, never empty evidence presented as success.

## 5. Normalized Evidence

Each record preserves:

- Provider ad ID and provider name.
- Explicit `evidenceSource=pipiads_api` marking for live provider records; local fixtures use `pipiads_mock`.
- Ad title/copy, creative URL, source/ad URL, and landing-page URL.
- Candidate store domain and platform hint.
- A direct-ad-link flag. Facebook records with an ad ID fall back to the official `facebook.com/ads/library/?id=...` destination when the provider omits a direct URL.
- First-seen and last-seen timestamps when supplied.
- `evidenceAuthority=secondary` and `requiresOfficialVerification=true`.
- A bounded raw payload for troubleshooting without credentials.

Shopify status is set only after independent storefront enrichment. Contact candidates retain source URL and confidence and must be reviewed before outreach.

## 6. Reliability And Security

- Identical concurrent requests share one in-flight provider call.
- Page size and polling duration are bounded by configuration.
- Provider error bodies and API credentials are not returned to clients.
- Production does not silently fall back to mock data.
- PipiAds does not bypass outreach human-review requirements.

## 7. Enablement Gate

Before production use:

1. Add `PIPIADS_API_KEY` through the deployment secret store.
2. Run `npm.cmd run test:providers:live` to verify the Open API gateway using a one-record query.
3. Confirm account quota, geographic coverage, and permitted retention under the signed provider plan.
4. Run a 14-day sample against manually verified ads and stores.
5. Measure freshness, landing-domain accuracy, Shopify verification rate, contact extraction rate, and provider failure rate.
6. Record accepted thresholds and rollback criteria.

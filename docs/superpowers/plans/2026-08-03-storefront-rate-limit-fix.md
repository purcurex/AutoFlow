# Storefront Rate-Limit Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve an existing trustworthy storefront status when HTTP 429 blocks online verification, while continuing to reject certificate, URL, network, and evidence failures.

**Architecture:** Keep the change inside `StorefrontEnrichmentService`, where HTTP responses are already classified. Detect Axios HTTP 429 structurally, return the original candidate status with explicit verification-blocked evidence, and leave the current failure path unchanged for every other error.

**Tech Stack:** NestJS 11, TypeScript 5.9, Axios 1.x, Jest 30

## Global Constraints

- Do not call PipiAds, SerpAPI, or any other paid provider.
- Do not rerun workflow `02` or mutate existing database records.
- Do not bypass storefront rate limits with alternate identities, proxies, or retry loops.
- Do not promote `unverified` or `failed` candidates when HTTP 429 occurs.
- Keep certificate, private-address, unsafe-URL, redirect, and non-429 failures rejected.
- Limit production changes to storefront verification error classification.

---

### Task 1: Preserve candidate trust state on HTTP 429

**Files:**
- Modify: `backend/src/modules/discovery/storefront-enrichment.service.spec.ts`
- Modify: `backend/src/modules/discovery/storefront-enrichment.service.ts`

**Interfaces:**
- Consumes: `NormalizedShopifyStore.verificationStatus` and Axios errors with `response.status`.
- Produces: `StorefrontEnrichmentService.enrichStore(store)` results containing `verificationBlocked`, `verificationHttpStatus`, and `verificationError` inside `verificationEvidence` when status is 429.

- [ ] **Step 1: Add failing HTTP 429 regression cases**

Extend the Axios Jest mock with `isAxiosError`, then add a data-driven test proving that HTTP 429 preserves both `probable` and `unverified` input states without upgrading either:

```typescript
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    isAxiosError: (error: unknown) => Boolean(
      error && typeof error === 'object' && (error as { isAxiosError?: boolean }).isAxiosError,
    ),
  },
}))

it.each(['probable', 'unverified'] as const)(
  'preserves %s storefront evidence when verification is rate limited',
  async (verificationStatus) => {
    dnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    axiosGet.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 429',
      response: { status: 429 },
    })

    const [result] = await service(true).enrich([{ ...store, verificationStatus }])

    expect(result.verificationStatus).toBe(verificationStatus)
    expect(result.verificationEvidence).toEqual(expect.objectContaining({
      verificationBlocked: true,
      verificationHttpStatus: 429,
      verificationError: 'Request failed with status code 429',
    }))
    expect(result.verifiedAt).not.toBeNull()
  },
)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd --workspace backend test -- storefront-enrichment.service.spec.ts --runInBand
```

Expected: both new cases fail because the current catch block returns `verificationStatus: 'failed'` and does not write structured rate-limit evidence.

- [ ] **Step 3: Implement exact HTTP 429 classification**

Add a small helper and branch in `enrichStore`:

```typescript
private httpStatus(error: unknown): number | null {
  return axios.isAxiosError(error) && typeof error.response?.status === 'number'
    ? error.response.status
    : null
}
```

In the existing catch block, before the generic failure return:

```typescript
const verificationError = this.errorMessage(error)
if (this.httpStatus(error) === 429) {
  return {
    ...store,
    verificationEvidence: {
      ...store.verificationEvidence,
      verificationBlocked: true,
      verificationHttpStatus: 429,
      verificationError,
    },
    verifiedAt: new Date().toISOString(),
  }
}
```

Keep the existing generic error branch unchanged except for reusing `verificationError` so TLS, DNS, unsafe URL, redirect, and all non-429 errors still become `failed`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npm.cmd --workspace backend test -- storefront-enrichment.service.spec.ts --runInBand
```

Expected: all storefront enrichment tests pass, including the new `probable` and `unverified` 429 cases and the existing private-target rejection case.

- [ ] **Step 5: Run discovery regression tests**

Run:

```powershell
npm.cmd --workspace backend test -- discovery.adapters.spec.ts discovery.service.spec.ts --runInBand
```

Expected: PipiAds candidate generation, provider fallback, evidence persistence, deduplication, and candidate matching tests pass.

- [ ] **Step 6: Commit the focused bug fix**

```powershell
git add -- backend/src/modules/discovery/storefront-enrichment.service.ts backend/src/modules/discovery/storefront-enrichment.service.spec.ts
git commit -m "fix: preserve rate-limited storefront candidates"
```

### Task 2: Verify backend integrity

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: completed Task 1 implementation.
- Produces: fresh evidence that tests, lint, and compilation pass.

- [ ] **Step 1: Run the complete backend unit-test suite**

```powershell
npm.cmd --workspace backend run test -- --runInBand
```

Expected: all Jest suites and tests pass with zero failures.

- [ ] **Step 2: Run backend lint**

```powershell
npm.cmd --workspace backend run lint
```

Expected: ESLint exits with code 0 and reports no errors.

- [ ] **Step 3: Build the backend**

```powershell
npm.cmd --workspace backend run build
```

Expected: Nest TypeScript compilation exits with code 0.

- [ ] **Step 4: Check final scope and repository state**

```powershell
git diff --check
git status --short
git log -3 --oneline
```

Expected: no whitespace errors; only intentionally created documentation or implementation commits are present; no runtime-generated or unrelated files are added.

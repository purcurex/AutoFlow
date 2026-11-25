import { readSyncConfig, syncRuntimeRequire } from './workbench-sync-runtime.mjs'
// Injected test transports remain deterministic. Real HTTP always uses the persistent shared gate.
export function budgetedFetch(config, request=fetch) {
  if(request!==globalThis.fetch)return request
  // Legacy one-shot tools pass only their credential file. Resolve the same deployment DB
  // without copying secrets to process.env or changing the caller's pause/authentication flags.
  const resolved={...readSyncConfig({env:{...process.env,...config}}),...config}
  return syncRuntimeRequire(resolved)('fop-data/fop-rate-limit').fopBudgetedFetch({get:key=>resolved[key]},request)
}

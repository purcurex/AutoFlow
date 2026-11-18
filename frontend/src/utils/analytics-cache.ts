import { assertCurrentSession, captureSession, onSessionReset } from './session'

export interface AnalyticsQueryOptions { force?: boolean }
interface CacheScope { cacheable: boolean; version?: string }
interface Entry { json: string; queriedAt: number }
const MINUTE = 60_000
/** Daily daytime hours use UTC+8, including weekends, independent of browser timezone. */
export function analyticsInterval(now = Date.now()): number {
  const china = new Date(now + 8 * 60 * MINUTE), hour = china.getUTCHours()
  return (hour >= 9 && hour < 18 ? 30 : 120) * MINUTE
}
export function analyticsRefreshDelay(queriedAt: number, now = Date.now()): number {
  const china = new Date(now + 8 * 60 * MINUTE)
  const midnight = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate()) - 8 * 60 * MINUTE
  const boundaries = [9, 18, 24].map(hour => midnight + hour * 60 * MINUTE).filter(at => at > now)
  return Math.max(0, Math.min(queriedAt + analyticsInterval(now) - now, ...boundaries.map(at => at - now)))
}
const entries = new Map<string, Entry>()
const pending = new Map<string, Promise<unknown>>()
const metadata = new WeakMap<object, number>()
let scopeVersion = '', generation = 0
let scopeFlight: Promise<CacheScope> | undefined
export function clearAnalyticsCache() { generation++; entries.clear(); pending.clear(); scopeVersion = ''; scopeFlight = undefined }
onSessionReset(clearAnalyticsCache)
export const analyticsQueriedAt = (value: unknown) => value && typeof value === 'object' ? metadata.get(value) : undefined
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
  return value
}
async function scope(): Promise<CacheScope> {
  if (scopeFlight) return scopeFlight
  const session = captureSession()
  const flight = (async () => {
    const { getAnalyticsCacheScope } = await import('@/api/analytics-cache-scope')
    const result = await getAnalyticsCacheScope()
    assertCurrentSession(session)
    const version = result?.cacheable && result.version ? result.version : ''
    if (version !== scopeVersion) { generation++; entries.clear(); pending.clear(); scopeVersion = version }
    return { cacheable: !!version, version }
  })()
  scopeFlight = flight
  try { return await flight } finally { if (scopeFlight === flight) scopeFlight = undefined }
}
function copy<T>(entry: Entry): T {
  const value = JSON.parse(entry.json) as T
  if (value && typeof value === 'object') metadata.set(value, entry.queriedAt)
  return value
}
/** Only chart aggregates use this cache. Every reuse first validates current local authorization. */
export async function analyticsQuery<T>(endpoint: string, params: object, fetch: () => Promise<T>, options: AnalyticsQueryOptions = {}): Promise<T> {
  const session = captureSession(), access = await scope()
  assertCurrentSession(session)
  if (!access.cacheable) { const value = await fetch(); assertCurrentSession(session); return value }
  const revision = generation, key = JSON.stringify([session, access.version, endpoint, canonical(params)])
  const hit = entries.get(key)
  if (!options.force && hit && Date.now() - hit.queriedAt < analyticsInterval()) {
    entries.delete(key); entries.set(key, hit)
    return copy<T>(hit)
  }
  const existing = pending.get(key)
  if (!options.force && existing) { const entry = await existing as Entry; assertCurrentSession(session); return copy<T>(entry) }
  entries.delete(key)
  // The async closure checks its own identity after the first await.
  let request!: Promise<Entry>
  // eslint-disable-next-line prefer-const
  request = (async (): Promise<Entry> => {
    const value = await fetch()
    assertCurrentSession(session)
    const current = await scope()
    assertCurrentSession(session)
    if (generation !== revision || current.version !== access.version) throw new Error('Chart authorization changed; reload')
    // Publish only the newest request, but each caller owns its response and failure.
    // Refreshing another instance must not replace or delay this chart's result.
    const entry = { json: JSON.stringify(value), queriedAt: Date.now() }
    if (pending.get(key) === request) {
      entries.delete(key)
      if (entry.json.length <= 4_000_000) entries.set(key, entry)
      let size = [...entries.values()].reduce((sum, e) => sum + e.json.length, 0)
      while (entries.size > 64 || size > 4_000_000) {
        const oldest = entries.keys().next().value!
        size -= entries.get(oldest)!.json.length; entries.delete(oldest)
      }
    }
    return entry
  })()
  pending.set(key, request)
  try { return copy<T>(await request) } finally { if (pending.get(key) === request) pending.delete(key) }
}

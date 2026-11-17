/// <reference types="node" />
// Opt-in local HTTP verification. No upstream collection or synchronization is invoked.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getLocalDashboardAnalytics } from '@/api/local-dashboard-analytics'
import { clearAnalyticsCache } from '@/utils/analytics-cache'
const state = vi.hoisted(() => ({ cookie: '', aggregates: 0 }))
vi.mock('@/api/index', () => ({ default: { get: async (url: string, options?: { params?: Record<string, string> }) => {
 if (url === '/workbench/analytics/dashboard') state.aggregates++
 const params = new URLSearchParams(options?.params)
 const response = await fetch(`http://127.0.0.1:3000/api${url}?${params}`, { headers: { cookie: state.cookie } })
 if (!response.ok) throw new Error(`Local API ${response.status}`)
 return response.json()
} } }))
it.skipIf(process.env.ANALYTICS_LOCAL_VERIFY !== 'true')('verifies cache reuse and forced refresh against the running local database', async () => {
 const root = resolve(process.cwd(), '..')
 const source = readFileSync(resolve(root, '.runtime/export-single-live.cjs'), 'utf8')
 const email = source.match(/email:\s*['"]([^'"]+)['"]/)![1], password = source.match(/password:\s*['"]([^'"]+)['"]/)![1]
 const login = await fetch('http://127.0.0.1:3000/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
 expect(login.status).toBe(201); state.cookie = login.headers.get('set-cookie')!.split(';')[0]!
 clearAnalyticsCache(); state.aggregates = 0
 const params = { chartId: 'customer_orders' as const, from: '2026-11-01', to: '2026-11-16' }
 const times: number[] = []
 const load = async (force = false) => { const start = performance.now(); const result = await getLocalDashboardAnalytics(params, { force }); times.push(Math.round(performance.now() - start)); return result }
 const first = await load(); const cached = await load()
 expect(cached).toEqual(first); expect(state.aggregates).toBe(1)
 const fresh = await load(true); expect(fresh).toEqual(first); expect(state.aggregates).toBe(2)
 const report = { verifiedAt: new Date().toISOString(), chart: params.chartId, firstMs: times[0], cacheHitMs: times[1], forcedMs: times[2], aggregateCalls: state.aggregates, identicalResults: true, upstreamCalled: false }
 writeFileSync(resolve(root, '.runtime/chart-cache-20261116/live-cache.json'), JSON.stringify(report, null, 2))
 console.log(report)
}, 30_000)

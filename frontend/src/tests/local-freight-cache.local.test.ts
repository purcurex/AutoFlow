/// <reference types="node" />
// Opt-in local HTTP verification. No upstream collection or synchronization is invoked.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { getLocalFreight,type FreightDimension } from '@/api/local-freight'
import { clearAnalyticsCache } from '@/utils/analytics-cache'
const state = vi.hoisted(() => ({ cookie: '', aggregates: 0 }))
vi.mock('@/api/index', () => ({ default: { get: async (url: string, options?: { params?: Record<string, string> }) => {
 if (url === '/workbench/analytics/freight') state.aggregates++
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
 const times:{dimension:string;ms:number}[]=[]
 const expected=JSON.parse(readFileSync(resolve(root,'.runtime/freight-dimension-cache/before.json'),'utf8'))
 for(const dimension of ['carrier','channel','warehouse','country','customer','owner','department'] as FreightDimension[]){
  const start=performance.now(),result=await getLocalFreight({grain:'month',year:2026,currency:'CNY',dimension})
  times.push({dimension,ms:Math.round(performance.now()-start)})
  const before=expected.find((r:{dimension:string})=>r.dimension===dimension)
  expect(result.totals.amount).toBe(before.total);expect(result.billCount).toBe(before.billCount);expect(result.series.length).toBe(before.series)
  if(dimension==='department')expect(result.series.slice(0,4).map(s=>s.label)).toEqual(['业务一部','业务二部','业务三部','业务四部'])
 }
 expect(state.aggregates).toBe(1)
 await getLocalFreight({grain:'month',year:2026,currency:'CNY',dimension:'owner'},{force:true})
 expect(state.aggregates).toBe(2)
 const report={verifiedAt:new Date().toISOString(),times,aggregateCallsForSevenDimensions:1,manualRefreshCalls:1,identicalTotals:true,upstreamCalled:false}
 writeFileSync(resolve(root,'.runtime/freight-dimension-cache/after.json'),JSON.stringify(report,null,2));console.log(report)

}, 60_000)

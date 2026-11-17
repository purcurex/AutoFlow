import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {getLocalFreight,type FreightDimension} from '@/api/local-freight'
import {clearAnalyticsCache,analyticsQueriedAt} from '@/utils/analytics-cache'
const state=vi.hoisted(()=>({version:'one',calls:0}))
const dims:FreightDimension[]=['carrier','channel','warehouse','country','customer','owner','department']
vi.mock('@/api/index',()=>({default:{get:vi.fn(async(url,config)=>{
 if(url.endsWith('cache-scope'))return {cacheable:true,version:state.version}
 state.calls++
 expect(config.params).toMatchObject({currency:'CNY',allDimensions:true,dimension:'carrier'})
 return {query:config.params,dimensionSeries:Object.fromEntries(['carrier','channel','warehouse','country','customer','owner','department'].map(d=>[d,{series:[{id:d}],...(d==='owner'?{departmentSeries:[{id:'d1'}]}:{})}]))}
})}}))
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-21T10:00:00+08:00'));clearAnalyticsCache();state.calls=0;state.version='one'})
afterEach(()=>vi.useRealTimers())
it('loads all seven dimensions once, isolates clones and preserves refresh timestamp',async()=>{
 for(const dimension of dims){const r=await getLocalFreight({grain:'month',year:2026,currency:'USD',dimension});expect(r.series[0]!.id).toBe(dimension);expect(r.query.currency).toBe('CNY');expect(analyticsQueriedAt(r)).toBe(Date.now());if(dimension!=='owner')expect(r.departmentSeries).toBeUndefined();r.series=[]}
 expect(state.calls).toBe(1)
})
it('refreshes the entire bundle on manual query, source change, and expiry',async()=>{
 const q={grain:'month' as const,year:2026,currency:'CNY',dimension:'owner' as const}
 await getLocalFreight(q);await getLocalFreight(q,{force:true});expect(state.calls).toBe(2)
 state.version='two';await getLocalFreight(q);expect(state.calls).toBe(3)
 vi.setSystemTime(Date.now()+30*60_000);await getLocalFreight(q);expect(state.calls).toBe(4)
 await getLocalFreight({...q,warehouse:'HZ'});expect(state.calls).toBe(5)
})

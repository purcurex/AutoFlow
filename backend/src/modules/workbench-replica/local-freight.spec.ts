import { aggregateLocalFreight, localFreightPeriods, localFreightQuery } from './local-freight'
const query = { grain: 'month' as const, year: 2026, currency: 'CNY', dimension: 'carrier' as const }
const now = new Date('2026-11-16T08:00:00Z')
const row = (patch: Record<string, unknown> = {}) => ({ day: '2026-11-09', currency: 'CNY', dimension_id: '1', label: '服务商', amount: '0.10', bill_count: 1, weight_kg: '0.2', weighted_amount: '0.10', weight_count: 1, ...patch })
describe('rolling six-month freight range',()=>{
 it.each([
  ['2026-11-25T02:00:00Z',2026,'2026-06-01','2026-11-25'],
  ['2026-12-31T16:01:00Z',2027,'2026-08-01','2027-01-01'],
  ['2027-09-05T02:00:00Z',2027,'2027-04-01','2027-09-05'],
 ])('returns six consecutive months at %s', (at,year,from,to)=>{
  const periods=localFreightPeriods({...query,year,range:'last6months'} as any,new Date(at))
  expect(periods).toHaveLength(6)
  expect(periods[0].from).toBe(from);expect(periods[5].to).toBe(to)
  for(let i=1;i<periods.length;i++)expect(Date.parse(periods[i].from)-Date.parse(periods[i-1].to)).toBe(86400000)
 })
 it('shares the range with totals and rejects conflicting filters',()=>{
  const at=new Date('2027-01-05T02:00:00Z'),q={...query,year:2027,range:'last6months'} as any
  const result=aggregateLocalFreight([row({day:'2026-07-15',amount:'99'}),row({day:'2026-08-15',amount:'10'}),row({day:'2027-01-04',amount:'20'})],q,at)
  expect(result.totals.amount).toBe('30');expect(result.values).toHaveLength(6)
  expect(result.values.map(v=>v.amount)).toEqual(['10','0','0','0','0','20'])
  for(const patch of [{grain:'week'},{monthOf:'2027-01'},{range:'invalid'},{year:2026}])expect(()=>localFreightPeriods({...q,...patch},at)).toThrow()
 })
})
describe('local dispatch freight', () => {
 it('keeps department order independent of revenue ranking',()=>{
  const labels=['业务四部','业务三部','业务二部','业务一部']
  const result=aggregateLocalFreight(labels.map((label,i)=>row({dimension_id:String(i),label,amount:String(100-i)})),{...query,dimension:'department'},now)
  expect(result.series.map(s=>s.label)).toEqual(labels.reverse())
 })
 it('keeps all owners and provides exact matching department subtotals without changing overall metrics',()=>{
  const buckets=Array.from({length:12},(_,i)=>row({dimension_id:`p${i}`,label:'同名',amount:i===11?'0.20':'0.10'}))
  const members=buckets.map((r,i)=>({employeeId:r.dimension_id,englishName:`Person${i}`,departmentId:i<6?'d1':'d2',departmentName:i<6?'业务一部':'业务二部'}))
  const result=aggregateLocalFreight(buckets,{...query,dimension:'owner'},now,members)
  expect(result.series).toHaveLength(12)
  expect(result.series.some(s=>s.id==='__others')).toBe(false)
  expect(result.series[0]).toMatchObject({departmentId:'d1',englishName:'Person0'})
  expect(result.departmentSeries).toEqual(expect.arrayContaining([
   expect.objectContaining({id:'d1',label:'业务一部',billCount:6,totals:expect.objectContaining({amount:'0.6'})}),
   expect.objectContaining({id:'d2',label:'业务二部',billCount:6,totals:expect.objectContaining({amount:'0.7'})}),
  ]))
  expect(result.totals.amount).toBe('1.3');expect(result.billCount).toBe(12)
 })
 it('sums decimal source amounts once and uses the same weight-known sample', () => {
  const result = aggregateLocalFreight([row(), row({ amount: '0.20', weight_kg: null, weighted_amount: '0', weight_count: 0 })], query, now)
  expect(result.totals.amount).toBe('0.3')
  expect(result.billCount).toBe(2)
  expect(result.averagePerBill).toBe('0.15')
  expect(result.costPerKg).toBe('0.5')
  expect(result.weightBillCount).toBe(1)
 })
 it('does not mix currencies and preserves native groups', () => {
  const result = aggregateLocalFreight([row(),row({ currency: 'USD', amount: '80' }),row({ dimension_id:'2',label:'新服务商',amount:'2' })],query,now)
  expect(result.totals.amount).toBe('2.1')
  expect(result.series.map(x=>x.label)).toContain('新服务商')
 })
 it('compares an incomplete month with the same number of days', () => {
  const periods = localFreightPeriods(query,now)
  expect(periods[periods.length-1]).toMatchObject({from:'2026-11-01',to:'2026-11-16',previousFrom:'2026-10-01',previousTo:'2026-10-16'})
 })
 it('starts 2026 monthly totals in June, retaining May only as the comparison baseline',()=>{
  const result=aggregateLocalFreight([row({day:'2026-05-15',amount:'10'}),row({day:'2026-06-15',amount:'20'})],query,now)
  expect(result.periods[0]).toMatchObject({from:'2026-06-01',previousFrom:'2026-05-01'})
  expect(result.periods.map(p=>p.label)).toEqual(['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11'])
  expect(result.totals.amount).toBe('20');expect(result.billCount).toBe(1)
  expect(result.values[0].previousAmount).toBe('10')
  expect(localFreightPeriods({...query,year:2027},new Date('2027-03-15T00:00:00Z'))[0].from).toBe('2027-01-01')
 })
 it('uses June as the common start without gaps or duplicated days',()=>{
  for(const grain of ['week','month','year'] as const){
   const result=aggregateLocalFreight([row({day:'2026-05-31',amount:'999'}),row({day:'2026-06-01',amount:'10'}),row({day:'2026-11-16',amount:'20'})],{...query,grain},now)
   expect(result.periods[0].from).toBe('2026-06-01')
   expect(result.periods[result.periods.length-1].to).toBe('2026-11-16')
   expect(result.totals.amount).toBe('30');expect(result.billCount).toBe(2)
   for(let i=1;i<result.periods.length;i++)expect(Date.parse(result.periods[i].from)-Date.parse(result.periods[i-1].to)).toBe(86400000)
  }
 })
 it('rejects weekly anchors before June and aligns partial weeks across years',()=>{
  expect(()=>localFreightPeriods({...query,grain:'week',weekOf:'2026-05-31'},now)).toThrow()
  const periods=localFreightPeriods({...query,grain:'week',year:2027,weekOf:'2027-01-02'},new Date('2027-01-02T10:00:00Z'))
  expect(periods).toHaveLength(1)
  expect(periods[0]).toMatchObject({from:'2027-01-01',to:'2027-01-02',previousFrom:'2026-12-25',previousTo:'2026-12-26'})
 })
 it('preserves zero baselines and disappearing groups in other-group comparisons',()=>{
  const input=[row({day:'2026-06-05',dimension_id:'new',amount:'20'}),row({day:'2026-05-05',dimension_id:'old',amount:'10'}),...Array.from({length:12},(_,i)=>row({day:'2026-06-05',dimension_id:`g${i}`,amount:'1'}))]
  const result=aggregateLocalFreight(input,query,new Date('2026-06-30T10:00:00Z'))
  expect(result.totals).toMatchObject({amount:'32',previousAmount:'10',delta:'22',percent:220})
  expect(result.series.find(s=>s.id==='new')!.values[0]).toMatchObject({previousAmount:'0',delta:'20',percent:null})
  expect(result.series.reduce((n,s)=>n+Number(s.values[0].previousAmount),0)).toBe(10)
  expect(result.series.reduce((n,s)=>n+Number(s.values[0].delta),0)).toBe(22)
 })
 it('rejects future years and invalid dimensions',()=>{
  expect(()=>localFreightPeriods({...query,year:2027},now)).toThrow()
  expect(()=>localFreightQuery('batch','100000',[],{...query,dimension:'injected' as any},now)).toThrow()
 })
 it('binds company, native owner permission and warehouse parameters',()=>{
  const result=localFreightQuery('batch','100000',['owner1'],{...query,warehouse:'untrusted-value'},now)
  expect(result.params).toContain('untrusted-value')
  expect(result.params).toContainEqual(['owner1'])
  expect(result.sql).not.toContain('untrusted-value')
  expect(result.sql).toContain('WITH warehouse_names AS MATERIALIZED (')
 })
})

it('limits month shortcuts to the requested month and its comparison range',()=>{
 const current=localFreightPeriods({...query,monthOf:'2026-11'},now)
 expect(current).toHaveLength(1)
 expect(current[0]).toMatchObject({from:'2026-11-01',to:'2026-11-16',previousFrom:'2026-10-01',previousTo:'2026-10-16'})
 const previous=localFreightPeriods({...query,monthOf:'2026-10'},now)
 expect(previous).toHaveLength(1)
 expect(previous[0]).toMatchObject({from:'2026-10-01',to:'2026-10-31'})
 expect(localFreightPeriods({...query,year:2028,monthOf:'2028-02'},new Date('2028-03-05T02:00:00Z'))[0].to).toBe('2028-02-29')
 expect(localFreightPeriods({...query,monthOf:'2026-12'},new Date('2027-01-05T02:00:00Z'))[0].to).toBe('2026-12-31')
 for(const patch of [{monthOf:'2026-13'},{monthOf:'2027-01'},{monthOf:'2026-12'},{monthOf:'2026-05'},{monthOf:'2026-11',grain:'week' as const}])expect(()=>localFreightPeriods({...query,...patch},now)).toThrow()
 const result=aggregateLocalFreight([row(),row({day:'2026-10-01',amount:'20'})],{...query,monthOf:'2026-11'},now)
 expect(result.totals.amount).toBe('0.1')
})

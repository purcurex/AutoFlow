import * as detailsModule from './local-freight-details'
const details=detailsModule as any
const query={grain:'month' as const,year:2026,currency:'CNY',dimension:'carrier' as const}
const now=new Date('2026-11-18T00:00:00Z')
describe('freight source document drilldown',()=>{
 it('binds exact current period, native group and pagination without accepting comparison dates',()=>{
  expect(details.localFreightDetailsQuery).toEqual(expect.any(Function))
  const statement=details.localFreightDetailsQuery('b','company',['owner'],{...query,periodId:'2026-11',dimensionId:"native'",page:2,pageSize:50},now)
  expect(statement.params).toContain("native'");expect(statement.sql).not.toContain("native'")
  expect(statement.params).toContain('2026-11-01');expect(statement.params).toContain('2026-11-18')
  expect(statement.params.slice(-2)).toEqual([50,50])
  expect(()=>details.localFreightDetailsQuery('b','company',[],{...query,periodId:'2026-05'},now)).toThrow()
 })
 it('supports the shared workbench maximum page size without changing the result scope',()=>{
  expect(details.localFreightDetailsQuery('b','company',['owner'],{...query,pageSize:1000},now).params.slice(-2)).toEqual([1000,0])
 })
 it('keeps cross-year drilldown and export within the same rolling six-month range',()=>{
  const rolling={...query,year:2027,range:'last6months'},january=new Date('2027-01-05T00:00:00Z')
  for(const exportAll of [false,true]){
   const result=details.localFreightDetailsQuery('b','company',['owner'],rolling,january,undefined,exportAll)
   expect([result.from,result.to]).toEqual(['2026-08-01','2027-01-05'])
  }
  const month=details.localFreightDetailsQuery('b','company',['owner'],{...rolling,periodId:'2026-08'},january)
  expect([month.from,month.to]).toEqual(['2026-08-01','2026-08-31'])
  expect(()=>details.localFreightDetailsQuery('b','company',['owner'],{...rolling,periodId:'2026-07'},january)).toThrow()
 })
 it('does not allow an unbound other-group selection, invalid page or currency',()=>{
  for(const patch of [{dimensionId:'__others'},{page:0},{pageSize:1001},{currency:'USD'}])expect(()=>details.localFreightDetailsQuery('b','company',[],{...query,...patch},now)).toThrow()
 })
})

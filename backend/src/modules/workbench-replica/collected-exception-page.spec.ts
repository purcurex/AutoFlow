import { collectedExceptionPage } from './collected-exception-page'

describe('exception page shared membership',()=>{
 it('binds authorization and user filters inside the shared membership',()=>{
  const q=collectedExceptionPage('batch',['employee'],{queue:'exceptions',search:"%' OR TRUE --",taskStatus:'dispatch_exception',shippingCountryCode:'US'},1,20)
  expect(q.params).toContainEqual(['employee'])
  expect(q.sql).toContain('owner_employee_id = ANY')
  expect(q.sql).not.toContain("OR TRUE --")
  expect(q.sql).toContain('selected AS MATERIALIZED (SELECT * FROM matched WHERE country_code=')
  expect(q.sql).toContain('SELECT DISTINCT country_code FROM matched')
 })
 it('retains totals for count-only and out-of-range pages',()=>{
  const q=collectedExceptionPage('batch',[],{queue:'exceptions',projection:'count'},8,20)
  expect(q.params).toEqual(['batch',[],0,140])
  expect(q.sql).toContain('(SELECT count(*)::int FROM selected)')
  expect(q.sql).toContain("'[]'::jsonb) AS rows")
 })
 it('keeps unknown quantity distinct from zero and fetches documents only after pagination',()=>{
  const q=collectedExceptionPage('batch',null,{queue:'exceptions'},1,20)
  expect(q.sql).toContain('count(total_quantity)=count(*) AND count(*)>0')
  expect(q.sql).toContain('FROM page p JOIN hz_fop_collected_orders o ON o.batch_id=$1 AND o.source_id=p.source_id')
 })
})

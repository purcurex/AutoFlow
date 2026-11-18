import { collectedAllocationPredicate } from './collected-allocation-query'
it('requires explicit parent identity, current parent scope, known native states, and all captured allocations before classifying readiness',()=>{
 const sql=collectedAllocationPredicate('allocation_review')
 for(const part of ["a.batch_id=hz_fop_collected_orders.batch_id","a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id","raw_bill_status='C'","bool_and","completed"])expect(sql).toContain(part)
 expect(sql).not.toContain('raw_delivery_status')
})
it('does not assign audited or unknown allocation records to pending queues',()=>{expect(collectedAllocationPredicate('allocation')).toContain("IN ('A','B')");expect(collectedAllocationPredicate('allocation')).toContain("IN ('pending','available','completed')")})

it('never treats allocation operator as parent salesperson',()=>{expect(collectedAllocationPredicate('allocation')).not.toContain('a.owner_employee_id')})

it.each(['allocation','allocation_review'])('requires readiness only on remaining A/B allocations in %s',queue=>{
 const sql=collectedAllocationPredicate(queue)
 expect(sql).toContain("(a.display->>'rawBillStatus'='C' OR a.display->>'rawAllocationStatus' IS NOT NULL)")
 expect(sql).toContain("coalesce(a.display->>'rawBillStatus' IN ('A','B','C')")
 expect(sql).toContain("FILTER (WHERE a.display->>'rawBillStatus' IN ('A','B'))")
})

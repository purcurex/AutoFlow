import { collectedWhere } from './collected-workbench-query'
import { buildLocalOrderQuery } from './local-workbench-query'
const stages=['unfulfilled','fulfilled','unpurchased','purchased','unallocated','allocated','unshipped','shipped']
it.each(stages)('applies %s before pagination with employee isolation in both local query modes', fulfillmentStage=>{
 const query={queue:'review',completed:true,fulfillmentStage,timeRange:'1m'}
 const captured=collectedWhere('batch',['employee'],query)
 expect(captured.where).not.toContain('(FALSE)')
 expect(captured.where).toContain('owner_employee_id = ANY')
 expect(captured.params).toContainEqual(['employee'])
 const formal=buildLocalOrderQuery([],query)
 expect(formal.where).toContain('scope.employee_ids')
 expect(formal.where).toContain("o.order_review_state='approved'")
})
it('purchase and outbound progress use native order headers',()=>{
 expect(collectedWhere('b',null,{queue:'review',completed:true,fulfillmentStage:'unpurchased'}).where).toContain("raw->>'hzkj_purchase_status' IN ('0','1')")
 expect(collectedWhere('b',null,{queue:'review',completed:true,fulfillmentStage:'purchased'}).where).toContain("raw->>'hzkj_purchase_status' IN ('2','3','4')")
 expect(collectedWhere('b',null,{queue:'review',completed:true,fulfillmentStage:'shipped'}).where).toContain("raw_delivery_status='2'")
})
it('allocation completion requires all effective allocations ready and approved',()=>{
 const q=collectedWhere('b',null,{queue:'review',completed:true,fulfillmentStage:'allocated'})
 expect(q.where).toContain("bool_and(a.display->>'rawBillStatus'='C'")
 expect(q.where).toContain("rawAllocationStatus'='completed'")
 expect(q.where).toContain("IS DISTINCT FROM 'voided'")
})
it('does not apply sales progress to another queue or unknown option',()=>{
 expect(collectedWhere('b',null,{queue:'dispatch',fulfillmentStage:'purchased'}).where).toContain('(FALSE)')
 expect(()=>buildLocalOrderQuery([],{queue:'review',completed:true,fulfillmentStage:'injected'})).toThrow()
})
it.each(['unshipped','shipped'])('filters completed dispatch by native outbound %s before paging',fulfillmentStage=>{
 const query={queue:'dispatch',completed:true,fulfillmentStage,timeRange:'all'}
 const result=collectedWhere('batch',['employee'],query)
 const predicate=fulfillmentStage==='shipped'?"raw_delivery_status='2'":"raw_delivery_status IN ('0','1')"
 expect(result.where).toContain(predicate)
 expect(result.dispatchCandidateWhere).toContain(predicate)
 expect(result.params).toContainEqual(['employee'])
 expect(()=>buildLocalOrderQuery([],query)).not.toThrow()
})

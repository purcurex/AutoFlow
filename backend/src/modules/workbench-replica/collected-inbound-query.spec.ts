import {collectedInboundQuery} from './collected-inbound-query'
it('requires stable entry relations and positive unfinished evidence, not SKU guesses',()=>{
 const q=collectedInboundQuery('batch',['employee'],{search:'SKU_1'})
 expect(q.cte).toContain("p.purchase_line_id=l->>'purchaseLineId'")
 expect(q.cte).toContain("n.order_line_id=line->>'id'")
 expect(q.cte).toContain("HAVING bool_or(state IN ('0','1','2','4'))")
 expect(q.from).toContain('o.owner_employee_id=ANY($2::text[])')
 expect(q.params).toEqual(['batch',['employee'],'%sku\\_1%'])
})

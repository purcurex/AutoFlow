import {collectedInboundQuery} from './collected-inbound-query'
it('uses native order/entry facts and keeps owner, status and keyword filters bound',()=>{
 const q=collectedInboundQuery('batch',['employee'],{search:'SKU_1',status:'partial'})
 expect(q.cte).toContain("line->>'hzkj_entrypurc_status' IN ('3','4')")
 expect(q.cte).not.toContain("o.raw->>'hzkj_purchase_status'")
 expect(q.cte).toContain("line->>'hzkj_purcqty'")
 expect(q.cte).toContain('o.owner_employee_id=ANY($2::text[])')
 expect(q.cte).not.toContain('JOIN purchase_lines')
 expect(q.params).toEqual(['batch',['employee'],'%sku\\_1%','partial'])
 expect(q.unclassifiedParams).toEqual(q.params.slice(0,-1))
})

import { collectedRmaWhere } from './collected-rma-query'
it('applies verified ownership and association before any count, filtering or pagination',()=>{
 const q=collectedRmaWhere('batch',['55'],{rmaType:'refund',rmaFlowStatus:'active',search:'RMA_%',warehouseCode:'HZ'})
 expect(q.where).toContain('owner_employee_id = ANY($2::text[])');expect(q.where).toContain("display->'rmaAssociation'->>'state'='verified'");expect(q.where).toContain("display->'rmaCases'->0->>'isOpen'='true'");expect(q.params).toEqual(['batch',['55'],'refund',['HZ','01'],'%rma\\_\\%%'])
})
it('shows unknown cases only in all-state results and preserves explicit selected case identities',()=>{
 const q=collectedRmaWhere('batch',null,{rmaFlowStatus:'all',mode:'selected',caseIds:['11']})
 expect(q.where).not.toContain("isOpen'=");expect(q.where).toContain('source_id=ANY');expect(q.params).toEqual(['batch',['11']])
})

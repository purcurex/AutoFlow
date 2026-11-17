import { persistApprovalReadback } from './fop-approval-readback'
const source = { id:'1001',billno:'TO1',billstatus:'C',hzkj_org:{id:'100000'},hzkj_operator:{id:'88'},hzkj_orderstatus:'3',hzkj_receipt_status:'1',hzkj_delivery_status:'0',auditdate:'2026-11-17T03:00:00Z' }
const proof:any={tenantId:'hyperzone.test',companyId:'100000',orderId:'1001',entity:'hzkj_orders',documentId:'1001',capturedAt:'2026-11-17T03:00:01Z',page:{items:[source],facts:{allocations:[],dispatches:[]}}}
it('only merges source-confirmed state, preserving existing business fields',async()=>{
 const query=jest.fn().mockResolvedValueOnce([{batch_id:'batch',owner_employee_id:'88',raw:{billno:'TO1'},display:{amount:20}}]).mockResolvedValue([])
 const db:any={transaction:async(fn:any)=>fn({query})}
 expect(await persistApprovalReadback(db,proof)).toBe(true)
 const update=query.mock.calls.find(c=>c[0].includes('UPDATE hz_fop_collected_orders'))!
 expect(update[0]).toContain('raw=raw||');expect(update[0]).toContain('display=display||')
 expect(JSON.parse(update[1][2])).toEqual(expect.objectContaining({billstatus:'C',hzkj_orderstatus:'3'}))
 expect(JSON.parse(update[1][3])).not.toHaveProperty('amount')
})
it.each([{documentId:'other'},{orderId:'other'},{companyId:'other'},{page:{items:[{...source,billstatus:'B'}]}}])('does not persist an unconfirmed proof %j',async change=>{
 const db:any={transaction:jest.fn()};await expect(persistApprovalReadback(db,{...proof,...change})).rejects.toThrow();expect(db.transaction).not.toHaveBeenCalled()
})
it('unlinks only superseded allocations for this parent, preserving raw history and newer facts',async()=>{
 const query=jest.fn().mockResolvedValueOnce([{batch_id:'batch',owner_employee_id:'88',raw:{billno:'TO1'},display:{}}]).mockResolvedValue([])
 const db:any={transaction:async(fn:any)=>fn({query})}
 const allocation={id:'2001',billno:'AO1',billstatus:'C',organizationId:'100000',hzkj_order_id:'1001',hzkj_order_no:'TO1',hzkj_alloc_status:'completed'}
 await persistApprovalReadback(db,{...proof,entity:'hzkj_alloc_bill',documentId:'2001',page:{items:[source],facts:{allocations:[allocation],dispatches:[]}}})
 const unlink=query.mock.calls.find(c=>c[0].includes("'superseded_by_readback'"))!
 expect(unlink).toBeDefined()
 expect(unlink[0]).toContain("entity_type='allocation'")
 expect(unlink[0]).toContain("display->>'sourceOrderId'=$2")
 expect(unlink[0]).toContain('captured_at<=$4')
 expect(unlink[0]).not.toContain('raw=')
 expect(unlink[1]).toEqual(['batch','1001',['2001'],proof.capturedAt])
})

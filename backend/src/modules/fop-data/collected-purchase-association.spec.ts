import { projectPurchaseOrderRows } from './collected-purchase-association'
const parent={id:'1',billno:'TO1',hzkj_operator:{id:'owner'},hzkj_orders_billentry:[]}
it('trusts the company-scoped fulfillment number despite stale optional IDs and absent line IDs',()=>{
 const result=projectPurchaseOrderRows({hzkj_billentry:[{hzkj_salbillnumber:' TO1 ',hzkj_salbillid:'stale',hzkj_salbillentryid:'stale-line',hzkj_qty:'2'}]},n=>n==='TO1'?parent:null)
 expect(result.unresolved).toBe(0)
 expect(result.rows[0]).toMatchObject({orderId:'1',orderNumber:'TO1',associationState:'verified',ownerEmployeeId:'owner',lines:[{fulfillmentLineId:null,quantity:2}]})
})
it('does not guess a parent for missing or ambiguous fulfillment numbers',()=>{
 expect(projectPurchaseOrderRows({hzkj_billentry:[{id:'p1',hzkj_salbillnumber:'TO1'}]},()=>null).rows[0].associationState).toBe('unresolved')
 expect(projectPurchaseOrderRows({hzkj_billentry:[{id:'p1',hzkj_salbillnumber:null,hzkj_srcbillnumber:'TO1'}]},()=>parent).rows[0].associationState).toBe('verified')
})

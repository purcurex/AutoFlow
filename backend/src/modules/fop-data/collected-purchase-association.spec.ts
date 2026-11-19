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
import { purchaseGroupFacts } from './collected-purchase-association'
it('projects only the purchase logistics seller and phone for list, search and export',()=>{
 const facts=purchaseGroupFacts({id:'p1',billno:'CG1',hzkj_supplier:{id:'invalid',name:'无效名称'},hzkj_ww_login_id:'无效账号',hzkj_sellers_ww:'物流卖家',hzkj_sellers_phone:'0579-12345678'},[],0)
 expect(facts.purchase.supplier).toMatchObject({name:'物流卖家',wangwangAccount:'物流卖家',phone:'0579-12345678',source:'purchase_logistics'})
 expect(purchaseGroupFacts({id:'p1',hzkj_supplier:{name:'无效名称'},hzkj_ww_login_id:'无效账号'},[],0).purchase.supplier.name).toBeNull()
})

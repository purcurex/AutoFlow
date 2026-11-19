import { NativeSupplierContacts } from './native-supplier-contact'
const purchase = {id:'21',billno:'CG21',hzkj_1688_order_n:'5127372039298022434',hzkj_sellers_ww:'正确卖家',hzkj_supplier:{name:'这是客户'},hzkj_billentry:[{id:'211',hzkj_salbillnumber:'TO1'}]}
function reader(overrides:Record<string,any>={}) { return async(kind:string,body:any)=>{
 const key=kind+':'+(body.data.id||body.data.billno)
 const rows=overrides[key]??({ 'purchase:21':[purchase], 'inbound:31':[{id:'31',billno:'IN31',billentry:[{id:'311',srcbillnumber:'RN41',hzkj_salbillnumber:'TO1'},{id:'312',srcbillnumber:'WRONG',hzkj_salbillnumber:'TO2'}]}], 'receipt:RN41':[{id:'41',billno:'RN41',hzkj_purchase_order_numbe:'CG21',hzkj_1688_order_n:'5127372039298022434'}], 'purchase:CG21':[purchase] } as any)[key]
 if(!rows) throw Error('Unexpected request '+key)
 return {pageNo:1,pageSize:10,totalCount:rows.length,lastPage:true,filter:kind==='receipt'?"[org.number = 'hyperzone.test']":"[org in (100000) AND org.number = 'hyperzone.test']",rows:kind==='receipt'?rows.map((r:any)=>({...r,org_id:'100000',org_number:'hyperzone.test'})):rows}
} }
const client=(overrides={})=>new NativeSupplierContacts(reader(overrides),'100000','hyperzone.test')
it('uses the purchase seller account, preserving long 1688 order numbers',async()=>{
 const c=await client().purchase({id:'21',number:'CG21',platformOrderNumber:'5127372039298022434'},'TO1')
 expect(c.supplier.wangwangAccount).toBe('正确卖家');expect(c.supplier.name).not.toBe('这是客户');expect(c.platformOrderNumber).toBe('5127372039298022434');expect(c.availability).toBe('ready')
})
it('resolves the exact returned inbound entry, never the first related purchase',async()=>{
 const result=await client().returned({id:'R1',number:'RT1',supplier:{name:'退货供应商'},lines:[{sourceDocumentId:'31',sourceDocumentNumber:'IN31',sourceEntryId:'311',orderNumber:'TO1'}]},'TO1')
 expect(result).toHaveLength(1);expect(result[0].purchaseOrderId).toBe('21');expect(result[0].supplier.wangwangAccount).toBe('正确卖家')
})
it('rejects a return source line belonging to another fulfillment order',async()=>{
 await expect(client().returned({lines:[{sourceDocumentId:'31',sourceDocumentNumber:'IN31',sourceEntryId:'312',orderNumber:'TO1'}]},'TO1')).rejects.toThrow()
})
it('rejects replaced 1688 orders and ambiguous purchase identities',async()=>{
 await expect(client().purchase({id:'21',number:'CG21',platformOrderNumber:'999'},'TO1')).rejects.toThrow()
 await expect(client({'purchase:21':[purchase,{...purchase,id:'22'}]}).purchase({id:'21',number:'CG21'},'TO1')).rejects.toThrow()
})
it('does not turn missing seller accounts into customer contacts',async()=>{
 const c=await client({'purchase:21':[{...purchase,hzkj_sellers_ww:''}]}).purchase({id:'21',number:'CG21'},'TO1')
 expect(c.availability).toBe('missing_account');expect(c.supplier.wangwangAccount).toBeNull();expect(c.url).toBeNull()
})
it('rejects facts outside the requested company',async()=>{
 const c=new NativeSupplierContacts(async()=>({pageNo:1,pageSize:10,totalCount:1,lastPage:true,filter:'org in (200000)',rows:[purchase]}),'100000','hyperzone.test')
 await expect(c.purchase({id:'21',number:'CG21'},'TO1')).rejects.toThrow()
})
it('versions change when the seller changes and malformed accounts cannot launch',async()=>{
 const a=await client().purchase({id:'21',number:'CG21'},'TO1'),b=await client({'purchase:21':[{...purchase,hzkj_sellers_ww:'另一卖家'}]}).purchase({id:'21',number:'CG21'},'TO1')
 expect(a.contactVersion).not.toBe(b.contactVersion)
 const c=await client({'purchase:21':[{...purchase,hzkj_sellers_ww:'seller\nsecret'}]}).purchase({id:'21',number:'CG21'},'TO1');expect(c.url).toBeNull()
})
it('revalidates the specific stock SKU before returning or launching its seller',async()=>{
 const parent={id:'s1',billno:'IO1',hzkj_orders_billentry:[{id:'sl1',seq:1,hzkj_local_sku_id:'sku1'},{id:'sl2',seq:2,hzkj_local_sku_id:'sku2'}]}
 const stockPurchase={...purchase,hzkj_billentry:[{id:'pl1',hzkj_salbillnumber:'IO1',hzkj_salbillentryid:'sl1'}]}
 const refs=[{sourceType:'deposit' as const,parent,skuId:'sku1',sku:'SKU1'}]
 const c=await client({'purchase:21':[stockPurchase]}).purchaseSources({id:'21',number:'CG21'},refs)
 expect(c.supplier.wangwangAccount).toBe('正确卖家');expect(c.sourceReferences).toEqual([{sourceType:'deposit',orderNumber:'IO1',sku:'SKU1'}])
 await expect(client({'purchase:21':[{...stockPurchase,hzkj_billentry:[{...stockPurchase.hzkj_billentry[0],hzkj_salbillentryid:'sl2'}]}]}).purchaseSources({id:'21',number:'CG21'},refs)).rejects.toThrow('relationship changed')
 await expect(client({'purchase:21':[{...stockPurchase,hzkj_cancelstatus:'B'}]}).purchaseSources({id:'21',number:'CG21'},refs)).rejects.toThrow('cancelled')
})
it('uses only logistics-tab seller fields even when supplier-tab values disagree',async()=>{
 const native={...purchase,hzkj_ww_login_id:'无效旧账号',hzkj_sellers_phone:' 0579-12345678 ',hzkj_supplier:{id:'wrong',name:'无效供应商',phone:'wrong'}}
 const c=await client({'purchase:21':[native]}).purchase({id:'21',number:'CG21'},'TO1')
 expect(c.supplier).toMatchObject({name:'正确卖家',wangwangAccount:'正确卖家',phone:'0579-12345678',source:'purchase_logistics'})
 const empty=await client({'purchase:21':[{...native,hzkj_sellers_ww:'',hzkj_sellers_phone:''}]}).purchase({id:'21'},'TO1')
 expect(empty.supplier.wangwangAccount).toBeNull();expect(empty.supplier.phone).toBeNull();expect(empty.availability).toBe('missing_account')
})
it('return contacts use the purchase logistics seller instead of the return supplier label',async()=>{
 const result=await client({'purchase:CG21':[{...purchase,hzkj_sellers_phone:'0579-12345678'}]}).returned({supplier:{name:'无效旧供应商'},lines:[{sourceDocumentId:'31',sourceDocumentNumber:'IN31',sourceEntryId:'311',orderNumber:'TO1'}]},'TO1')
 expect(result[0].supplier).toMatchObject({name:'正确卖家',phone:'0579-12345678'})
})
it('invalidates contact versions when the logistics phone changes',async()=>{
 const a=await client({'purchase:21':[{...purchase,hzkj_sellers_phone:'0579-11111111'}]}).purchase({id:'21'},'TO1')
 const b=await client({'purchase:21':[{...purchase,hzkj_sellers_phone:'0579-22222222'}]}).purchase({id:'21'},'TO1')
 expect(a.contactVersion).not.toBe(b.contactVersion)
})

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

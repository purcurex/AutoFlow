import { ConfigService } from '@nestjs/config'
import { CollectedWorkbenchService } from './collected-workbench.service'
function setup(){
 const db={query:jest.fn().mockResolvedValue([])},s=new CollectedWorkbenchService(db as any,{} as any,new ConfigService({FOP_MANUAL_SUPPLIER_CONTACT_ENABLED:'true',FOP_KINGDEE_SUPPLIER_ORG_NUMBER:'hyperzone.test'}))
 const context={signature:'v1',batch:{id:'b',company_id:'100000'},filter:{employeeIds:['e']}}
 const auth=jest.spyOn(s as any,'context').mockResolvedValue(context)
 const read=jest.fn(async(_kind:any,body:any)=>({pageNo:1,pageSize:10,totalCount:1,lastPage:true,filter:"[org in (100000) AND org.number = 'hyperzone.test']",rows:[{id:'21',billno:'CG21',hzkj_1688_order_n:'5127372039298022434',hzkj_sellers_ww:'Seller',hzkj_billentry:[{id:'l',hzkj_salbillnumber:'TO1'}]}]}));(s as any).nativeSupplier={queryManualSupplierSource:read}
 return {s,db,read,auth,context}
}
const query={context:'fulfillment' as const,orderId:'o1',queue:'procurement_shipping' as const}
const order={source_id:'o1',display:{orderNumber:'TO1'}},group={display:{purchase:{id:'21',number:'CG21',platformOrderNumber:'5127372039298022434'},stage:'supplier_pending'}}
it('rejects an unavailable local order before any remote lookup',async()=>{
 const {s,db,read}=setup();await expect(s.supplierContacts('user',query)).rejects.toThrow('current queue');expect(read).not.toHaveBeenCalled();expect(db.query.mock.calls[0][1]).toContainEqual(['e'])
})
it('does not use a return from another order',async()=>{
 const {s,db,read}=setup();db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([{display:{lines:[{orderNumber:'FOREIGN'}]}}]);await expect(s.supplierContacts('u',{context:'purchase_return',orderId:'o1',returnId:'r1',workbenchRole:'procurement'})).rejects.toThrow('does not belong');expect(read).not.toHaveBeenCalled()
})
it('returns a verified contact without a launch URL and rechecks permission',async()=>{
 const {s,db,auth,context}=setup();db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);const r=await s.supplierContacts('u',query);expect(r.items[0]).toMatchObject({purchaseOrderId:'21',availability:'ready'});expect(r.items[0].url).toBeUndefined()
 auth.mockResolvedValueOnce(context).mockResolvedValueOnce({...context,signature:'revoked'});db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);await expect(s.supplierContacts('u',query)).rejects.toThrow('权限')
})
it('requires the current supplier version before launching',async()=>{
 const {s,db}=setup();db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);const r=await s.supplierContacts('u',query)
 db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);await expect(s.supplierContacts('u',query,{contactVersion:'0'.repeat(64),purchaseOrderId:'21'})).rejects.toThrow('变化')
 db.query.mockResolvedValueOnce([order]).mockResolvedValueOnce([group]);const launched=await s.supplierContacts('u',query,{contactVersion:r.items[0].contactVersion,purchaseOrderId:'21'});expect(launched.url).toBe('aliim:sendmsg?touid=cnalichnSeller')
})
it.each(['1','2'])('resolves stock type %s through its own downstream purchase and validates that parent on launch',async stockType=>{
 const {s,db,read}=setup()
 const record={stockId:'s1',stockNumber:'IO1',stockType,stockPurchaseStatus:'2',orderNumber:'TO1',skuId:'sku1',recordId:'r1',quantity:'1',status:'1'}
 const source={complete:true,skuId:'sku1',sku:'SKU1',fullPaymentQuantity:stockType==='1'?'1':'0',depositQuantity:stockType==='2'?'1':'0',directQuantity:'0',records:[record]}
 const raw={id:'o1',billno:'TO1',org_id:'100000',hzkj_orders_billentry:[{id:'ol1',seq:1,hzkj_local_sku_id:'sku1'}]}
 const stock={id:'s1',billno:'IO1',org_id:'100000',hzkj_stock_type:stockType,hzkj_orders_billentry:[{id:'sl1',seq:1,hzkj_local_sku_id:'sku1'}]}
 const purchase={id:'21',billno:'CG21',hzkj_cancelstatus:'A',hzkj_pay_status:'1',hzkj_1688_order_n:'5127372039298022434',hzkj_sellers_ww:'StockSeller',hzkj_billentry:[{id:'pl1',hzkj_salbillnumber:'IO1',hzkj_salbillentryid:'sl1',hzkj_salbillentryseq:'1'}]}
 db.query.mockImplementation(async sql=>sql.includes('FROM hz_fop_collected_orders')?[{...order,raw,display:{...order.display,id:'o1',items:[{procurementSource:source}]}}]:sql.includes('analytics_facts')?[{raw:stock}]:sql.includes('hzkj_salbillnumber')?[{raw:purchase}]:[])
 read.mockImplementation(async(_kind,body)=>{expect(body.data).toMatchObject({id:'21',billno:'CG21'});return {pageNo:1,pageSize:10,totalCount:1,lastPage:true,filter:"[org in (100000) AND org.number = 'hyperzone.test']",rows:[purchase]}})
 const r=await s.supplierContacts('u',query)
 expect(r.items).toHaveLength(1);expect(r.items[0].supplier.wangwangAccount).toBe('StockSeller');expect(r.items[0].sourceReferences).toEqual([{sourceType:stockType==='1'?'full_payment':'deposit',orderNumber:'IO1',sku:'SKU1'}]);expect(r.items[0].url).toBeUndefined()
 const launched=await s.supplierContacts('u',query,{contactVersion:r.items[0].contactVersion,purchaseOrderId:'21'})
 expect(launched.url).toBe('aliim:sendmsg?touid=cnalichnStockSeller')
 purchase.hzkj_billentry[0].hzkj_salbillnumber='IO-OTHER'
 await expect(s.supplierContacts('u',query,{contactVersion:r.items[0].contactVersion,purchaseOrderId:'21'})).rejects.toThrow()
})
it('deduplicates a merged full/deposit/direct purchase, binds launch to the root and current consumption',async()=>{
 const {s,db,read}=setup()
 const raw={id:'o1',billno:'TO1',hzkj_orders_billentry:[{id:'ol1',seq:1,hzkj_local_sku_id:'sku1'}]}
 const stocks=['1','2'].map(type=>({id:'s'+type,billno:'IO'+type,org_id:'100000',hzkj_stock_type:type,hzkj_orders_billentry:[{id:'sl'+type,seq:1,hzkj_local_sku_id:'sku1'}]}))
 const records=stocks.map(p=>({stockId:p.id,stockNumber:p.billno,stockType:p.hzkj_stock_type,stockPurchaseStatus:'2',orderNumber:'TO1',skuId:'sku1',recordId:'r'+p.id,quantity:'1',status:'1'}))
 const source={complete:true,skuId:'sku1',sku:'SKU1',fullPaymentQuantity:'1',depositQuantity:'1',directQuantity:'1',records}
 const purchase={id:'21',billno:'CG21',hzkj_cancelstatus:'A',hzkj_1688_order_n:'5127372039298022434',hzkj_sellers_ww:'MergedSeller',hzkj_billentry:[{id:'pl0',hzkj_salbillnumber:'TO1',hzkj_salbillentryid:'ol1'},...stocks.map(p=>({id:'pl'+p.id,hzkj_salbillnumber:p.billno,hzkj_salbillentryid:p.hzkj_orders_billentry[0].id}))]}
 db.query.mockImplementation(async sql=>sql.includes('FROM hz_fop_collected_orders')?[{...order,raw,display:{...order.display,id:'o1',items:[{procurementSource:source}]}}]:sql.includes('analytics_facts')?stocks.map(raw=>({raw})):sql.includes('hzkj_salbillnumber')?[{raw:purchase}]:[{...group,raw:purchase}])
 read.mockResolvedValue({pageNo:1,pageSize:10,totalCount:1,lastPage:true,filter:"[org in (100000) AND org.number = 'hyperzone.test']",rows:[purchase]})
 const r=await s.supplierContacts('u',query)
 expect(read).toHaveBeenCalledTimes(1);expect(r.items).toHaveLength(1);expect(r.items[0].sourceReferences).toHaveLength(3)
 expect(JSON.stringify(r)).not.toContain('hzkj_billentry')
 records[0].quantity='2'
 await expect(s.supplierContacts('u',query,{contactVersion:r.items[0].contactVersion,purchaseOrderId:'21'})).rejects.toThrow('变化')
})

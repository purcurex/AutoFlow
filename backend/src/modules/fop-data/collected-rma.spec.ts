import { normalizeCollectedRma, validateCollectedRmaPages } from './collected-rma'
const raw={id:'11',number:'RMA1',hzkj_srcnumber:'TO1',hzkj_shop_id:'22',hzkj_sales_type:'B',hzkj_orderstatus:'3',hzkj_refund_amount:0,createtime:'2026-08-08 14:49:28'}
const parent:any={source_id:'33',company_id:'100000',order_number:'TO1',shop_id:'22',payer_customer_id:'44',source_businessowner_id:'55',owner_employee_id:'55',display:{id:'33',orderNumber:'TO1',items:[],owner:{id:'55',name:'Sales'},currency:null}}
it('inherits only a unique same-company and payer verified parent; missing refund currency defaults to the confirmed USD rule',()=>{
 const n=normalizeCollectedRma(raw,{companyId:'100000',payerCustomerId:'44',parents:[parent]})
 expect(n.ownerEmployeeId).toBe('55');expect(n.display).toMatchObject({id:'11',sourceOrderId:'33',rmaCases:[{type:'refund',isOpen:false,refundAmount:0,refundCurrency:'USD',currency:null,createdAt:'2026-08-08T06:49:28.000Z'}]});expect(n.association.state).toBe('verified')
})
it.each([['unmatched',[]],['ambiguous',[parent,parent]],['payer_mismatch',[{...parent,payer_customer_id:'45'}]],['owner_unverified',[{...parent,source_businessowner_id:null}]]])('retains %s for admin diagnostics without assigning an owner',(state,parents)=>{
 const n=normalizeCollectedRma(raw,{companyId:'100000',payerCustomerId:'44',parents:parents as any});expect(n.ownerEmployeeId).toBeNull();expect(n.association.state).toBe(state);expect(n.display.rmaCases).toHaveLength(1)
})
it('preserves future native types and states as unknown rather than pending or throwing away cases',()=>{
 const n=normalizeCollectedRma({...raw,hzkj_sales_type:'Z',hzkj_orderstatus:'9'},{companyId:'100000',payerCustomerId:'44',parents:[parent]});expect(n.display.rmaCases[0]).toMatchObject({type:'unknown',isOpen:null,rawType:'Z',rawStatus:'9',stage:'状态未提供'})
})
it('rejects mixed company parent authority',()=>{expect(normalizeCollectedRma(raw,{companyId:'100000',payerCustomerId:'44',parents:[{...parent,company_id:'other'}]}).association.state).toBe('unmatched')})
it('validates full pagination per captured payer while allowing explicit partial customer coverage',()=>{
 expect(validateCollectedRmaPages([{payerCustomerId:'44',pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[raw]}])).toHaveLength(1)
 expect(()=>validateCollectedRmaPages([{payerCustomerId:'44',pageNo:1,pageSize:100,totalCount:101,lastPage:true,rows:[raw]}])).toThrow()
 expect(()=>validateCollectedRmaPages([{payerCustomerId:'44',pageNo:2,pageSize:100,totalCount:1,lastPage:true,rows:[raw]}])).toThrow()
})
import { collectedRmaParents } from './collected-rma'
it('accepts flattened source detail only for exact persisted source identity, businessowner and shop',()=>{
 const local={source_id:'33',order_number:'TO1',owner_employee_id:'55',raw:{id:'33',billno:'TO1',hzkj_org:{id:'100000'},hzkj_shop:{id:'22'},hzkj_operator:{id:'55'}},display:parent.display}
 const detail={id:'33',billno:'TO1',hzkj_shop_id:'22',hzkj_operator_id:'55',hzkj_payingcustomer_id:'44'}
 expect(collectedRmaParents([local],[detail],'100000')[0]).toMatchObject({payer_customer_id:'44',source_businessowner_id:'55'})
 expect(collectedRmaParents([local],[{...detail,hzkj_operator_id:'66'}],'100000')[0].source_businessowner_id).toBeNull()
 expect(collectedRmaParents([local],[{...detail,billno:'TO2'}],'100000')[0].payer_customer_id).toBeNull()
})
it('quarantines unknown-company and payer-mismatch rows; a verified company parent with missing owner stays an admin exception',()=>{
 expect(normalizeCollectedRma(raw,{companyId:'100000',payerCustomerId:'44',parents:[]}).association.companyVerified).toBe(false)
 expect(normalizeCollectedRma(raw,{companyId:'100000',payerCustomerId:'44',parents:[{...parent,payer_customer_id:'other'}]}).association.companyVerified).toBe(false)
 expect(normalizeCollectedRma(raw,{companyId:'100000',payerCustomerId:'44',parents:[{...parent,source_businessowner_id:null}]}).association.companyVerified).toBe(true)
})
import { validateCollectedRmaCapture } from './collected-rma'
it('accepts source identity configuration from FOP env while enforcing persistent pause from workbench env',()=>{
 const fop={FOP_REPLICA_TENANT_ID:'hyperzone.test',FOP_REPLICA_COMPANY_ID:'100000',FOP_KINGDEE_USER_ID:'77'},workbench={FOP_QUERIES_PAUSED:'true',WORKBENCH_AUTOMATIC_CALLS_ENABLED:'false',WORKBENCH_SYNC_ENABLED:'false',DB_DATABASE:'autoflow_local_demo'}
 const subject={tenantId:'hyperzone.test',userId:'77'},capture={context:subject,companyId:'100000',capturedAt:'2026-11-12T00:00:00Z',operation:'queryRma',coverage:'partial_customer_scan',complete:true,rowCount:1,sourceScope:{entityCode:'hzkj_after_sale_orders',sourceOrderEntityCode:'hzkj_orders',subject,organizationIds:['100000']},sourceOrders:[],pages:[{payerCustomerId:'44',pageNo:1,pageSize:100,totalCount:1,lastPage:true,rows:[raw]}]}
 expect(validateCollectedRmaCapture(capture,fop,workbench)).toHaveLength(1)
 expect(()=>validateCollectedRmaCapture(capture,fop,{...workbench,FOP_QUERIES_PAUSED:'false'})).toThrow('persistent_real_pause_required')
 expect(()=>validateCollectedRmaCapture({...capture,companyId:'other'},fop,workbench)).toThrow('invalid_rma_capture_scope')
})
it.each([['88.12',88.12],[0,0],[null,null],['invalid',null]])('uses RMA native amount %s without inheriting parent money',(value,expected)=>{
 const n=normalizeCollectedRma({...raw,hzkj_order_amount:value},{companyId:'100000',payerCustomerId:'44',parents:[{...parent,display:{...parent.display,amount:999,amountBreakdown:{productAmount:888}}}]})
 expect(n.display.amount).toBe(expected);expect(n.display.currency).toBe('USD');expect(n.display.amountBreakdown).toBeUndefined();expect(n.display.rmaCases[0].refundAmount).toBe(0)
})
it('uses this RMA SKU and quantity instead of the original fulfillment products',()=>{
 const n=normalizeCollectedRma({...raw,hzkj_order_amount:12,hzkj_after_entryentity:[{id:'101',hzkj_localsku_id:'201',hzkj_localsku_number:'RETURN-SKU',hzkj_localsku_name:'售后商品',hzkj_localsku_hzkj_sku_value:'绿色',hzkj_localsku_hzkj_picturefield:'https://example.com/product.png',hzkj_qty:1}]},{companyId:'100000',payerCustomerId:'44',parents:[{...parent,display:{...parent.display,items:[{sku:'ORIGINAL',quantity:3}],dataQuality:{missingFields:['amount']}}}]})
 expect(n.display.items).toEqual([expect.objectContaining({id:'101',productId:'201',sku:'RETURN-SKU',name:'售后商品',variant:'绿色',quantity:1,imageUrl:'https://example.com/product.png'})])
 expect(n.display.dataQuality.missingFields).not.toContain('amount')
 expect(n.display.dataQuality.missingFields).not.toContain('rma.refundCurrency')
})
it.each([undefined,null,[]])('never falls back to parent items when RMA detail is %s',details=>{
 const n=normalizeCollectedRma({...raw,hzkj_after_entryentity:details},{companyId:'100000',payerCustomerId:'44',parents:[{...parent,display:{...parent.display,items:[{sku:'PARENT',quantity:9}]}}]})
 expect(n.display.items).toEqual([])
 if(!Array.isArray(details))expect(n.display.dataQuality.missingFields).toContain('items')
})
it('retains an unknown RMA quantity as missing and does not invent refund currency for reshipment',()=>{
 const n=normalizeCollectedRma({...raw,hzkj_sales_type:'C',hzkj_after_entryentity:[{id:'101',hzkj_localsku_number:'SKU',hzkj_qty:null}]},{companyId:'100000',payerCustomerId:'44',parents:[parent]})
 expect(n.display.items[0].quantity).toBeNull()
 expect(n.display.dataQuality.missingFields).toContain('items.quantity')
 expect(n.display.dataQuality.missingFields).not.toContain('rma.refundCurrency')
})

import { withCollectedRmaDetails } from './collected-rma'
it.each([[undefined,'USD'],[null,'USD'],['','USD'],['  ','USD'],['EUR','EUR'],[' cny ','CNY'],['bad-currency',null]])('reprojects captured refund currency %s consistently for list and export', (currency,expected)=>{
 const d=withCollectedRmaDetails({id:'11',rmaCases:[{id:'11',type:'refund',refundAmount:5,refundCurrency:null}],refundAmounts:[{amount:5,currency:null}],dataQuality:{missingFields:['rma.refundCurrency']}},{...raw,hzkj_tocurr_number:currency})
 expect(d.rmaCases[0].refundCurrency).toBe(expected)
 expect(d.refundAmounts).toEqual([{amount:5,currency:expected}])
 expect(d.dataQuality.missingFields.includes('rma.refundCurrency')).toBe(expected===null)
})

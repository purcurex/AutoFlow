import { projectCollectedStockNative } from './collected-stock-native'
const fact:any={entity_type:'stock',company_id:'100000',source_id:'1',document_number:'S1',owner_employee_id:'7',captured_at:'2026-11-15T00:00:00Z',paid_at:null,created_at:null,raw:{id:'1',org_id:'100000',billno:'S1',hzkj_orderstatus:'0',billstatus:'A',hzkj_orders_billentry:[]},facts:{sourceOwner:{id:'7',name:'A'},customer:{id:'8',name:'C'},lines:[],statuses:{},dates:{},amounts:{}}}
it('projects cancelled native orders with independent unapproved status and keeps unknown facts empty',()=>{
 const r=projectCollectedStockNative(fact,'hyperzone.test','100000')!
 expect(r).toMatchObject({id:'1',orderStatus:'cancelled',reviewStatus:'pending',rawOrderStatus:'0',rawBillStatus:'A',currency:'USD',owner:{id:'7'}})
})
it('preserves existing supplementary display while updating independent native facts',()=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_orderstatus:'2',billstatus:'C'}},'hyperzone.test','100000',{source_id:'1',captured_at:'2026-11-14T00:00:00Z',display:{stockNumber:'S1',currency:'USD',amount:12,items:[]}})!
 expect(r).toMatchObject({orderStatus:'paid',reviewStatus:'approved',currency:'USD'})
})
it('rejects cross-company/identity conflicts and refuses stale projections',()=>{
 expect(()=>projectCollectedStockNative({...fact,company_id:'other'},'hyperzone.test','100000')).toThrow()
 expect(()=>projectCollectedStockNative(fact,'hyperzone.test','100000',{source_id:'9',display:{stockNumber:'S1'}})).toThrow()
 expect(projectCollectedStockNative(fact,'hyperzone.test','100000',{source_id:'1',captured_at:'2026-11-16T00:00:00Z',display:{stockNumber:'S1'}})).toBeNull()
})

it('repeated projection preserves exact facts and missing-field markers',()=>{
 const first=projectCollectedStockNative(fact,'hyperzone.test','100000')!
 const second=projectCollectedStockNative(fact,'hyperzone.test','100000',{source_id:'1',display:first,captured_at:fact.captured_at})
 expect(second).toEqual(first);expect(first.dataQuality.missingFields).not.toContain('cancelled')
})

it('uses the stock native order amount and its USD default, never the old base currency or another amount',()=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_order_amount:'12.34',hzkj_curtotalamount:'80.21',hzkj_currency_number:'CNY'},facts:{...fact.facts,amounts:{orderAmount:'999'}}},'hyperzone.test','100000',{source_id:'1',captured_at:'2026-11-14T00:00:00Z',display:{stockNumber:'S1',amount:80.21,currency:'CNY',items:[]}})!
 expect(r).toMatchObject({amount:12.34,currency:'USD',amountBasis:'hzkj_order_amount',currencyBasis:'stock_metadata_default_usd'})
})
it.each([{hzkj_settlecurrency_number:'EUR'},{hzkj_settlecurrency:{number:'EUR',sign:'€'}}])('respects this stock document explicit settlement currency',currency=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_order_amount:'0',...currency}},'hyperzone.test','100000')!
 expect(r).toMatchObject({amount:0,currency:'EUR',currencyBasis:'source_hzkj_settlecurrency'})
})
it('keeps missing amounts and invalid explicit currency unknown instead of fabricating or converting them',()=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_order_amount:null,hzkj_settlecurrency_number:'invalid'}},'hyperzone.test','100000')!
 expect(r.amount).toBeNull();expect(r.currency).toBeNull()
})

it.each([
 ['1','采购中','in_progress'],['2','已采购','purchased'],['3','已入库','received'],['4','已发货','shipped'],
 ['9','部分采购','partial'],['1','新增采购阶段','unknown'],
])('preserves native stock purchase %s / %s instead of stale code meanings', (code,title,status)=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_orderstatus:'2',hzkj_orderstatus_title:'已支付',hzkj_purchase_status:code,hzkj_purchase_status_title:title}},'hyperzone.test','100000')!
 expect(r).toMatchObject({rawPurchaseStatus:code,purchaseStatusName:title,purchaseStatus:status,orderStatusName:'已支付',orderStatus:'paid'})
})
it.each([undefined,null,'','  '])('defaults only an empty purchase value %s to unpurchased',value=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_purchase_status:value}},'hyperzone.test','100000')!
 expect(r).toMatchObject({purchaseStatus:'unpurchased',purchaseStatusName:'未采购',rawPurchaseStatus:null})
})
it('uses verified current code meanings when titles are absent, retaining unknown nonempty states',()=>{
 const project=(value:unknown)=>projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_purchase_status:value}},'hyperzone.test','100000')!
 expect(project('1')).toMatchObject({purchaseStatus:'in_progress',purchaseStatusName:'采购中'})
 expect(project('2')).toMatchObject({purchaseStatus:'purchased',purchaseStatusName:'已采购'})
 expect(project('99')).toMatchObject({purchaseStatus:'unknown',purchaseStatusName:null,rawPurchaseStatus:'99'})
})
it('keeps source order state separate from approval and never replaces a provided source title',()=>{
 const r=projectCollectedStockNative({...fact,raw:{...fact.raw,hzkj_orderstatus:'2',hzkj_orderstatus_title:'新订单阶段',billstatus:'C'}},'hyperzone.test','100000')!
 expect(r).toMatchObject({orderStatus:null,orderStatusName:'新订单阶段',rawOrderStatus:'2',reviewStatus:'approved'})
})
it('replaces stock lines from a complete current capture rather than preserving stale quantities',()=>{
 const raw={...fact.raw,hzkj_orders_billentry:[{id:'line1',hzkj_qty:'3',hzkj_local_sku_number:'SKU1'}]}
 const r=projectCollectedStockNative({...fact,raw},'hyperzone.test','100000',{source_id:'1',captured_at:'2026-11-14T00:00:00Z',display:{stockNumber:'S1',items:[{sku:'SKU1',name:'中文配货名',quantity:8},{sku:'REMOVED',name:'旧商品',quantity:1}]}})!
 expect(r.items).toHaveLength(1);expect(r.items[0]).toMatchObject({sku:'SKU1',name:'中文配货名',quantity:3})
})

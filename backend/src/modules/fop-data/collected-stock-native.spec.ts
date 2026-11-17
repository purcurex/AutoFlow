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

import { withPaymentDataQuality } from './payment-data-quality'
const raw={id:'1',hzkj_receipt_status:'1',hzkj_receipt_date:null}
const proof={source:'fop_targeted_query',sourceId:'1',state:'confirmed_empty',checkedAt:'2026-11-17T00:00:00Z'}
it('only classifies a source-confirmed missing paid date as order data exception',()=>{
 expect(withPaymentDataQuality({id:'1',paymentDataCheck:proof},raw).exception).toMatchObject({type:'logistics_exception',reason:'收款日期为空'})
 for(const patch of [{hzkj_receipt_status:'0'},{hzkj_receipt_date:'2026-11-17 08:00:00'}])expect(withPaymentDataQuality({id:'1',paymentDataCheck:proof},{...raw,...patch}).exception).toBeUndefined()
 expect(withPaymentDataQuality({id:'1'},raw).exception).toBeUndefined()
 expect(withPaymentDataQuality({id:'1',paymentDataCheck:{...proof,sourceId:'other'}},raw).exception).toBeUndefined()
 expect(withPaymentDataQuality({id:'1',paymentDataCheck:proof},{id:'1',hzkj_receipt_status:'1'}).exception).toBeUndefined()
})
it('releases only the generated data exception after source recovery and preserves other exceptions',()=>{
 const d={id:'1',paymentDataCheck:proof,exception:{type:'logistics_exception',reason:'收款日期为空',code:'paid_date_missing'}}
 expect(withPaymentDataQuality(d,{...raw,hzkj_receipt_date:'2026-11-17 08:00:00'}).exception).toBeNull()
 expect(withPaymentDataQuality({...d,exception:{type:'dispatch_exception',reason:'同步失败'}},{...raw,hzkj_receipt_status:'0'}).exception.reason).toBe('同步失败')
})
it('does not call a paid stock order received unless its receipt status confirms payment',()=>{
 expect(withPaymentDataQuality({id:'1',paymentDataCheck:proof},{...raw,hzkj_receipt_status:'',hzkj_orderstatus:'2'}).exception).toBeUndefined()
})
import { withOrderBusinessStatus } from './order-business-status'
it('shows the confirmed data exception ahead of a concurrent missing fulfilled tracking number',()=>{
 const value=withOrderBusinessStatus({id:'1',paymentDataCheck:proof},{...raw,billstatus:'C',hzkj_orderstatus:'4',hzkj_logistics_info:[]})
 expect(value.exception).toMatchObject({type:'logistics_exception',reason:'收款日期为空',code:'paid_date_missing'})
})
it('keeps missing-date evidence after a verified timestamp publication replaces the display',()=>{
 const source={...raw,org:{id:'100000'},timestampProjection:{companyBasis:'verified_timestamp_scope',companyId:'100000',entityCode:'hzkj_orders'}}
 expect(withPaymentDataQuality({id:'1'},source).exception?.reason).toBe('收款日期为空')
 expect(withPaymentDataQuality({id:'1'},{...source,hzkj_receipt_date:'2026-11-18 08:00:00'}).exception).toBeUndefined()
 expect(withPaymentDataQuality({id:'1'},{...source,org:{id:'200000'}}).exception).toBeUndefined()
 const omitted={...source};delete (omitted as any).hzkj_receipt_date
 expect(withPaymentDataQuality({id:'1'},omitted).exception).toBeUndefined()
})
it('distinguishes an invalid source receipt date from a source null and clears both generated reasons',()=>{
 const source={...raw,timestampProjection:{companyBasis:'verified_timestamp_scope',companyId:'100000',entityCode:'hzkj_orders',unknownTimes:['hzkj_receipt_date']}}
 const invalid=withPaymentDataQuality({id:'1'},source)
 expect(invalid.exception).toMatchObject({reason:'收款日期格式待核验',code:'paid_date_invalid'})
 expect(withPaymentDataQuality(invalid,{...source,hzkj_receipt_date:'2026-11-18T00:00:00Z',timestampProjection:{...source.timestampProjection,unknownTimes:[]}}).exception).toBeNull()
 expect(withPaymentDataQuality(invalid,{...source,timestampProjection:{...source.timestampProjection,unknownTimes:[]}}).exception).toMatchObject({reason:'收款日期为空',code:'paid_date_missing'})
})

import { normalizeCollectedOrder } from './collected-order-normalizer'
const raw = (patch: Record<string, unknown> = {}) => ({ id:'9007199254740993123', billno:'TO-test', hzkj_org:{id:'100000'}, hzkj_order_amount:'12.30', hzkj_currency:{number:'USD'}, hzkj_orders_billentry:[{id:'9007199254740993124',hzkj_qty:'2',hzkj_local_sku:{number:'SKU',name:'Product'}}],...patch })
describe('collected raw facts',()=>{
 it.each([[5.75,5.75],['5.75',5.75],[0,0],['0',0],[null,null],[undefined,null]])('stores fixed header tax %p without using package tax',(value,expected)=>{
  const source=raw({hzkj_fixed_tax_fee:value,hzkj_logistics_info:[{hzkj_package_tax_fee:'99'}]})
  const n=normalizeCollectedOrder(source,{companyId:'100000'})
  expect(n.display.amountBreakdown.taxAmount).toBe(expected)
  expect(n.raw).toEqual(source)
 })
 it('uses the native text specification before legacy values and preserves the raw source',()=>{
  const source=raw({hzkj_orders_billentry:[{id:'9007199254740993124',hzkj_qty:'2',hzkj_local_sku:{number:'SKU',name:'Product',hzkj_sku_value:'  Blue / Large  ',hzkj_sku_values:[{name:'Old variant'}]}}]})
  const n=normalizeCollectedOrder(source,{companyId:'100000'})
  expect(n.display.items[0].variant).toBe('Blue / Large')
  expect(n.raw).toEqual(source)
  expect(n.raw.hzkj_orders_billentry[0].hzkj_local_sku.hzkj_sku_value).toBe('  Blue / Large  ')
 })
 it.each([undefined,null,'   ',42])('falls back to legacy specification names when the scalar is %p',(scalar)=>{
  const n=normalizeCollectedOrder(raw({hzkj_orders_billentry:[{hzkj_qty:'2',hzkj_local_sku:{hzkj_sku_value:scalar,hzkj_sku_values:[{name:' Blue '},{name:''},null,{name:'Large'}]}}]}),{companyId:'100000'})
  expect(n.display.items[0].variant).toBe('Blue / Large')
 })
 it('keeps absent specifications empty without inventing a variant',()=>{
  const n=normalizeCollectedOrder(raw(),{companyId:'100000'})
  expect(n.display.items[0].variant).toBe('')
 })
 it('preserves bigint IDs and exact product amount without inventing total or settlement currency',()=>{
  const n=normalizeCollectedOrder(raw(),{companyId:'100000'})
  expect(n.source_id).toBe('9007199254740993123');expect(n.product_amount).toBe('12.3');expect(n.total_amount).toBeNull();expect(n.currency_code).toBeNull()
  expect(n.display.amount).toBeNull();expect(n.display.currency).toBeNull();expect(n.total_quantity).toBe('2')
  expect(n.display.fulfillmentProgress).toMatchObject({shopifySync:'unknown',stockReadiness:'unknown',allocationReview:'unknown'})
 })
 it('keeps null quantities and unsupported states unknown',()=>{
  const n=normalizeCollectedOrder(raw({hzkj_receipt_status:'future',billstatus:'future',hzkj_orderstatus:null,hzkj_orders_billentry:[{hzkj_qty:null}]}),{companyId:'100000'})
  expect(n.total_quantity).toBeNull();expect(n.display.items[0].quantity).toBeNull();expect(n.display.paymentStatus).toBe('unknown');expect(n.display.reviewStatus).toBe('unknown');expect(n.display.cancelled).toBeNull()
  expect(n.display.dataQuality.missingFields).toContain('totalQuantity')
 })
 it('does not turn zero or paid/audited status into fulfillment facts',()=>{
  const n=normalizeCollectedOrder(raw({hzkj_order_amount:'0',hzkj_total_amount:'0',hzkj_settlecurrency:{number:'CNY'},billstatus:'C',hzkj_receipt_status:'1',hzkj_delivery_status:'2',hzkj_orderstatus:'4'}),{companyId:'100000'})
  expect(n.display.amount).toBe(0);expect(n.display.paymentStatus).toBe('paid');expect(n.display.reviewStatus).toBe('approved');expect(n.display.fulfillmentProgress.shopifySync).toBe('unknown');expect(n.display.sourceOutboundStatus).toBe('2')
 })
 it('rejects unsafe numeric identifiers, wrong company, and missing primary key',()=>{
  expect(()=>normalizeCollectedOrder(raw({id:9007199254740993000}),{companyId:'100000'})).toThrow()
  expect(()=>normalizeCollectedOrder(raw({hzkj_org:{id:'200000'}}),{companyId:'100000'})).toThrow()
  expect(()=>normalizeCollectedOrder(raw({id:null}),{companyId:'100000'})).toThrow()
 })
 it('preserves exact database decimals beyond JavaScript numeric precision',()=>{
  const n=normalizeCollectedOrder(raw({hzkj_orders_billentry:[{hzkj_qty:'123456789012345678901234567890.12345678901234567890'},{hzkj_qty:'0.00000000000000000001'}]}),{companyId:'100000'})
  expect(n.total_quantity).toBe('123456789012345678901234567890.12345678901234567891');expect(n.display.items[0].quantity).toBeNull()
 })
 it('keeps C-end payment independent from receipt date and rejects timezone-less dates',()=>{
  const n=normalizeCollectedOrder(raw({hzkj_datetimefield:'2026-11-01T12:00:00+08:00',hzkj_receipt_date:null,createtime:'2026-11-01 12:00:00'}),{companyId:'100000'})
  expect(n.consumer_paid_at).toBe('2026-11-01T04:00:00.000Z');expect(n.paid_at).toBeNull();expect(n.created_at).toBeNull();expect(n.display.consumerPaidAt).toBeNull();expect(n.display.sourceOrderPaidAt).toBe(n.consumer_paid_at)
 })
 it('maps receipt date and source-order payment independently when both exist',()=>{
  const n=normalizeCollectedOrder(raw({hzkj_receipt_date:'2026-11-03T12:00:00+08:00',hzkj_datetimefield:'2026-11-01T09:00:00+08:00'}),{companyId:'100000'})
  expect(n.display.paidAt).toBe('2026-11-03T04:00:00.000Z')
  expect(n.display.consumerPaidAt).toBe(n.display.paidAt) // legacy receipt-date alias
  expect(n.display.sourceOrderPaidAt).toBe('2026-11-01T01:00:00.000Z')
  expect(n.paid_at).toBe(n.display.paidAt)
  expect(n.consumer_paid_at).toBe(n.display.sourceOrderPaidAt)
 })

})

it('keeps source payment independent of the FOP receipt state',()=>{
 const n=normalizeCollectedOrder(raw({hzkj_sourcepayststus:'refunded',hzkj_receipt_status:'0'}),{companyId:'100000'})
 expect(n.display.sourcePaymentStatus).toBe('refunded')
 expect(n.display.paymentStatus).toBe('unpaid')
})


it('reads the fulfillment actual channel Chinese name, independently of the custom channel',()=>{
 const n=normalizeCollectedOrder(raw({hzkj_logistics_channel:{id:'77',name:'云途德国专线',number:'YT-DE'},hzkj_customer_channel:{name:'Standard Shipping'}}),{companyId:'100000'})
 expect(n.display.logisticsChannels).toEqual([{name:'云途德国专线',code:'YT-DE'}])
 expect(n.display.customLogisticsChannelName).toBe('Standard Shipping')
})
it('selects explicit Simplified Chinese when the source returns multilingual channel names',()=>{
 const n=normalizeCollectedOrder(raw({hzkj_logistics_channel:{name:{zh_CN:'云途标准专线',en_US:'YunExpress Standard'},number:'YT'}}),{companyId:'100000'})
 expect(n.display.logisticsChannels).toEqual([{name:'云途标准专线',code:'YT'}])
 const absent=normalizeCollectedOrder(raw({hzkj_logistics_channel:{name:{en_US:'English only'},number:'YT'}}),{companyId:'100000'})
 expect(absent.display.logisticsChannels).toEqual([{name:null,code:'YT'}])
})

it('normalizes review actual channel names from the fulfillment freight calculation entries',()=>{
 const n=normalizeCollectedOrder(raw({hzkj_logistics_info:[{hzkj_combofield:'1',hzkj_channel:{name:'万邦快线含电',number:'WB'}}]}),{companyId:'100000'})
 expect(n.display.logisticsChannels).toEqual([{name:'万邦快线含电',code:'WB'}])
})

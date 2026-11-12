import { normalizeCollectedOrder } from './collected-order-normalizer'
const raw = (patch: Record<string, unknown> = {}) => ({ id:'9007199254740993123', billno:'TO-test', hzkj_org:{id:'100000'}, hzkj_order_amount:'12.30', hzkj_currency:{number:'USD'}, hzkj_orders_billentry:[{id:'9007199254740993124',hzkj_qty:'2',hzkj_local_sku:{number:'SKU',name:'Product'}}],...patch })
describe('collected raw facts',()=>{
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
})

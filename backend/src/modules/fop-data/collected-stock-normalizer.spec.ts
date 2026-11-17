import { normalizeCollectedStock } from './collected-stock-normalizer'
it('retains missing monetary/type/quantity facts as null while preserving scope',()=>{const r=normalizeCollectedStock({id:'1',tenantId:'hyperzone.test',stockNumber:'S',items:[{sku:'SKU'}],cancelled:false},{tenantId:'hyperzone.test'});expect(r.amount).toBeNull();expect(r.currency).toBeNull();expect(r.stockType).toBeNull();expect(r.items[0].quantity).toBeNull();expect(r.dataQuality.missingFields).toEqual(expect.arrayContaining(['amount','currency','stockType','items.quantity']));})
it('rejects mismatched tenant and unsafe identifiers',()=>{expect(()=>normalizeCollectedStock({id:1,tenantId:'other',items:[]},{tenantId:'hyperzone.test'})).toThrow()})

it.each(['A','B','C'])('keeps native paid order status independent from bill %s',bill=>{
 const row=normalizeCollectedStock({id:'1',tenantId:'hyperzone.test',stockNumber:'S',rawOrderStatus:'2',rawBillStatus:bill,paymentStatus:'paid',reviewStatus:bill==='C'?'approved':'pending'}, {tenantId:'hyperzone.test'})
 expect(row.orderStatus).toBe('paid');expect(row.reviewStatus).toBe(bill==='C'?'approved':'pending')
})
it('retains cancelled orders and does not turn unknown native statuses into pending approval',()=>{
 const row=normalizeCollectedStock({id:'1',tenantId:'hyperzone.test',stockNumber:'S',rawOrderStatus:'0',rawBillStatus:'D',paymentStatus:'paid',reviewStatus:'pending'}, {tenantId:'hyperzone.test'})
 expect(row.orderStatus).toBe('cancelled');expect(row.reviewStatus).toBe('unknown')
})

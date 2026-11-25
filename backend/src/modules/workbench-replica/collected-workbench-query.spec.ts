import { collectedWhere } from './collected-workbench-query'
describe('collected orders filters',()=>{
 it('defaults approved queries to the same month as the UI while retaining explicit periods',()=>{
  expect(collectedWhere('b',null,{queue:'review',completed:true})).toEqual(collectedWhere('b',null,{queue:'review',completed:true,timeRange:'1m'}))
  expect(collectedWhere('b',null,{queue:'review',completed:true,timeRange:'all'}).where).not.toContain('paid_at >=')
 })
 it('binds batch and employee authorization',()=>{const q=collectedWhere('batch',['employee'],{queue:'review'});expect(q.params).toEqual(['batch',['employee']]);expect(q.where).toContain('owner_employee_id = ANY');expect(q.where).toContain("raw_order_status='2' AND raw_bill_status IN ('A','B')")})
 it('retains audited records regardless of payment or cancellation',()=>{const q=collectedWhere('b',null,{queue:'review',completed:true,timeRange:'1w'});expect(q.where).toContain("raw_bill_status = 'C'");expect(q.where).not.toContain('raw_payment_status');expect(q.where).toContain("paid_at >= now()");expect(q.where).not.toContain("display->>'reviewedAt'")})
 it('does not invent downstream completion',()=>{expect(collectedWhere('b',null,{queue:'allocation_review'}).where).toContain('EXISTS(SELECT 1 FROM hz_fop_collected_entities');expect(collectedWhere('b',null,{queue:'exceptions'}).where).not.toContain("display->>'nativeProcurementCaptured' IS DISTINCT FROM 'true'")})
 it('reads persisted exceptions without rechecking payment or associated documents',()=>{const where=collectedWhere('b',null,{queue:'exceptions'}).where;expect(where).toContain('is_exception');expect(where).not.toContain('raw_payment_status IS NULL')})
 it('parameterizes searches and empty employee scope',()=>{const q=collectedWhere('b',[],{queue:'unpaid',search:"%' OR TRUE --"});expect(q.params[1]).toEqual([]);expect(q.where).not.toContain('OR TRUE');expect(q.params[2]).toContain('\\%')})
})

it('uses explicit native whole-order outbound as completion without unrelated facts',()=>{
 const q=collectedWhere('batch',null,{queue:'shipping',completed:true})
 expect(q.where).toContain("raw_delivery_status='2'")
 expect(q.where).not.toContain('raw_payment_status')
 expect(q.where).not.toContain('raw_bill_status')
})

it('sorts completed allocations by native allocation audit time instead of parent review',()=>{expect(collectedWhere('b',null,{queue:'allocation_review',completed:true,sortBy:'completedAt'}).orderBy).toContain("a.display->>'approvedAt'")})

it.each(['review','allocation_review'])('filters completed %s by customer payment when payment and audit fall in different weeks',queue=>{
 const q=collectedWhere('b',null,{queue,completed:true,timeRange:'1w',sortBy:'completedAt'})
 // A payment yesterday with an audit last month belongs to the week; a payment
 // last month with an audit yesterday does not. Only paid_at may set this boundary.
 expect(q.where).toContain("paid_at >= now() - ($2 * interval '1 day')")
 expect(q.params).toEqual(['b',7])
 expect(q.where).not.toContain("reviewedAt")
 expect(q.where).not.toContain("approvedAt")
 expect(q.orderBy).toContain(queue==='review'?"display->>'reviewedAt'":"a.display->>'approvedAt'")
})

it.each(['allocation','allocation_review'])('%s supports both dispatch filters before authorized paging and selection',queue=>{
 for(const taskStatus of ['dispatch_complete','dispatch_incomplete']){
  const q=collectedWhere('b',['70'],{queue,taskStatus,mode:'selected',orderIds:['10']})
  expect(q.where).not.toContain('(FALSE)');expect(q.where).toContain('jsonb_array_elements');expect(q.where).toContain('CANCELLED');expect(q.where).toContain('owner_employee_id = ANY');expect(q.params).toEqual(['b',['70'],['10']])
 }
 expect(collectedWhere('b',null,{queue,taskStatus:'invalid'}).where).toContain('(FALSE)')
})
import { collectedStockWhere } from './collected-stock-query'
it('filters positive SKU source quantities before paging without multiplying orders or widening access',()=>{
 for(const [source,field] of [['full_payment','fullPaymentQuantity'],['deposit','depositQuantity'],['direct','directQuantity']]){
  const q=collectedWhere('batch',['employee'],{queue:'procurement_shipping',procurementSource:source})
  expect(q.where).toContain('EXISTS(SELECT 1 FROM jsonb_array_elements')
  expect(q.where).toContain(field);expect(q.where).toContain("->>'complete'='true'")
  expect(q.params).toContainEqual(['employee'])
 }
 expect(collectedWhere('batch',null,{queue:'procurement',procurementSource:'bad'}).where).toContain('(FALSE)')
})
import { collectedRmaWhere } from './collected-rma-query'
it.each([collectedWhere,collectedStockWhere,collectedRmaWhere])('searches matched local staff IDs without dropping the permission predicate',query=>{
 const result=query('batch',['123'],{queue:'review',search:'Jennie',searchOwnerIds:['123']})
 expect(result.params).toContainEqual(['123'])
 expect(result.where).toMatch(/search_text LIKE .* OR owner_employee_id = ANY/)
 expect(result.where).toMatch(/owner_employee_id = ANY\(\$2::text\[\]\)/)
})

it('dispatch pending is approved native paid/processing/cancelled fulfillment, independent of dispatch capture',()=>{
 const q=collectedWhere('b',null,{queue:'dispatch'})
 expect(q.where).toContain("raw_bill_status='C' AND raw_order_status NOT IN ('0','6')")
 expect(q.where).not.toContain('nativeFactsCaptured');expect(q.where).not.toContain('raw_payment_status')
 expect(collectedWhere('b',null,{queue:'dispatch',completed:true}).where).toContain("='fulfilled'")
})

it('uses source payment for unpaid range and ordering only',()=>{
 const q=collectedWhere('b',null,{queue:'unpaid',timeRange:'1w',sortBy:'consumerPaidAt'})
 expect(q.where).toContain("consumer_paid_at >= now()")
 expect(q.orderBy).toBe('consumer_paid_at DESC NULLS LAST, source_id ASC')
 expect(collectedWhere('b',null,{queue:'unpaid'}).orderBy).toContain('consumer_paid_at')
 expect(collectedWhere('b',null,{queue:'review',sortBy:'consumerPaidAt'}).orderBy).toBe('paid_at DESC NULLS LAST, source_id ASC')
})

it('filters unnumbered dispatches before paging using missing and pending, retaining permissions',()=>{
 const q=collectedWhere('batch',['employee'],{queue:'dispatch',taskStatus:'dispatch_pending'})
 expect(q.where).toContain("jsonb_array_elements")
 expect(q.where).toContain("trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13))")
 expect(q.params).toContain('dispatch_pending')
 expect(q.where).toContain('owner_employee_id = ANY')
 expect(q.where).toContain("raw_bill_status='C' AND raw_order_status NOT IN ('0','6')")
})

it('filters unpaid SKU association by native order status, defaulting to linked',()=>{
 expect(collectedWhere('b',null,{queue:'unpaid'}).where).toContain("(raw_order_status='1')")
 expect(collectedWhere('b',null,{queue:'unpaid',skuAssociation:'unlinked'}).where).toContain("(raw_order_status='no')")
 expect(collectedWhere('b',null,{queue:'review',skuAssociation:'unlinked'}).where).not.toContain("(raw_order_status='no')")
})

import { collectedInboundQuery } from './collected-inbound-query'
it.each([collectedWhere,collectedStockWhere,collectedRmaWhere,collectedInboundQuery])('matches UI and FOP warehouse codes inside the authorized local query',query=>{
 for(const [code,aliases] of [['HZ',['HZ','01']],['01',['HZ','01']],['SZ',['SZ','HNDGLB']],['HNDGLB',['SZ','HNDGLB']],['OTHER',['OTHER']]] as const){
  const q=query('batch',['employee'],{queue:'review',warehouseCode:code})
  expect(q.params).toContainEqual(aliases);expect(q.params).toContainEqual(['employee'])
 }
})

describe('approval document status filter', () => {
 it.each(['A','B'])('filters sales by its own bill status %s', billStatus => {
  const result = collectedWhere('batch', null, {queue:'review',billStatus})
  expect(result.where).toContain('raw_bill_status=$2')
  expect(result.params).toEqual(['batch',billStatus])
 })
 it('filters allocations by allocation document status', () => {
  const result = collectedWhere('batch', null, {queue:'allocation_review',billStatus:'B'})
  expect(result.where).toContain("a.display->>'rawBillStatus'=$2")
  expect(result.where).toContain("a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id")
  expect(result.where).not.toContain("jsonb_array_elements(coalesce(display->'allocationDocuments'")
  expect(result.params).toEqual(['batch','B'])
 })
})

it('searches captured logistics fields without relying on legacy search indexes',()=>{
 const q=collectedWhere('batch',['employee'],{queue:'review',search:'HZ%_channel',searchOwnerIds:['employee']})
 expect(q.where).toContain("display->>'customLogisticsChannelName'")
 expect(q.where).toContain("display->'logisticsInfo'")
 expect(q.where).toContain("display->>'carrier'")
 expect(q.params).toContain('%hz\\%\\_channel%')
 expect(q.where).not.toContain('HZ%_channel')
 expect(q.where).toContain('owner_employee_id = ANY')
})

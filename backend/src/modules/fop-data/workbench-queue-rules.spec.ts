import { matchesQueue, isProcurementReady, isProcurementCompleted } from './workbench-queue-rules'
import { isStageCompleted } from './completed-orders'
import type { FopOrder, ProcurementProgress } from './fop-data.types'
import { getProcurementStage } from './procurement-stage'

it.each(['unknown', undefined] as const)('does not display supplier shipment as ready with platform result %s', alibabaOrder => {
  expect(getProcurementStage({ purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder }, 'pending')).toBe('unknown')
})

const order = (): FopOrder => ({ cancelled: false, paymentStatus: 'paid', reviewStatus: 'approved', exception: null,
  procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder: 'pushed' },
  fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
} as FopOrder)

it.each([
  ['pushed', true, false, 'supplier_pending'], ['not_required', true, false, 'supplier_pending'],
  ['unknown', false, false, 'unknown'], [undefined, false, false, 'unknown'],
  ['not_pushed', false, true, 'alibaba_pending'], ['partial', false, true, 'alibaba_pending'],
] as const)('requires actual placement evidence %s for supplier pending and purchase completion', (alibabaOrder, complete, procurement, stage) => {
  const row = order()
  row.procurementProgress!.alibabaOrder = alibabaOrder
  expect(matchesQueue(row, 'procurement_shipping')).toBe(complete)
  expect(matchesQueue(row, 'procurement')).toBe(procurement)
  expect(isProcurementReady(row.procurementProgress)).toBe(complete)
  expect(isProcurementCompleted(row.procurementProgress, 'pending')).toBe(false)
  expect(isStageCompleted(row, 'procurement')).toBe(false)
  expect(getProcurementStage(row.procurementProgress, 'pending')).toBe(stage)
})

it.each(['unpaid', 'partial', 'refunded', 'unknown', 'not_required'] as const)('cannot complete procurement with supplier payment %s', supplierPayment => {
  const row = order()
  row.procurementProgress!.supplierPayment = supplierPayment
  expect(matchesQueue(row, 'procurement_shipping')).toBe(false)
  expect(isStageCompleted(row, 'procurement')).toBe(false)
})

it.each([['pending', true], ['partial', true], ['unknown', false], ['completed', false]] as const)('uses explicit outbound %s for both allocation queues', (outbound, expected) => {
  const row = order()
  row.fulfillmentProgress.outbound = outbound
  expect(matchesQueue(row, 'allocation')).toBe(expected)
  row.fulfillmentProgress.stockReadiness = 'ready'
  expect(matchesQueue(row, 'allocation_review')).toBe(expected)
})

it('keeps paid unsynced work visible before sales approval and despite an independent exception', () => {
  const row = order()
  row.reviewStatus = 'pending'
  row.exception = { type: 'allocation_exception', reason: null, hours: 2 }
  expect(matchesQueue(row, 'dispatch')).toBe(true)
  expect(matchesQueue(row, 'review')).toBe(true)
  expect(matchesQueue(row, 'exceptions')).toBe(true)
  expect(matchesQueue(row, 'procurement_shipping')).toBe(true)
  expect(isStageCompleted(row, 'procurement')).toBe(false)
  row.paymentStatus = 'unpaid'
  expect(matchesQueue(row, 'dispatch')).toBe(false)
  expect(matchesQueue(row, 'exceptions')).toBe(true)
  row.cancelled = true
  expect(matchesQueue(row, 'exceptions')).toBe(false)
})

it('keeps purchase completion while supplier shipment advances without treating it as outbound completion', () => {
  const row = order()
  row.fulfillmentProgress.supplierShipment = 'shipped'
  expect(matchesQueue(row, 'procurement_shipping')).toBe(false)
  expect(isStageCompleted(row, 'procurement')).toBe(true)
  expect(isStageCompleted(row, 'shipping')).toBe(false)
})

it('keeps unknown or absent purchase facts unclassified', () => {
  for (const purchase of [undefined, { purchaseOrder: 'unknown', supplierPayment: 'unknown' } as ProcurementProgress]) {
    const row = order()
    row.procurementProgress = purchase
    expect(matchesQueue(row, 'procurement')).toBe(false)
    expect(matchesQueue(row, 'procurement_shipping')).toBe(false)
    expect(isStageCompleted(row, 'procurement')).toBe(false)
  }
})

it('excludes stock-covered and already shipped orders from pending purchasing', () => { const row=order(); row.procurementProgress!.supplierPayment='unpaid'; row.fulfillmentProgress.supplierShipment='shipped'; expect(matchesQueue(row,'procurement')).toBe(false); row.procurementProgress!.purchaseOrder='not_required'; expect(isStageCompleted(row,'procurement')).toBe(false) })

import { compareFulfillmentOrders } from './fop-order-sort'
it('sorts delivery stages before payment time in shared export ordering',()=>{
 const pending={...order(),id:'z',consumerPaidAt:'2026-01-01T00:00:00Z',dispatchTaskStatus:'dispatch_pending' as const}
 const tracked={...order(),id:'a',consumerPaidAt:'2026-02-01T00:00:00Z',dispatchTaskStatus:'dispatch_tracking' as const}
 expect(compareFulfillmentOrders(pending,tracked,{queue:'dispatch',sortBy:'dispatchDocumentStatus',sortOrder:'asc'})).toBeLessThan(0)
 expect(compareFulfillmentOrders(pending,tracked,{queue:'dispatch',sortBy:'dispatchDocumentStatus',sortOrder:'desc'})).toBeGreaterThan(0)
})

it('keeps native purchased refund follow-up when an old shipment projection says shipped', () => {
  const row=order(); row.sourcePurchaseStatus='2'; row.procurementProgress!.supplierPayment='refunded'; row.fulfillmentProgress.supplierShipment='shipped'
  expect(matchesQueue(row,'procurement')).toBe(true)
  expect(isStageCompleted(row,'procurement')).toBe(false)
  row.sourcePurchaseStatus='4'
  expect(matchesQueue(row,'procurement')).toBe(false)
  expect(isStageCompleted(row,'procurement')).toBe(true)
})

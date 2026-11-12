import { diagnoseCoverage, REGULAR_PENDING_QUEUES, SUPPLEMENTARY_QUEUES, type CoverageEvidence } from './workbench-coverage'
import { matchesQueue } from '../fop-data/workbench-queue-rules'
import type { FopOrder } from '../fop-data/fop-data.types'

function evidence(overrides: Partial<FopOrder> = {}): CoverageEvidence {
  const order = { cancelled: false, paymentStatus: 'paid', reviewStatus: 'approved', exception: null,
    sourcePurchaseStatus: '3', procurementProgress: { purchaseOrder: 'not_required', supplierPayment: 'not_required', alibabaOrder: 'not_required' },
    fulfillmentProgress: { allocationCreated: false, shopifySync: 'synced', supplierShipment: 'shipped', stockReadiness: 'ready', allocationReview: 'pending', outbound: 'pending' }, ...overrides } as FopOrder
  return { cancelled: false, rawDeliveryStatus: '0', ready: true,
    memberships: Object.fromEntries([...REGULAR_PENDING_QUEUES.map(queue => [queue, matchesQueue(order, queue) && !(queue === 'shipping' && order.shipmentInterceptStatus === 'intercepted') ? 'member' : 'non_member']), ...SUPPLEMENTARY_QUEUES.map(queue => [queue, 'non_member'])]),
    allocationCreated: order.fulfillmentProgress?.allocationCreated, stockReadiness: order.fulfillmentProgress?.stockReadiness,
    allocationReview: order.fulfillmentProgress?.allocationReview, intercepted: order.shipmentInterceptStatus === 'intercepted' }
}
it('flags a synthetic missing-allocation tuple for consistency investigation, not normal source reachability', () => {
  expect(diagnoseCoverage(evidence())).toMatchObject({ state: 'uncovered', regularGap: true, reasons: ['allocation_not_created'] })
})
it('does not count historical completion lists as actionable coverage', () => {
  const row = evidence(); row.memberships.sales_completed = 'member'; row.memberships.dispatch_completed = 'member'
  expect(diagnoseCoverage(row).state).toBe('uncovered')
})
it.each([
  [true, 'incomplete', 'approved', null, 'approved_allocation_stock_incomplete'],
  [true, 'ready', 'approved', 'intercepted', 'shipment_intercepted'],
] as const)('reports synthetic inconsistent or intercepted tuples without proving normal source reachability (%s %s %s %s)', (allocationCreated, stockReadiness, allocationReview, shipmentInterceptStatus, reason) => {
  const row = evidence({ shipmentInterceptStatus, fulfillmentProgress: { allocationCreated, stockReadiness, allocationReview, shopifySync: 'synced', supplierShipment: 'shipped', outbound: 'pending' } })
  expect(diagnoseCoverage(row)).toMatchObject({ state: 'uncovered', reasons: [reason] })
})
it('distinguishes missing supplementary facts from a confirmed all-list gap', () => {
  const row = evidence(); row.memberships.rma = 'unknown'
  expect(diagnoseCoverage(row)).toMatchObject({ state: 'unknown', regularGap: true, unknownQueues: ['rma'] })
})
it('treats refunds as unresolved fulfillment until an explicit terminal fact exists', () => {
  expect(diagnoseCoverage({ ...evidence(), refunded: true })).toMatchObject({ state: 'uncovered', reasons: ['allocation_not_created', 'refund_obligation_unresolved'] })
})
it('keeps unknown facts and stale projections separate from zero todos', () => {
  expect(diagnoseCoverage({ ...evidence(), rawDeliveryStatus: null }).state).toBe('unknown')
  expect(diagnoseCoverage({ ...evidence(), ready: false }).state).toBe('unknown')
  expect(diagnoseCoverage({ ...evidence(), cancelled: null }).state).toBe('unknown')
  expect(diagnoseCoverage({ ...evidence(), ready: false, cancelled: true }).state).toBe('unknown')
  expect(diagnoseCoverage({ ...evidence(), ready: false, rawDeliveryStatus: '2' }).state).toBe('unknown')
})
it('recognizes normal actionable, cancelled and fully outbound cases', () => {
  const row = evidence(); row.memberships.shipping = 'member'
  expect(diagnoseCoverage(row)).toMatchObject({ state: 'potentially_actionable', queues: ['shipping'] })
  expect(diagnoseCoverage({ ...row, cancelled: true }).state).toBe('terminal')
  expect(diagnoseCoverage({ ...row, rawDeliveryStatus: '2' }).state).toBe('completed')
})

// User-confirmed current FOP flow: stock-backed orders create allocation on audit;
// sufficient reserved stock enters allocation_review even after Shopify fulfillment.
it('routes a current stock-backed ready order to allocation review without procurement', () => {
  const row = evidence({ fulfillmentProgress: { allocationCreated: true, stockReadiness: 'ready',
    allocationReview: 'pending', shopifySync: 'synced', supplierShipment: 'shipped', outbound: 'pending' } })
  expect(row.memberships.procurement).toBe('non_member')
  expect(row.memberships.procurement_shipping).toBe('non_member')
  expect(diagnoseCoverage(row)).toMatchObject({ state: 'potentially_actionable', regularGap: false,
    queues: ['allocation_review'], reasons: [] })
})
it('keeps an existing incomplete pending-review allocation in the allocation queue', () => {
  const row = evidence({ fulfillmentProgress: { allocationCreated: true, stockReadiness: 'incomplete',
    allocationReview: 'pending', shopifySync: 'synced', supplierShipment: 'shipped', outbound: 'pending' } })
  expect(diagnoseCoverage(row)).toMatchObject({ state: 'potentially_actionable', regularGap: false,
    queues: ['allocation'], reasons: [] })
})

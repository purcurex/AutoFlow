import { describe, expect, it } from 'vitest'
import { isFopOrderPageDataValid, matchesFopQueue, type FopOrder } from '@/api/fop-orders'
import { matchesCompletedQueue } from '@/utils/completed-orders'

// Matches publisher output: storage remains collected; timestamp is synchronization provenance.
const row = (patch: Partial<FopOrder> = {}): FopOrder => ({
  paymentStatus: 'paid', reviewStatus: 'approved', cancelled: false, exception: null,
  amount: null, currency: null, items: [{ id: 'line', quantity: null }],
  sourcePurchaseStatus: null, sourceOutboundStatus: null,
  dataQuality: { mode: 'collected', syncMode: 'timestamp', readOnly: true, missingFields: ['hzkj_delivery_status'], reasons: ['eventual_timestamp_capture', 'source_deletions_and_uncaptured_changes_unproven'] },
  fulfillmentProgress: { allocationCreated: null, allocationReview: 'unknown', stockReadiness: 'unknown', outbound: 'unknown', supplierShipment: 'unknown', shopifySync: 'unknown' },
  procurementProgress: { purchaseOrder: 'unknown', supplierPayment: 'unknown', alibabaOrder: 'unknown' },
  ...patch,
} as unknown as FopOrder)
const page = (item: FopOrder, readMode = 'local') => ({
  items: [item], replica: { dataMode: 'collected', readMode, complete: false },
  dataAvailability: { mode: 'collected', complete: false },
} as Parameters<typeof isFopOrderPageDataValid>[0])

describe('timestamp publisher facts retain the collected read-only list contract', () => {
  it('accepts unknown local facts and keeps their exceptions visible without inferring a workflow', () => {
    const item = row({ paymentStatus: 'unknown', reviewStatus: 'unknown' })
    expect(isFopOrderPageDataValid(page(item))).toBe(true)
    expect(matchesFopQueue(item, 'exceptions')).toBe(true)
    for (const queue of ['procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'shipping'] as const) expect(matchesFopQueue(item, queue)).toBe(false)
  })
  it('does not accept partial timestamp facts outside the immutable local collection', () => {
    const item = row()
    expect(isFopOrderPageDataValid(page(item, 'remote'))).toBe(false)
    expect(isFopOrderPageDataValid(page({ ...item, dataQuality: { ...item.dataQuality!, readOnly: false } } as unknown as FopOrder))).toBe(false)
    expect(isFopOrderPageDataValid(page({ ...item, dataQuality: { ...item.dataQuality!, mode: 'timestamp' } } as unknown as FopOrder))).toBe(false)
  })
  it.each(['purchase_order_pending', 'dispatch_preparation', 'payment_pending'] as const)('uses independently verified procurement stage %s despite missing old header status', procurementStage => {
    const item = row({ nativeProcurementCaptured: true, procurementStage })
    expect(matchesFopQueue(item, 'procurement')).toBe(true)
    expect(matchesFopQueue(item, 'procurement_shipping')).toBe(false)
    expect(matchesCompletedQueue(item, 'procurement')).toBe(false)
  })
  it.each(['alibaba_pending', 'refund_pending'] as const)('does not treat retired stage %s as an actionable pending task', procurementStage => {
    expect(matchesFopQueue(row({ nativeProcurementCaptured: true, procurementStage }), 'procurement')).toBe(false)
  })
  it('uses verified supplier shipment and completion while leaving unknown procurement out', () => {
    expect(matchesFopQueue(row({ nativeProcurementCaptured: true, procurementStage: 'supplier_pending' }), 'procurement_shipping')).toBe(true)
    expect(matchesCompletedQueue(row({ nativeProcurementCaptured: true, procurementStage: 'shipped' }), 'procurement')).toBe(true)
    const unknown = row({ nativeProcurementCaptured: true, procurementStage: 'unknown' })
    expect(matchesFopQueue(unknown, 'procurement')).toBe(false)
    expect(matchesFopQueue(unknown, 'procurement_shipping')).toBe(false)
    expect(matchesCompletedQueue(unknown, 'procurement')).toBe(false)
  })
  it('keeps refreshed stock readiness separate from missing source outbound evidence', () => {
    const item = row({ allocationDocuments: [{ id: 'allocation', rawBillStatus: 'B', rawAllocationStatus: 'available' }] as FopOrder['allocationDocuments'], fulfillmentProgress: { allocationCreated: true, allocationReview: 'pending', stockReadiness: 'incomplete', outbound: 'unknown', supplierShipment: 'unknown', shopifySync: 'unknown' } })
    expect(matchesFopQueue(item, 'allocation')).toBe(true)
    expect(matchesFopQueue({ ...item, sourceOutboundStatus: '0' }, 'allocation')).toBe(true)
    expect(matchesFopQueue(row({ nativeFactsCaptured: true, nativeShippingReady: true }), 'shipping')).toBe(false)
    expect(matchesCompletedQueue(row({ nativeFactsCaptured: true, nativeShippingReady: true }), 'shipping')).toBe(false)
  })
})

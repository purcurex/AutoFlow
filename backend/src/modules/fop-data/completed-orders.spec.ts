import { completedAt, completedRange, isStageCompleted, type CompletionQueue } from './completed-orders'
import type { FopOrder } from './fop-data.types'
const now = Date.parse('2026-10-30T12:00:00Z'), day = 86400000
const base = {
  cancelled: false, paymentStatus: 'paid', reviewStatus: 'approved',
  reviewedAt: '2026-10-24T12:00:00Z', dispatchApprovedAt: '2026-10-25T12:00:00Z', shopifySyncedAt: '2026-10-25T12:00:00Z', procurementCompletedAt: '2026-10-26T12:00:00Z',
  allocationApprovedAt: '2026-10-27T12:00:00Z', outboundCompletedAt: '2026-10-28T12:00:00Z',
  paidAt: '2025-01-01T00:00:00Z', consumerPaidAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
  procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder: 'pushed' },
  fulfillmentProgress: { allocationCreated: true, allocationReview: 'approved', outbound: 'completed', shopifySync: 'synced', supplierShipment: 'shipped', stockReadiness: 'ready' },
} as FopOrder
const phases = ['review', 'dispatch', 'procurement', 'allocation_review', 'shipping'] as CompletionQueue[]
it.each(phases)('retains completed %s after later stages and uses its own timestamp', queue => {
  expect(isStageCompleted(base, queue)).toBe(true)
  expect(completedRange(undefined, now)(completedAt(base, queue))).toBe(true)
})
it('dispatch uses existing shipment approval time and never substitutes Shopify sync time', () => {
  const audited = { ...base, dispatchApprovedAt: '2026-10-29T12:00:00Z', shopifySyncedAt: '2026-10-01T12:00:00Z' }
  expect(completedAt(audited, 'dispatch')).toBe('2026-10-29T12:00:00.000Z')
  expect(completedAt({ ...audited, dispatchApprovedAt: null }, 'dispatch')).toBeNull()
})
it.each([true, false])('includes the rolling week boundaries, excluding future and older dates (%s)', explicit => {
  const accepts = completedRange(explicit ? '1w' : undefined, now)
  expect(accepts(new Date(now - 7 * day).toISOString())).toBe(true)
  expect(accepts(new Date(now).toISOString())).toBe(true)
  expect(accepts(new Date(now - 7 * day - 1).toISOString())).toBe(false)
  expect(accepts(new Date(now + 1).toISOString())).toBe(false)
})
it.each([null, undefined, 'bad', '2026-10-30T12:00:00', '2026-02-30T12:00:00Z'])('does not substitute payment/creation time for unavailable completion: %s', reviewedAt => {
  expect(completedAt({ ...base, reviewedAt }, 'review')).toBeNull()
  expect(completedRange(undefined, now)(completedAt({ ...base, reviewedAt }, 'review'))).toBe(false)
})
it('expands only the requested calendar month/quarter and excludes cancellation/refunds/partial facts', () => {
  expect(completedRange('1m', now)('2026-09-30T12:00:00Z')).toBe(true)
  expect(completedRange('1m', now)('2026-09-30T11:59:59Z')).toBe(false)
  expect(completedRange('3m', now)('2026-07-30T12:00:00Z')).toBe(true)
  for (const queue of phases) {
    expect(isStageCompleted({ ...base, cancelled: true }, queue)).toBe(false)
    expect(isStageCompleted({ ...base, paymentStatus: 'refunded' }, queue)).toBe(false)
  }
  expect(isStageCompleted({ ...base, procurementProgress: { ...base.procurementProgress!, supplierPayment: 'partial' } }, 'procurement')).toBe(false)
  expect(isStageCompleted({ ...base, procurementProgress: { ...base.procurementProgress!, alibabaOrder: 'unknown' } }, 'procurement')).toBe(false)
  expect(isStageCompleted({ ...base, fulfillmentProgress: { ...base.fulfillmentProgress, allocationReview: 'pending' } }, 'allocation_review')).toBe(false)
  expect(isStageCompleted({ ...base, fulfillmentProgress: { ...base.fulfillmentProgress, shopifySync: 'unknown' } }, 'dispatch')).toBe(false)
  expect(isStageCompleted({ ...base, fulfillmentProgress: { ...base.fulfillmentProgress, outbound: 'partial' } }, 'shipping')).toBe(false)
})

it('uses purchase completion facts independently of the sales approval stage, matching the existing procurement queues', () => {
  const pendingSalesReview = { ...base, reviewStatus: 'pending' as const }
  expect(isStageCompleted(pendingSalesReview, 'procurement')).toBe(true)
  expect(completedAt(pendingSalesReview, 'procurement')).toBe('2026-10-26T12:00:00.000Z')
  expect(isStageCompleted(pendingSalesReview, 'review')).toBe(false)
  expect(isStageCompleted(pendingSalesReview, 'dispatch')).toBe(false)
})

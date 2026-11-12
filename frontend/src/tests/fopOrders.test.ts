import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFopOrders, matchesFopQueue, type FopOrderQueue } from '@/api/fop-orders'

import { clearWorkbenchCounts, getWorkbenchCount } from '@/utils/workbench-counts'
import { getProcurementStage } from '@/utils/procurement-stage'
import { mockFopOrders } from '@/api/fop-order-fixtures'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/index', () => ({ default: { get } }))

describe('authenticated fulfillment provider', () => {
  beforeEach(() => { get.mockReset() })
  it('does not cache an unavailable dataset as a real zero', async () => {
    clearWorkbenchCounts()
    get.mockResolvedValue({ source: 'fop', items: [], total: 0, page: 1, pageSize: 20, dataAvailability: { mode: 'collected', complete: false, missingDatasets: ['allocation'] } })
    await getFopOrders({ queue: 'allocation', page: 1, pageSize: 20 })
    const load = vi.fn(async () => 17)
    expect(await getWorkbenchCount('allocation', load)).toBe(17)
    expect(load).toHaveBeenCalledOnce()
  })
  it('requests server-filtered orders without accepting a caller-selected identity', async () => {
    const page = { source: 'fop', items: [], total: 0, page: 1, pageSize: 20 }
    get.mockResolvedValue(page)
    const query = { queue: 'allocation' as const, page: 1, pageSize: 20, userId: 'another-user', tenantId: 'other-tenant' }
    expect(await getFopOrders(query)).toEqual(page)
    expect(get).toHaveBeenCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: { queue: 'allocation', page: 1, pageSize: 20, search: undefined, orderNumber: undefined } })
  })
  it.each([['unpaid', false], ['review', false], ['review', true]] as const)('uses the normal local query timeout for %s completed=%s and preserves cancellation', async (queue, completed) => {
    const signal = new AbortController().signal
    get.mockResolvedValue({ source: 'fop', items: [], total: 0, page: 1, pageSize: 20 })
    await getFopOrders({ queue, ...(completed ? { completed: true } : {}), page: 1, pageSize: 20 }, signal)
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', {
      params: expect.objectContaining({ queue, page: 1, pageSize: 20, ...(completed ? { completed: true } : {}) }),
      signal,
    })
  })
  it.each(['fop_binding_required', 'fop_not_configured', 'fop_permission_denied', 'fop_unavailable'])('does not fall back to demo orders after %s', async code => {
    const failure = { statusCode: 403, code }
    get.mockRejectedValue(failure)
    await expect(getFopOrders({ queue: 'review', page: 1, pageSize: 20 })).rejects.toBe(failure)
  })
  it('rejects unsupported queues and invalid pagination before requesting data', async () => {
    await expect(getFopOrders({ queue: 'all' as FopOrderQueue, page: 1, pageSize: 20 })).rejects.toThrow()
    await expect(getFopOrders({ queue: 'review', page: 0, pageSize: 20 })).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('fulfillment queue response validation', () => {
  it('rejects unpaid review and derives overlapping queues from independent progress', () => {
    const base = { ...mockFopOrders[0]!, procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid' } as const, reviewStatus: 'approved' as const, paymentStatus: 'paid' as const, cancelled: false, exception: null }
    expect(matchesFopQueue({ ...base, reviewStatus: 'pending', paymentStatus: 'unpaid' }, 'review')).toBe(false)
    const waiting = { ...base, fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'partial', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' } as const }
    for (const queue of ['dispatch', 'procurement', 'allocation'] as const) expect(matchesFopQueue(waiting, queue)).toBe(true)
    expect(matchesFopQueue(waiting, 'shipping')).toBe(false)
    expect(matchesFopQueue({ ...waiting, reviewStatus: 'pending' }, 'dispatch')).toBe(true)
    expect(matchesFopQueue({ ...waiting, reviewStatus: 'pending' }, 'review')).toBe(true)
    expect(matchesFopQueue({ ...waiting, paymentStatus: 'unpaid' }, 'dispatch')).toBe(false)
    const unsupportedSync = structuredClone(waiting)
    Reflect.set(unsupportedSync.fulfillmentProgress, 'shopifySync', 'partial')
    expect(matchesFopQueue(unsupportedSync, 'dispatch')).toBe(false)
    for (const shopifySync of ['synced', 'not_required', 'unknown'] as const) {
      expect(matchesFopQueue({ ...waiting, fulfillmentProgress: { ...waiting.fulfillmentProgress, shopifySync } }, 'dispatch')).toBe(false)
    }
    expect(matchesFopQueue({ ...waiting, fulfillmentProgress: { ...waiting.fulfillmentProgress, allocationReview: 'approved' } }, 'allocation')).toBe(false)
    for (const allocationCreated of [false, null, undefined]) {
      expect(matchesFopQueue({ ...waiting, fulfillmentProgress: { ...waiting.fulfillmentProgress, allocationCreated } }, 'allocation')).toBe(false)
    }
    const ready = { ...waiting, fulfillmentProgress: { ...waiting.fulfillmentProgress, stockReadiness: 'ready' as const, allocationReview: 'approved' as const } }
    expect(matchesFopQueue(ready, 'allocation')).toBe(false)
    expect(matchesFopQueue(ready, 'shipping')).toBe(true)
    const awaitingApproval = { ...ready, fulfillmentProgress: { ...ready.fulfillmentProgress, allocationReview: 'pending' as const } }
    expect(matchesFopQueue(awaitingApproval, 'shipping')).toBe(false)
    expect(matchesFopQueue(awaitingApproval, 'allocation')).toBe(false)
    expect(matchesFopQueue(awaitingApproval, 'allocation_review')).toBe(true)
    expect(matchesFopQueue({ ...awaitingApproval, fulfillmentProgress: { ...awaitingApproval.fulfillmentProgress, outbound: 'unknown' } }, 'shipping')).toBe(false)
    for (const allocationReview of ['pending', 'approved'] as const) {
      expect(matchesFopQueue({ ...ready, fulfillmentProgress: { ...ready.fulfillmentProgress, allocationReview, outbound: 'completed' } }, 'shipping')).toBe(false)
    }
    expect(matchesFopQueue({ ...ready, fulfillmentProgress: { ...ready.fulfillmentProgress, allocationReview: 'unknown' } }, 'shipping')).toBe(false)
    expect(matchesFopQueue({ ...ready, fulfillmentProgress: { ...ready.fulfillmentProgress, outbound: 'unknown' } }, 'shipping')).toBe(false)
    expect(matchesFopQueue({ ...awaitingApproval, paymentStatus: 'unpaid' }, 'shipping')).toBe(false)
    expect(matchesFopQueue({ ...awaitingApproval, reviewStatus: 'pending' }, 'shipping')).toBe(false)
    expect(matchesFopQueue({ ...ready, cancelled: true }, 'shipping')).toBe(false)
    expect(matchesFopQueue({ ...ready, paymentStatus: 'refunded' }, 'shipping')).toBe(false)
  })
})


describe('explicit procurement and outbound evidence', () => {
  const base = { ...mockFopOrders[0]!, cancelled: false, paymentStatus: 'paid' as const, reviewStatus: 'approved' as const,
    procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder: 'unknown' } as const,
    fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'unknown' } as const }
  it('does not interpret an unknown or missing platform result as a completed purchase', () => {
    for (const alibabaOrder of ['unknown', undefined] as const) {
      const row = { ...base, procurementProgress: { ...base.procurementProgress, alibabaOrder } }
      expect(matchesFopQueue(row, 'procurement_shipping')).toBe(false)
      expect(matchesFopQueue(row, 'procurement', undefined, true)).toBe(false)
      expect(getProcurementStage(row.procurementProgress, 'pending')).toBe('unknown')
    }
  })
  it('requires explicit pending outbound for both allocation queues', () => {
    expect(matchesFopQueue(base, 'allocation')).toBe(false)
    expect(matchesFopQueue({ ...base, fulfillmentProgress: { ...base.fulfillmentProgress, stockReadiness: 'ready' } }, 'allocation_review')).toBe(false)
  })
})

it.each(['pushed', 'not_required'] as const)('keeps supplier pending out of completed procurement for %s', alibabaOrder => {
  const row = { ...mockFopOrders[0]!, cancelled: false, paymentStatus: 'paid' as const, reviewStatus: 'pending' as const,
    procurementProgress: { purchaseOrder: 'ordered', supplierPayment: 'paid', alibabaOrder } as const,
    fulfillmentProgress: { ...mockFopOrders[0]!.fulfillmentProgress, supplierShipment: 'pending' as const } }
  expect(matchesFopQueue(row, 'procurement_shipping')).toBe(true)
  expect(matchesFopQueue(row, 'procurement')).toBe(false)
  expect(matchesFopQueue(row, 'procurement', undefined, true)).toBe(false)
  expect(getProcurementStage(row.procurementProgress, 'pending')).toBe('supplier_pending')
})


it('uses approval alone for completed sales even when the payment or fulfillment phase differs', () => {
  const row = { ...mockFopOrders[0]!, reviewStatus: 'approved' as const, paymentStatus: 'unpaid' as const }
  expect(matchesFopQueue(row, 'review', undefined, true)).toBe(true)
  expect(matchesFopQueue({ ...row, paymentStatus: 'refunded', cancelled: true }, 'review', undefined, true)).toBe(true)
  expect(matchesFopQueue({ ...row, reviewStatus: 'pending' }, 'review', undefined, true)).toBe(false)
})

it('uses native purchased state for refund follow-up despite an old shipped projection', () => {
  const row={...mockFopOrders[0]!,cancelled:false,paymentStatus:'paid' as const,sourcePurchaseStatus:'2' as const,
    procurementProgress:{purchaseOrder:'ordered',supplierPayment:'refunded',alibabaOrder:'pushed'} as const,
    fulfillmentProgress:{...mockFopOrders[0]!.fulfillmentProgress,supplierShipment:'shipped' as const}}
  expect(matchesFopQueue(row,'procurement')).toBe(true)
  expect(matchesFopQueue(row,'procurement',undefined,true)).toBe(false)
  expect(matchesFopQueue({...row,sourcePurchaseStatus:'4'},'procurement')).toBe(false)
})

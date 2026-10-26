import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFopOrders, matchesFopQueue, type FopOrderQueue } from '@/api/fop-orders'

import { mockFopOrders } from '@/api/fop-order-fixtures'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/index', () => ({ default: { get } }))

describe('authenticated fulfillment provider', () => {
  beforeEach(() => { get.mockReset() })
  it('requests server-filtered orders without accepting a caller-selected identity', async () => {
    const page = { source: 'fop', items: [], total: 0, page: 1, pageSize: 20 }
    get.mockResolvedValue(page)
    const query = { queue: 'allocation' as const, page: 1, pageSize: 20, userId: 'another-user', tenantId: 'other-tenant' }
    expect(await getFopOrders(query)).toEqual(page)
    expect(get).toHaveBeenCalledWith('/autoflow/integrations/fop/fulfillment-orders', { params: { queue: 'allocation', page: 1, pageSize: 20, search: undefined, orderNumber: undefined } })
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
    const base = { ...mockFopOrders[0]!, reviewStatus: 'approved' as const, paymentStatus: 'paid' as const, cancelled: false, exception: null }
    expect(matchesFopQueue({ ...base, reviewStatus: 'pending', paymentStatus: 'unpaid' }, 'review')).toBe(false)
    const waiting = { ...base, fulfillmentProgress: { shopifySync: 'pending', supplierShipment: 'partial', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' } as const }
    for (const queue of ['dispatch', 'procurement', 'allocation'] as const) expect(matchesFopQueue(waiting, queue)).toBe(true)
    expect(matchesFopQueue(waiting, 'shipping')).toBe(false)
    const ready = { ...waiting, fulfillmentProgress: { ...waiting.fulfillmentProgress, stockReadiness: 'ready' as const, allocationReview: 'approved' as const } }
    expect(matchesFopQueue(ready, 'allocation')).toBe(false)
    expect(matchesFopQueue(ready, 'shipping')).toBe(true)
    const awaitingApproval = { ...ready, fulfillmentProgress: { ...ready.fulfillmentProgress, allocationReview: 'pending' as const } }
    expect(matchesFopQueue(awaitingApproval, 'shipping')).toBe(true)
    expect(matchesFopQueue(awaitingApproval, 'allocation')).toBe(false)
    expect(matchesFopQueue(awaitingApproval, 'allocation_review')).toBe(true)
    expect(matchesFopQueue({ ...awaitingApproval, fulfillmentProgress: { ...awaitingApproval.fulfillmentProgress, outbound: 'unknown' } }, 'shipping')).toBe(true)
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

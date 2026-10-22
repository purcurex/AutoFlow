import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFopOrders, type FopOrderQueue } from '@/api/fop-orders'

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

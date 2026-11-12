import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkbenchDashboardCounts } from '@/api/workbench-dashboard'
import { getFopOrders } from '@/api/fop-orders'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { clearWorkbenchCounts, rememberWorkbenchCount } from '@/utils/workbench-counts'
import { captureSession } from '@/utils/session'
vi.mock('@/api/fop-orders', () => ({ getFopOrders: vi.fn() }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
beforeEach(() => {
  clearWorkbenchCounts(); vi.clearAllMocks()
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales', 'dispatch', 'procurement', 'allocation', 'warehouse'], isAdmin: false })
  vi.mocked(getFopOrders).mockImplementation(async query => ({ total: query.queue === 'review' ? 0 : 7, items: [{}] }) as never)
})
describe('dashboard list counts', () => {
  it('keeps unavailable collected queue counts unknown while retaining known sales totals', async () => {
    vi.mocked(getFopOrders).mockImplementation(async query => ({ total: query.queue === 'review' ? 84 : 0, items: [],
      dataAvailability: { mode: 'collected', complete: false, ...(query.queue === 'review' ? {} : { missingDatasets: ['allocation'] }) } }) as never)
    const result = await getWorkbenchDashboardCounts()
    expect(result.queues).toEqual({ review: 84, dispatch: null, procurement: null, allocation: null, shipping: null })
    expect(result.queueStates?.allocation).toBe('not_configured')
  })
  it('uses full list totals and sums mutually exclusive stages', async () => {
    const result = await getWorkbenchDashboardCounts()
    expect(result.queues).toEqual({ review: 0, dispatch: 7, procurement: 14, allocation: 14, shipping: 7 })
    expect(getFopOrders).toHaveBeenCalledTimes(7)
    expect(getFopOrders).toHaveBeenCalledWith({ queue: 'review', page: 1, pageSize: 1, projection: 'count' })
    expect(result.queueBreakdown?.procurement).toHaveLength(2)
    expect(result.tasks.find(task => task.kind === 'review')).toBeUndefined()
  })
  it('uses workbench cache and avoids querying forbidden queues', async () => {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false })
    rememberWorkbenchCount({ queue: 'review', page: 2, pageSize: 20 }, 98, captureSession())
    const result = await getWorkbenchDashboardCounts()
    expect(result.queues.review).toBe(98)
    expect(result.queueStates?.shipping).toBe('forbidden')
    expect(getFopOrders).not.toHaveBeenCalled()
  })
  it('keeps an incomplete combination null, with a usable available child', async () => {
    vi.mocked(getFopOrders).mockImplementation(async query => {
      if (query.queue === 'procurement_shipping') throw { code: 'fop_feature_not_configured' }
      return { total: 5 } as never
    })
    const result = await getWorkbenchDashboardCounts()
    expect(result.queues.procurement).toBeNull()
    expect(result.queueStates?.procurement).toBe('not_configured')
    expect(result.queueBreakdown?.procurement?.[0]).toMatchObject({ count: 5, state: 'ready' })
  })
  it('discards the whole snapshot on access revocation', async () => {
    vi.mocked(getFopOrders).mockRejectedValue({ code: 'fop_binding_changed' })
    await expect(getWorkbenchDashboardCounts()).rejects.toMatchObject({ code: 'fop_binding_changed' })
  })
  it('retains review totals when other live adapter queues are unavailable or not integrated', async () => {
    vi.mocked(getFopOrders).mockImplementation(async query => {
      if (query.queue === 'review') return { total: 84, items: [{}] } as never
      throw { statusCode: 503, code: query.queue === 'dispatch' ? 'fop_result_too_large' : 'fop_feature_not_configured' }
    })
    const result = await getWorkbenchDashboardCounts()
    expect(result.queues).toEqual({ review: 84, dispatch: null, procurement: null, allocation: null, shipping: null })
    expect(result.queueStates).toMatchObject({ review: 'ready', dispatch: 'unavailable', procurement: 'not_configured', allocation: 'not_configured', shipping: 'not_configured' })
    expect(result.tasks).toEqual([expect.objectContaining({ kind: 'review', count: 84 })])
  })
})

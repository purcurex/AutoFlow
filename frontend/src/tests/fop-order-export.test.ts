import { afterEach, describe, expect, it, vi } from 'vitest'
import api from '@/api'
import { exportFopOrders, fopExportError } from '@/api/fop-order-export'

vi.mock('@/api/index', () => ({ default: { post: vi.fn() } }))
describe('workbench export client', () => {
  afterEach(() => vi.resetAllMocks())
  it('sends only supported filters, no pagination or client identity, and supports cancellation', async () => {
    const file = new Blob(['xlsx'])
    vi.mocked(api.post).mockResolvedValue(file)
    const controller = new AbortController()
    const input = { queue: 'review' as const, mode: 'filtered' as const, search: 'A', warehouseCode: 'SZ', departmentId: 'd1', ownerId: 'employee-1', page: 2, userId: 'forged', orderIds: ['forged'] }
    expect(await exportFopOrders(input as unknown as Parameters<typeof exportFopOrders>[0], controller.signal)).toBe(file)
    const [path, body, options] = vi.mocked(api.post).mock.calls[0]!
    expect(path).toContain('fulfillment-orders/export')
    expect(body).toMatchObject({ queue: 'review', mode: 'filtered', search: 'A', warehouseCode: 'SZ', departmentId: 'd1', ownerId: 'employee-1' })
    for (const key of ['page', 'pageSize', 'userId', 'orderIds']) expect(body).not.toHaveProperty(key)
    expect(options).toMatchObject({ responseType: 'blob', signal: controller.signal })
  })
  it('decodes JSON failures returned as blobs and provides an actionable limit message', async () => {
    const error = { code: 'export_limit_exceeded' }
    const blob = new Blob([JSON.stringify(error)], { type: 'application/json' })
    // jsdom versions without Blob.text still exercise the browser decoding contract.
    Object.defineProperty(blob, 'text', { value: async () => JSON.stringify(error) })
    vi.mocked(api.post).mockRejectedValue(blob)
    await expect(exportFopOrders({ queue: 'review', mode: 'filtered' })).rejects.toEqual(error)
    expect(fopExportError(error, true)).toContain('10,000')
    expect(fopExportError(error, false)).toContain('50,000')
  })
})

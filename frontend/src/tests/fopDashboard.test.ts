import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFopDashboard } from '@/api/fop-dashboard'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/index', () => ({ default: { get } }))
describe('user-scoped dashboard provider', () => {
  const now = new Date('2026-10-21T12:00:00Z')
  beforeEach(() => { get.mockReset() })
  it('uses the authenticated backend for aggregates and excludes supplied scope identifiers', async () => {
    const response = { source: 'fop', queues: { review: 1 } }
    get.mockResolvedValue(response)
    expect(await getFopDashboard({ from: '2026-10-15', to: '2026-10-21', year: 2026, userId: 'forged' } as Parameters<typeof getFopDashboard>[0], now)).toEqual(response)
    expect(get).toHaveBeenCalledWith('/autoflow/integrations/fop/dashboard', { params: { from: '2026-10-15', to: '2026-10-21', year: 2026 } })
  })
  it('returns a permission failure instead of synthetic counts', async () => {
    get.mockRejectedValue({ code: 'fop_binding_required' })
    await expect(getFopDashboard({ from: '2026-10-15', to: '2026-10-21', year: 2026 }, now)).rejects.toEqual({ code: 'fop_binding_required' })
  })
  it.each([
    ['2026-10-22', '2026-10-21'], ['2026-02-30', '2026-03-01'], ['invalid', '2026-10-21'], ['2024-01-01', '2026-10-21'],
  ])('rejects invalid or unbounded date intervals (%s — %s)', async (from, to) => {
    await expect(getFopDashboard({ from, to, year: 2026 }, now)).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })
})

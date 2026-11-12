import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkbenchDashboardCounts } from '@/api/workbench-dashboard'
import { getFopDashboard, localDate } from '@/api/fop-dashboard'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/workbench-dashboard', async original => ({ ...await original<object>(), getWorkbenchDashboardCounts: vi.fn() }))
vi.mock('@/api/index', () => ({ default: { get } }))
describe('user-scoped dashboard provider', () => {
  const now = new Date('2026-10-21T12:00:00Z')
  beforeEach(() => { get.mockReset(); vi.mocked(getWorkbenchDashboardCounts).mockResolvedValue({ queues: { review: 1 } } as never) })
  it('uses the authenticated backend for aggregates and excludes supplied scope identifiers', async () => {
    const response = { source: 'fop', queues: { review: 1 } }
    get.mockResolvedValue(response)
    expect(await getFopDashboard({ from: '2026-10-15', to: '2026-10-21', year: 2026, userId: 'forged' } as Parameters<typeof getFopDashboard>[0], now)).toEqual(response)
    expect(get).toHaveBeenCalledWith('/autoflow/integrations/fop/dashboard', { params: { from: '2026-10-15', to: '2026-10-21', year: 2026, includeQueues: false }, timeout: 180000 })
  })
  it('uses UTC+8 for the day and year boundary even when the browser is in another timezone', async () => {
    const boundary = new Date('2026-12-31T16:01:00Z')
    expect(localDate(boundary)).toBe('2027-01-01')
    get.mockResolvedValue({ source: 'fop' })
    await expect(getFopDashboard({ from: '2027-01-01', to: '2027-01-01', year: 2027 }, boundary)).resolves.toEqual({ source: 'fop', queues: { review: 1 } })
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


it('keeps workbench counts when independent analytics fail', async () => {
  get.mockRejectedValue({ statusCode: 503 })
  vi.mocked(getWorkbenchDashboardCounts).mockResolvedValue({ queues: { review: 42 } } as never)
  const result = await getFopDashboard({ from: '2026-10-15', to: '2026-10-21', year: 2026 }, new Date('2026-10-21T12:00:00Z'))
  expect(result).toMatchObject({ queues: { review: 42 }, analyticsUnavailable: true, chartAccess: [] })
})

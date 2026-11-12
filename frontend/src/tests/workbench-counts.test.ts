import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWorkbenchCounts, getWorkbenchCount, rememberWorkbenchCount } from '@/utils/workbench-counts'
import { captureSession, invalidateSession } from '@/utils/session'

describe('shared workbench total cache', () => {
  beforeEach(() => { clearWorkbenchCounts(); vi.useRealTimers() })
  it('reuses total from any unfiltered page, not the number of displayed rows', async () => {
    rememberWorkbenchCount({ queue: 'review', page: 3, pageSize: 20 }, 125, captureSession())
    const load = vi.fn()
    expect(await getWorkbenchCount('review', load)).toBe(125)
    expect(load).not.toHaveBeenCalled()
  })
  it.each([{ search: 'SKU' }, { ownerId: 'employee' }, { departmentId: 'dept' }, { completed: true }, { shippingCountryCode: 'US' }, { warehouseStage: 'outbound_pending' }])('never poisons the card with a filtered total %j', async filters => {
    rememberWorkbenchCount({ queue: 'review', page: 1, pageSize: 20, ...filters } as never, 7, captureSession())
    expect(await getWorkbenchCount('review', async () => 100)).toBe(100)
  })
  it('deduplicates missing counts, keeps zero, and expires cached totals', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => 0)
    expect(await Promise.all([getWorkbenchCount('review', load), getWorkbenchCount('review', load)])).toEqual([0, 0])
    expect(load).toHaveBeenCalledTimes(1)
    await getWorkbenchCount('review', load)
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_001)
    await getWorkbenchCount('review', load)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('discards in-flight results and cached totals across a scope/session change', async () => {
    let resolve!: (value: number) => void
    const previous = getWorkbenchCount('review', () => new Promise<number>(done => { resolve = done }))
    const rejected = expect(previous).rejects.toThrow()
    await Promise.resolve()
    invalidateSession()
    resolve(123)
    await rejected
    expect(await getWorkbenchCount('review', async () => 4)).toBe(4)
  })
  it('does not turn failed or invalid responses into zero', async () => {
    await expect(getWorkbenchCount('review', async () => { throw new Error('offline') })).rejects.toThrow('offline')
    await expect(getWorkbenchCount('review', async () => -1)).rejects.toThrow()
    expect(await getWorkbenchCount('review', async () => 8)).toBe(8)
  })
})

it('does not overwrite a later workbench total with a slow cold-start response', async () => {
  const { beginWorkbenchCount } = await import('@/utils/workbench-counts')
  clearWorkbenchCounts()
  let finish!: (value: number) => void
  const slow = getWorkbenchCount('review', () => new Promise<number>(done => { finish = done }))
  await Promise.resolve()
  const remember = beginWorkbenchCount({ queue: 'review', page: 1, pageSize: 20 })!
  remember(19)
  finish(81)
  expect(await slow).toBe(19)
  expect(await getWorkbenchCount('review', async () => 99)).toBe(19)
})
it('does not resurrect a total after a newer workbench refresh fails', async () => {
  const { beginWorkbenchCount } = await import('@/utils/workbench-counts')
  clearWorkbenchCounts()
  let finish!: (value: number) => void
  const slow = getWorkbenchCount('review', () => new Promise<number>(done => { finish = done }))
  const rejected = expect(slow).rejects.toThrow('superseded')
  await Promise.resolve()
  beginWorkbenchCount({ queue: 'review', page: 1, pageSize: 20 })
  finish(81)
  await rejected
  expect(await getWorkbenchCount('review', async () => 19)).toBe(19)
})

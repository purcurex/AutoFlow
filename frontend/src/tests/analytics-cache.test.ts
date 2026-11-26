import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { analyticsQuery, clearAnalyticsCache, analyticsInterval, analyticsRefreshDelay } from '@/utils/analytics-cache'
import { invalidateSession } from '@/utils/session'
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/api/index', () => ({ default: { get } }))
const time = (s: string) => Date.parse(s + '+08:00')
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(time('2026-11-16T10:00:00')); clearAnalyticsCache(); get.mockReset(); get.mockResolvedValue({ cacheable: true, version: 'scope1' }) })
afterEach(() => vi.useRealTimers())
describe('analytics cache', () => {
 it('reuses canonical queries, clones values and forces a manual refresh', async () => {
  const fetch = vi.fn().mockResolvedValue({ rows: [1] })
  const first = await analyticsQuery<{ rows: number[] }>('/chart', { b: 2, a: 1 }, fetch)
  first.rows.push(2)
  expect(await analyticsQuery('/chart', { a: 1, b: 2, unused: undefined }, fetch)).toEqual({ rows: [1] })
  expect(fetch).toHaveBeenCalledTimes(1)
  await analyticsQuery('/chart', { a: 1, b: 2 }, fetch, { force: true })
  expect(fetch).toHaveBeenCalledTimes(2)
 })
 it('expires after 30 minutes at work and 2 hours outside work', async () => {
  const fetch = vi.fn().mockResolvedValue({})
  await analyticsQuery('/chart', {}, fetch)
  vi.setSystemTime(Date.now() + 30 * 60_000)
  await analyticsQuery('/chart', {}, fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(analyticsInterval(time('2026-11-16T09:00:00'))).toBe(30 * 60_000)
  expect(analyticsInterval(time('2026-11-16T18:00:00'))).toBe(120 * 60_000)
  expect(analyticsInterval(time('2026-11-21T10:00:00'))).toBe(30 * 60_000)
  expect(analyticsInterval(time('2026-11-22T09:00:00'))).toBe(30 * 60_000)
  expect(analyticsInterval(time('2026-11-22T08:59:59'))).toBe(120 * 60_000)
  expect(analyticsInterval(time('2026-11-22T18:00:00'))).toBe(120 * 60_000)
  expect(analyticsRefreshDelay(time('2026-11-16T08:00:00'), time('2026-11-16T08:55:00'))).toBe(5 * 60_000)
 })
 it('isolates scope, query and session; refuses cache when scope validation fails', async () => {
  const fetch = vi.fn().mockResolvedValue({})
  await analyticsQuery('/chart', { department: 'a' }, fetch)
  await analyticsQuery('/chart', { department: 'b' }, fetch)
  get.mockResolvedValue({ cacheable: true, version: 'scope2' })
  await analyticsQuery('/chart', { department: 'a' }, fetch)
  invalidateSession()
  await analyticsQuery('/chart', { department: 'a' }, fetch)
  expect(fetch).toHaveBeenCalledTimes(4)
  get.mockRejectedValue(new Error('denied'))
  await expect(analyticsQuery('/chart', { department: 'a' }, fetch)).rejects.toThrow('denied')
 })
 it('deduplicates requests and prevents older requests overwriting forced refresh', async () => {
  let finish!: (value: { value: string }) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ value: 'new' })
  const first = analyticsQuery('/chart', {}, fetch)
  const second = analyticsQuery('/chart', {}, fetch)
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(await analyticsQuery('/chart', {}, fetch, { force: true })).toEqual({ value: 'new' })
  finish({ value: 'old' }); expect(await Promise.all([first, second])).toEqual([{ value: 'old' }, { value: 'old' }])
  expect(await analyticsQuery('/chart', {}, fetch)).toEqual({ value: 'new' })
  expect(fetch).toHaveBeenCalledTimes(2)
 })
 it('never stores failures or responses from an expired session', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({})
  await expect(analyticsQuery('/chart', {}, fetch)).rejects.toThrow('offline')
  await analyticsQuery('/chart', {}, fetch)
  expect(fetch).toHaveBeenCalledTimes(2)
  let finish!: (value: object) => void
  const pending = analyticsQuery('/other', {}, () => new Promise(resolve => { finish = resolve }))
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  invalidateSession(); finish({})
  await expect(pending).rejects.toThrow('Session changed')
 })
})

it('separates comparison modes and dates while reusing an identical period query',async()=>{
 const fetch=vi.fn().mockResolvedValue({rows:[]})
 const base={from:'2026-11-01',to:'2026-11-12'}
 await analyticsQuery('/chart',base,fetch)
 await analyticsQuery('/chart',{...base,comparison:'week'},fetch)
 await analyticsQuery('/chart',{...base,comparison:'month'},fetch)
 await analyticsQuery('/chart',{...base,comparison:'week'},fetch)
 expect(fetch).toHaveBeenCalledTimes(3)
})

it('does not propagate another chart forced-refresh failure to an existing query',async()=>{
 let finish!:(value:object)=>void
 const first=analyticsQuery('/isolated',{},()=>new Promise(resolve=>{finish=resolve}))
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 await expect(analyticsQuery('/isolated',{},async()=>{throw Error('refresh failed')},{force:true})).rejects.toThrow('refresh failed')
 finish({value:'own result'})
 expect(await first).toEqual({value:'own result'})
})

it('identifies an in-flight permission revision change so charts discard the old display',async()=>{
 const {isWorkbenchScopeError}=await import('@/api/workbench-dashboard')
 get.mockResolvedValueOnce({cacheable:true,version:'scope1'}).mockResolvedValue({cacheable:true,version:'scope2'})
 const error=await analyticsQuery('/changed',{},async()=>({rows:['old']})).catch(error=>error)
 expect(isWorkbenchScopeError(error)).toBe(true)
 expect(error.code).toBe('chart_scope_changed')
})

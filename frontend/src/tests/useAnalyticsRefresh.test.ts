import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useAnalyticsRefresh } from '@/composables/useAnalyticsRefresh'
import { analyticsQuery, clearAnalyticsCache } from '@/utils/analytics-cache'
import { getAnalyticsCacheScope } from '@/api/analytics-cache-scope'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/analytics-cache-scope', () => ({ getAnalyticsCacheScope: vi.fn(async () => ({ cacheable: true, version: 'scope' })) }))
let hidden = false
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-16T09:00:00+08:00')); clearAnalyticsCache(); hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
async function setup(checkRevision = false) {
 const fetch = vi.fn(async () => ({ value: 1 }))
 let updates!: ReturnType<typeof useAnalyticsRefresh>
 const load = async () => { const result = await analyticsQuery('/chart', {}, fetch, { force: !checkRevision }); updates.updated(result) }
 const wrapper = mount(defineComponent({ setup() { updates = useAnalyticsRefresh(load, () => false, checkRevision); return () => null } }))
 await load(); await flushPromises()
 return { fetch, wrapper }
}
it('refreshes only at the work/off-work cadence and stops on unmount', async () => {
 const { fetch, wrapper } = await setup()
 await vi.advanceTimersByTimeAsync(29 * 60_000); expect(fetch).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(2)
 wrapper.unmount(); await vi.advanceTimersByTimeAsync(120 * 60_000); expect(fetch).toHaveBeenCalledTimes(2)
 vi.setSystemTime(new Date('2026-11-21T18:00:00+08:00'))
 const weekend = await setup()
 await vi.advanceTimersByTimeAsync(119 * 60_000); expect(weekend.fetch).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(60_000); expect(weekend.fetch).toHaveBeenCalledTimes(2)
 weekend.wrapper.unmount()
})
it('suspends hidden tabs, refreshes overdue data on return, and stops on logout', async () => {
 const { fetch, wrapper } = await setup()
 hidden = true; document.dispatchEvent(new Event('visibilitychange'))
 await vi.advanceTimersByTimeAsync(120 * 60_000); expect(fetch).toHaveBeenCalledTimes(1)
 hidden = false; document.dispatchEvent(new Event('visibilitychange'))
 await vi.advanceTimersByTimeAsync(1000); expect(fetch).toHaveBeenCalledTimes(2)
 invalidateSession(); await vi.advanceTimersByTimeAsync(120 * 60_000); expect(fetch).toHaveBeenCalledTimes(2)
 wrapper.unmount()
})
it('switches to the work cadence at 09:00 without waiting out the old 2-hour period', async () => {
 vi.setSystemTime(new Date('2026-11-16T08:00:00+08:00'))
 const { fetch, wrapper } = await setup()
 await vi.advanceTimersByTimeAsync(60 * 60_000 + 1000)
 expect(fetch).toHaveBeenCalledTimes(2)
 wrapper.unmount()
})

it.each(['2026-11-21', '2026-11-22'])('refreshes every 30 minutes during daytime on %s', async day => {
 vi.setSystemTime(new Date(`${day}T09:00:00+08:00`))
 const { fetch, wrapper } = await setup()
 await vi.advanceTimersByTimeAsync(29 * 60_000); expect(fetch).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(2)
 wrapper.unmount()
})

it('checks local revisions without repeating aggregates while the result is fresh', async () => {
 const { fetch, wrapper } = await setup(true)
 await vi.advanceTimersByTimeAsync(5 * 60_000)
 expect(fetch).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(25 * 60_000)
 expect(fetch).toHaveBeenCalledTimes(2)
 wrapper.unmount()
})

it('reloads after a data revision changes without waiting for the aggregate TTL', async () => {
 const { fetch, wrapper } = await setup(true)
 vi.mocked(getAnalyticsCacheScope).mockResolvedValue({cacheable:true,version:'published-new'})
 await vi.advanceTimersByTimeAsync(60_000)
 expect(fetch).toHaveBeenCalledTimes(2)
 wrapper.unmount()
 vi.mocked(getAnalyticsCacheScope).mockResolvedValue({cacheable:true,version:'scope'})
})

import { beforeEach, expect, it, vi } from 'vitest'
import { getLocalDashboardAnalytics, getLocalDashboardTrend } from '@/api/local-dashboard-analytics'
import { getFopFreight, getFopFreightDetails } from '@/api/fop-freight'
import { getOrderVolume, getOrderVolumeDetails } from '@/api/fop-order-volume'
import { getSalesPerformance } from '@/api/fop-sales-performance'
import { getFopDashboardCharts } from '@/api/fop-dashboard'
import { clearAnalyticsCache, type AnalyticsQueryOptions } from '@/utils/analytics-cache'
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/api/index', () => ({ default: { get } }))
beforeEach(() => {
 clearAnalyticsCache()
 get.mockReset().mockImplementation(async (url: string) => url.endsWith('/cache-scope') ? { cacheable: true, version: 'account-scope' } : { rows: [], endpoint: url })
})
const charts: Array<[string, (options?: AnalyticsQueryOptions) => Promise<unknown>]> = [
 ['/workbench/analytics/dashboard/trend', options => getLocalDashboardTrend({ chartId: 'order_volume', from: '2026-11-01', to: '2026-11-16', dimension: 'person', id: 'employee-1', grain: 'day' }, options)],
 ['/workbench/analytics/dashboard', options => getLocalDashboardAnalytics({ chartId: 'order_volume', from: '2026-11-01', to: '2026-11-16' }, options)],
 ['/autoflow/integrations/fop/freight', options => getFopFreight({ grain: 'month', year: 2026, warehouse: 'ALL' }, options)],
 ['/autoflow/integrations/fop/order-volume', options => getOrderVolume({ category: 'customer', warehouse: 'ALL', from: '2026-11-01', to: '2026-11-16' }, options)],
 ['/autoflow/integrations/fop/sales-performance', options => getSalesPerformance({ grain: 'month', from: '2026-11-01', to: '2026-11-16' }, options)],
 ['/autoflow/integrations/fop/dashboard', options => getFopDashboardCharts({ year: 2026, from: '2026-11-01', to: '2026-11-16' }, options)],
]
it.each(charts)('%s reuses aggregates when switching and queries again on manual force', async (endpoint, load) => {
 const first = await load(); expect(await load()).toEqual(first)
 expect(get.mock.calls.filter(([url]) => url === endpoint)).toHaveLength(1)
 await load({ force: true })
 expect(get.mock.calls.filter(([url]) => url === endpoint)).toHaveLength(2)
})
it('does not apply chart caching to drilldown lists', async () => {
 const freight = { grain: 'month' as const, year: 2026, warehouse: 'ALL' as const, workbenchRole: 'dispatch' as const, page: 1, pageSize: 20 }
 const orders = { category: 'customer' as const, warehouse: 'ALL' as const, workbenchRole: 'sales' as const, page: 1, pageSize: 20 }
 await getFopFreightDetails(freight); await getFopFreightDetails(freight)
 await getOrderVolumeDetails(orders); await getOrderVolumeDetails(orders)
 expect(get).toHaveBeenCalledTimes(4)
 expect(get.mock.calls.some(([url]) => url.endsWith('/cache-scope'))).toBe(false)
})

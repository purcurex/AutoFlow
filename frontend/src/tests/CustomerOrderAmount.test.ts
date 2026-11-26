import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import LocalDashboardAnalytics from '@/components/charts/LocalDashboardAnalytics.vue'
import { comparisonChart } from '@/utils/analytics-comparison'
import type { AnalyticsRow, LocalAnalyticsResult } from '@/api/local-dashboard-analytics'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/local-dashboard-analytics', () => ({ getLocalDashboardAnalytics: get, getLocalDashboardTrend: vi.fn() }))
vi.mock('@/utils/session', async original => ({ ...await original<object>(), onSessionReset: () => () => {} }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option'], template: '<div />' } }))
vi.mock('@/components/charts/AnalyticsTrendDialog.vue', () => ({ default: { name: 'AnalyticsTrendDialog', props: ['metric', 'metricLabel', 'query'], template: '<div />' } }))
const row = (id: string, amount: string, orderCount: number): AnalyticsRow => ({ dimension: 'customer', id, label: id, currency: 'USD', amount, orderCount, quantity: '1', customerOwnerName: 'Alex', customerDepartmentName: '业务一部' })
const data = (): LocalAnalyticsResult => ({ source: 'local', chartId: 'customer_orders', asOf: '2026-11-25T00:00:00Z', summaryOnly: false, rows: [row('many', '50.25', 40), row('valuable', '1000.00', 2)], orderCount: 42, amountsByCurrency: [{ currency: 'USD', amount: '1050.25', orderCount: 42 }], currencies: ['USD'], departments: [], warehouses: [], missingCurrencyCount: 0, missingAmountCount: 0, missingPaidAtCount: 0 })
afterEach(() => vi.clearAllMocks())

it('ranks customer bars by dollars and keeps order counts as supporting data', async () => {
  get.mockResolvedValue(data())
  const w = mount(LocalDashboardAnalytics, { props: { chartId: 'customer_orders', title: '客户订单分析' } })
  await flushPromises()
  const chart = w.findComponent({ name: 'EChart' }).props('option')
  expect(chart.xAxis.data).toEqual(['valuable', 'many'])
  expect(chart.series[0].data).toEqual([1000, 50.25])
  expect(chart.yAxis.axisLabel.formatter(1000)).toBe('$1,000.00')
  expect(chart.yAxis.name).toBeUndefined()
  expect(chart.tooltip.formatter([{ dataIndex: 0, seriesIndex: 0, value: 1000 }])).toContain('订单金额：$1,000.00')
  expect(chart.tooltip.formatter([{ dataIndex: 0, seriesIndex: 0, value: 1000 }])).toContain('订单数：2')
  expect(w.find('.income-total').text()).toContain('订单金额合计')
  expect(w.find('.income-total').text()).toContain('$1,050.25')
  expect(w.find('.analysis-controls').text()).toContain('42 笔')
  expect(w.findAll('.analysis-controls select')).toHaveLength(1)
  expect(w.find('[aria-label="订单类型"]').exists()).toBe(true)
  await w.find('.trend-open').trigger('click')
  expect(w.findComponent({ name: 'AnalyticsTrendDialog' }).props('metric')).toBe('amount')
  w.unmount()
})

it.each(['person', 'month'])('uses amounts for the %s dimension and dollar ticks', async dimension => {
  get.mockResolvedValue({ ...data(), rows: data().rows.map(r => ({ ...r, dimension })) })
  const w = mount(LocalDashboardAnalytics, { props: { chartId: 'customer_orders', title: '客户订单分析' } })
  await flushPromises()
  await w.get('[aria-label="展示维度"]').setValue(dimension)
  const chart = w.findComponent({ name: 'EChart' }).props('option')
  expect(chart.series[0].data).toEqual(dimension === 'month' ? [50.25, 1000] : [1000, 50.25])
  expect(chart.yAxis.axisLabel.formatter(50.25)).toBe('$50.25')
  expect(chart.tooltip.formatter([{ dataIndex: 0, seriesIndex: 0, value: dimension === 'month' ? 50.25 : 1000 }])).toContain('笔')
  w.unmount()
})

it('compares customer amounts while retaining both periods order counts', () => {
  const d = data()
  d.comparison = { available: true, mode: 'week', current: { from: '2026-11-16', to: '2026-11-22', start: '', end: '' }, previous: { from: '2026-11-09', to: '2026-11-15', start: '', end: '' }, previousData: { ...data(), rows: [row('valuable', '500.00', 10)] }, metrics: [] }
  const chart = comparisonChart(d, 'customer', 'orders', true)!
  expect(chart.series[1]!.data).toEqual([1000, 50.25])
  const text = chart.tooltip.formatter([{ dataIndex: 0, seriesIndex: 0, value: 500, seriesName: '上期' }, { dataIndex: 0, seriesIndex: 1, value: 1000, seriesName: '本期' }])
  expect(text).toContain('本期订单金额：$1,000.00')
  expect(text).toContain('本期订单数：2')
  expect(text).toContain('上期订单数：10')
  expect(text).toContain('金额环比：+100.00%')
})

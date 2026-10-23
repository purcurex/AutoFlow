import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrderVolumeAnalysis from '@/components/order-volume/OrderVolumeAnalysis.vue'
import FreightAnalysis from '@/components/freight/FreightAnalysis.vue'
import SalesPerformanceView from '@/views/autoflow/SalesPerformanceView.vue'
import { invalidateSession } from '@/utils/session'
const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/api/index', () => ({ default: { get } }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option', 'label'], template: '<div />' } }))
async function setup(component: typeof OrderVolumeAnalysis, props = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/')
  const wrapper = mount(component, { props, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises()
  return wrapper
}
beforeEach(() => { get.mockReset().mockImplementation(async url => { if (!url.endsWith('/chart-access')) throw new Error('Chart data requested before authorization'); return { source: 'mock', businessScope: { role: 'salesperson', employeeId: 'self', departmentId: null }, charts: [] } }) })
describe('chart capability boundaries', () => {
  it.each([
    [OrderVolumeAnalysis, {}, '业务订单量分析'],
    [OrderVolumeAnalysis, { customer: true }, '客户订单分析'],
    [FreightAnalysis, {}, '物流运费分析'],
    [SalesPerformanceView, {}, '个人收款与毛利'],
  ] as const)('fails closed before fetching or rendering a chart with missing metadata (%s)', async (component, props, title) => {
    const wrapper = await setup(component as typeof OrderVolumeAnalysis, props)
    expect(get.mock.calls.map(call => call[0])).toEqual(['/autoflow/integrations/fop/chart-access'])
    expect(wrapper.text()).not.toContain(title)
    wrapper.unmount()
  })
  it('does not dispatch a delayed authorization result from a previous session', async () => {
    let resolve!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const wrapper = await setup(OrderVolumeAnalysis)
    invalidateSession()
    resolve({ charts: [{ chartId: 'order_volume', visible: true, dataScope: 'self', canViewDetails: true, canExport: true, scopeLabel: '本人', summaryOnly: false, summaryDepartments: [] }] })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('业务订单量分析')
    wrapper.unmount()
  })
})

const allowedChart = { chartId: 'order_volume', visible: true, dataScope: 'self', scopeLabel: '仅本人', canViewDetails: false, canExport: false, summaryOnly: false, summaryDepartments: [] }
const orderData = { chartAccess: allowedChart, source: 'mock', query: { category: 'organization', grain: 'month', year: 2026, warehouse: 'ALL' }, timeZone: 'Asia/Shanghai', asOf: '2026-10-22T00:00:00Z', total: 3, customerCount: 1, periods: [{ id: '2026-10', label: '10月', from: '2026-10-01', to: '2026-10-22', future: false }], series: [{ id: 'total', label: '合计', kind: 'total', total: 3, values: [3], warehouses: { HZ: [3], SZ: [0], UNASSIGNED: [0] } }], options: { departments: [], objects: [] } }
it('renders counts while disabling every underlying order detail action', async () => {
  get.mockImplementation(async (url, config) => url.endsWith('/chart-access') ? { charts: [allowedChart] } : { ...orderData, query: config.params })
  const wrapper = await setup(OrderVolumeAnalysis)
  expect(wrapper.text()).toContain('仅本人')
  const details = wrapper.findAll('button').filter(button => button.text().includes('订单') || button.element.closest('.ov-period-table'))
  expect(details.length).toBeGreaterThan(0)
  expect(details.every(button => button.attributes('disabled') !== undefined)).toBe(true)
  wrapper.unmount()
})
it('requests independent organization summaries and prevents employee-specific categories', async () => {
  get.mockImplementation(async (url, config) => url.endsWith('/chart-access') ? { charts: [{ ...allowedChart, summaryOnly: true, dataScope: 'none', summaryDepartments: ['sales2'] }] } : { ...orderData, chartAccess: { ...allowedChart, summaryOnly: true, dataScope: 'none', summaryDepartments: ['sales2'] }, query: config.params })
  const wrapper = await setup(OrderVolumeAnalysis)
  expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/order-volume', { params: expect.objectContaining({ category: 'organization', view: 'summary' }) })
  expect(wrapper.get('[aria-label="订单量查询类别"]').findAll('option').map(option => option.attributes('value'))).toEqual(['organization'])
  wrapper.unmount()
})
it('removes previously visible data and dialogs after a capability is revoked', async () => {
  get.mockImplementation(async (url, config) => url.endsWith('/chart-access') ? { charts: [allowedChart] } : { ...orderData, query: config.params })
  const wrapper = await setup(OrderVolumeAnalysis)
  expect(wrapper.find('table').exists()).toBe(true)
  get.mockClear().mockResolvedValue({ charts: [{ ...allowedChart, visible: false }] })
  await wrapper.get('.ov-filters').trigger('submit'); await flushPromises()
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('业务订单量分析')
  expect(get.mock.calls.map(call => call[0])).toEqual(['/autoflow/integrations/fop/chart-access'])
  wrapper.unmount()
})

it('applies the statistics response capabilities when grants change between authorization and query', async () => {
  get.mockImplementation(async (url, config) => url.endsWith('/chart-access') ? { charts: [{ ...allowedChart, canViewDetails: true, canExport: true, scopeLabel: '原部门范围' }] } : { ...orderData, query: config.params, chartAccess: { ...allowedChart, scopeLabel: '已缩小到本人' } })
  const wrapper = await setup(OrderVolumeAnalysis)
  expect(wrapper.text()).toContain('已缩小到本人')
  expect(wrapper.text()).not.toContain('原部门范围')
  const button = wrapper.findAll('button').find(button => button.text().includes('查看订单明细'))!
  expect(button.attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('clears the ranking when a customer search response reports revoked access', async () => {
  const customerAccess = { ...allowedChart, chartId: 'customer_orders' }
  get.mockImplementation(async (url, config) => url.endsWith('/chart-access') ? { charts: [customerAccess] } : url.endsWith('/customers') ? { chartAccess: { ...customerAccess, visible: false }, items: [], total: 0, page: 1, pageSize: 10, source: 'mock' } : { ...orderData, chartAccess: customerAccess, query: config.params })
  const wrapper = await setup(OrderVolumeAnalysis, { customer: true })
  expect(wrapper.find('table').exists()).toBe(true)
  await wrapper.get('input[aria-label="客户名称或编码"]').setValue('C1')
  await wrapper.get('.ov-customer-search form').trigger('submit'); await flushPromises()
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('客户订单分析')
  wrapper.unmount()
})

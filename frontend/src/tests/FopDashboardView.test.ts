import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FopDashboardView from '@/views/autoflow/FopDashboardView.vue'
import { chartAccessFixture } from './chart-access-fixtures'
import { getFopDashboard, type FopDashboardData } from '@/api/fop-dashboard'

vi.mock('@/composables/useWorkbenchAccess', () => ({ refreshWorkbenchAccess: vi.fn().mockResolvedValue({ roles: ['allocation'] }) }))
vi.mock('@/components/order-volume/OrderVolumeAnalysis.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/freight/FreightAnalysis.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option', 'label'], template: '<div class="chart-stub" />' } }))
vi.mock('@/api/fop-dashboard', async importOriginal => ({ ...await importOriginal<object>(), getFopDashboard: vi.fn() }))
const sample: FopDashboardData = {
  chartAccess: chartAccessFixture().charts, departmentReceipts: { currency: 'USD', months: [], departments: [] },
  source: 'fop', updatedAt: '2026-10-21T12:00:00Z',
  queues: { procurement: 5, review: 1, allocation: 2, dispatch: 3, shipping: 4 }, rates: [], registrations: [],
  exceptions: [{ id: 'AUTHORIZED-ORDER', customer: 'My customer', reason: 'stock', hours: 10 }],
  tasks: [{ id: 'allocation', kind: 'allocation', count: 2, time: '', priority: 'normal' }],
  receipts: { currency: 'USD', months: [], departments: [] },
}
function dashboardFixture(data: FopDashboardData): FopDashboardData { return { ...data, departmentReceipts: { ...data.receipts, departments: data.receipts.departments.map(item => ({ ...item, salespeople: [] })) } } }
function mountView() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/workbench/:role/receipts', name: 'RoleWorkbenchReceipts', component: { template: '<div />' } }] })
  return mount(FopDashboardView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: RouterLinkStub } } })
}
describe('FOP Dashboard interactions', () => {
  beforeEach(() => { vi.mocked(getFopDashboard).mockReset().mockResolvedValue(dashboardFixture(structuredClone(sample))) })
  it('independently switches department and salesperson charts to signed monthly changes, including December baselines', async () => {
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture({ ...sample, receipts: { currency: 'USD', previousMonth: '2025-12', months: ['2026-01', '2026-02', '2026-03'],
      marketingCenter: { id: 'marketing', name: '营销中心', previousAmount: 80, amounts: [100, 50, 0] },
      departments: [{ id: 'sales1', name: '业务一部', previousAmount: 80, amounts: [100, 50, 0], salespeople: [
        { id: 'a', name: 'Ruth', previousAmount: 80, amounts: [100, 0, 0] },
        { id: 'b', name: 'Coco', previousAmount: 0, amounts: [0, 50, 0] },
      ] }],
    } } as FopDashboardData))
    const wrapper = mountView(); await flushPromises()
    const department = wrapper.find('.receipts-panel'), salesperson = wrapper.find('.salesperson-panel')
    const departmentDetails = department.find('details'), salespersonDetails = salesperson.find('details')
    expect((departmentDetails.element as HTMLDetailsElement).open).toBe(false)
    // A user may have manually collapsed either list before switching modes.
    ;(salespersonDetails.element as HTMLDetailsElement).open = false
    await salespersonDetails.trigger('toggle')
    const charts = () => wrapper.findAllComponents({ name: 'EChart' })
    expect(wrapper.find('h1').text()).toContain('Dashboard')
    expect(department.find('h2').text()).toContain('部门月度回款分析')
    expect(salesperson.find('h2').text()).toContain('业务员月度回款分析')
    expect(department.find('[aria-label="部门回款上月环比"]').exists()).toBe(true)
    await department.find('[aria-label="部门回款上月环比"]').setValue(true)
    expect((departmentDetails.element as HTMLDetailsElement).open).toBe(true)
    expect((salespersonDetails.element as HTMLDetailsElement).open).toBe(false)
    expect(charts()[0]!.props('option').series[0].data).toEqual([20, -50, -50])
    expect(charts()[1]!.props('option').series[0].data).toEqual([100, 50, 0])
    expect(department.findAll('tbody tr').at(-1)!.text()).toContain('+$20.00')
    expect(department.findAll('tbody tr').at(-1)!.text()).toContain('+25.00%')
    expect(department.findAll('tbody tr')[1]!.text()).toContain('-50.00%')
    expect(department.find('tfoot').text()).toContain('-$80.00')
    // Weighted rate = sum(delta) / sum(previous), never a sum of percentages.
    expect(department.find('tfoot').text()).toContain('-34.78%')
    const tooltip = charts()[0]!.props('option').tooltip.formatter([{ seriesIndex: 0, dataIndex: 0 }])
    expect(tooltip).toContain('+$20.00'); expect(tooltip).toContain('+25.00%')
    await salesperson.find('[aria-label="业务员回款上月环比"]').setValue(true)
    expect((salespersonDetails.element as HTMLDetailsElement).open).toBe(true)
    expect(charts()[1]!.props('option').series[1].data).toEqual([20, -100, 0])
    const rows = salesperson.findAll('tbody tr')
    expect(rows[1]!.text()).toContain('上月为0')
    expect(rows[0]!.text()).toContain('0.00%')
    expect(rows[0]!.text()).toContain('-100.00%')
    await department.find('[aria-label="部门回款上月环比"]').setValue(false)
    expect((departmentDetails.element as HTMLDetailsElement).open).toBe(true)
    expect(charts()[0]!.props('option').series[0].data).toEqual([100, 50, 0])
    expect(charts()[1]!.props('option').series[0].data).toEqual([20, -50, -50])
    await salesperson.find('[aria-label="业务员回款上月环比"]').setValue(false)
    expect((salespersonDetails.element as HTMLDetailsElement).open).toBe(true)
    // Manual collapse remains available; enabling MoM reveals the list again.
    ;(departmentDetails.element as HTMLDetailsElement).open = false
    await departmentDetails.trigger('toggle')
    await department.find('[aria-label="部门回款上月环比"]').setValue(true)
    expect((departmentDetails.element as HTMLDetailsElement).open).toBe(true)
    wrapper.unmount()
  })
  it('links fulfillment cards and tasks to workbenches, and exceptions to an authorized order', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('待履约')
    expect(wrapper.text()).not.toContain('待打单')
    expect(wrapper.text()).toContain('采购未完成付款 / 已采购未发货')
    expect(wrapper.text()).not.toContain('采购下单 / 采购付款待完成')
    expect(wrapper.text()).not.toContain('MOCK')
    expect(wrapper.findAll('.card-top span').map(node => node.text())).toEqual(['待审核', '待履约', '待采购', '待配货', '待出库'])
    const links = wrapper.findAllComponents(RouterLinkStub)
    for (const queue of ['review', 'dispatch', 'procurement', 'allocation', 'shipping']) {
      const role = ({ review: 'sales', procurement: 'procurement', allocation: 'allocation', dispatch: 'dispatch', shipping: 'warehouse' } as Record<string, string>)[queue]
      expect(links.some(link => { const to = link.props('to'); return typeof to !== 'string' && to.name === 'RoleWorkbench' && to.params?.role === role && to.query?.queue === queue })).toBe(true)
    }
    expect(links.some(link => { const to = link.props('to'); return typeof to !== 'string' && to.query?.orderNumber === 'AUTHORIZED-ORDER' })).toBe(true)
    expect(wrapper.text()).toContain('暂无可查看的回款统计')
    wrapper.unmount()
  })
  it('opens a monthly salesperson amount as authorized receipt details and shows its source breakdown', async () => {
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture({ ...sample, receipts: { currency: 'USD', months: ['2026-02'], departments: [{ id: 'sales1', name: '业务一部', amounts: [125], breakdown: { fulfillment: [25], fullPaymentStock: [100] }, salespeople: [{ id: 'alice', name: 'Alice', amounts: [125], breakdown: { fulfillment: [25], fullPaymentStock: [100] } }] }] } }))
    const wrapper = mountView(); await flushPromises()
    const cell = wrapper.findAll('.salesperson-panel tbody td')[2]!
    expect(cell.find('button').exists()).toBe(true)
    expect(cell.find('button').attributes('title')).toContain('全款备货 $100.00')
    await cell.find('button').trigger('click'); await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.name).toBe('RoleWorkbenchReceipts')
    expect(wrapper.vm.$router.currentRoute.value.params.role).toBe('allocation')
    expect(wrapper.vm.$router.currentRoute.value.query).toMatchObject({ from: '2026-02-01', to: '2026-02-28', department: 'sales1', ownerId: 'alice', warehouse: 'ALL' })
    wrapper.unmount()
  })
  it('keeps department chart amounts as summaries without opening receipt records', async () => {
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture({ ...sample, receipts: { currency: 'USD', months: ['2026-02'], departments: [{ id: 'sales1', name: '业务一部', amounts: [125], salespeople: [] }] } }))
    const wrapper = mountView(); await flushPromises()
    wrapper.findAllComponents({ name: 'EChart' })[0]!.vm.$emit('select', { seriesId: 'sales1', dataIndex: 0 })
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query).toEqual({})
    expect(wrapper.vm.$router.currentRoute.value.query).not.toHaveProperty('ownerId')
    wrapper.unmount()
  })
  it('clamps current-month receipt links to today in UTC+8', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T16:05:00Z'))
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture({ ...sample, receipts: { currency: 'USD', months: ['2026-10'], departments: [{ id: 'sales1', name: '业务一部', amounts: [125], salespeople: [] }] } }))
    const wrapper = mountView()
    try {
      await flushPromises()
      await wrapper.find('.salesperson-panel tbody button').trigger('click'); await flushPromises()
      expect(wrapper.vm.$router.currentRoute.value.query).toMatchObject({ from: '2026-10-01', to: '2026-10-22' })
    } finally { wrapper.unmount(); vi.useRealTimers() }
  })
  it('waits for capabilities before exposing filters and labels results with the submitted query', async () => {
    let resolve!: (value: FopDashboardData) => void
    vi.mocked(getFopDashboard).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const wrapper = mountView()
    const submitted = vi.mocked(getFopDashboard).mock.calls[0]![0]
    expect(wrapper.findAll('input[type=date]')).toHaveLength(0)
    resolve({ ...sample, registrations: [{ date: submitted.from, count: 1 }] }); await flushPromises()
    expect(wrapper.find('.registration-panel .chart-summary').text()).toContain(`${submitted.from} — ${submitted.to}`)
    expect(wrapper.find('.receipts-panel .panel-top p').text()).toContain(String(submitted.year))
    wrapper.unmount()
  })
  it('forwards date and year filters to the authorized aggregate provider', async () => {
    const wrapper = mountView()
    await flushPromises()
    const end = (wrapper.findAll('input[type=date]')[1]!.element as HTMLInputElement).value
    await wrapper.findAll('input[type=date]')[0]!.setValue(end)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(getFopDashboard).toHaveBeenLastCalledWith({ from: end, to: end, year: new Date().getFullYear() })
    await wrapper.find('select[aria-label="回款年份"]').setValue(String(new Date().getFullYear() - 1))
    await flushPromises()
    expect(getFopDashboard).toHaveBeenLastCalledWith({ from: end, to: end, year: new Date().getFullYear() - 1 })
    wrapper.unmount()
  })
  it('renders mock analytics using API department names and registration values', async () => {
    vi.mocked(getFopDashboard).mockResolvedValueOnce(dashboardFixture({ ...sample, source: 'mock',
      registrations: [{ date: '2026-10-20', count: 21 }, { date: '2026-10-21', count: 34 }],
      rates: [{ currency: 'USD', cnyPerUnit: 7.12 }],
      receipts: { currency: 'USD', months: ['2026-10'], departments: [{ id: 'sales1', name: '业务一部', amounts: [12345], salespeople: [{ id: 'alice', name: '林知远', amounts: [12345] }] }] },
    }))
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('MOCK · DEMO')
    const charts = wrapper.findAllComponents({ name: 'EChart' })
    expect(charts[0]!.props('option').series[0].data).toEqual([21, 34])
    expect(charts[1]!.props('option').series[0]).toMatchObject({ name: '业务一部', data: [12345] })
    expect(wrapper.text()).not.toContain('统计接口待接通')
    wrapper.unmount()
  })
  it('adds per-column receipt total rows without adding department totals to member totals', async () => {
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture({ ...sample, receipts: { currency: 'USD', months: ['2026-01', '2026-02'], marketingCenter: { id: 'marketing', name: '营销中心', amounts: [0.1, 0.2] }, departments: [
      { id: 'sales1', name: '业务一部', amounts: [0.1, 0.2], salespeople: [{ id: 'a', name: 'Ruth', amounts: [0.1, 0.1] }, { id: 'b', name: 'Coco', amounts: [0, 0.1] }] },
      { id: 'sales2', name: '业务二部', amounts: [0, 0], salespeople: [] },
    ] } }))
    const wrapper = mountView(); await flushPromises()
    const footers = wrapper.findAll('.receipts-panel tfoot')
    expect(footers).toHaveLength(2)
    expect(footers[0]!.findAll('td').map(c => c.text())).toEqual(['$0.30', '$0.30', '$0.00'])
    expect(footers[1]!.findAll('td').map(c => c.text())).toEqual(['$0.30', '$0.20', '$0.10'])
    await wrapper.find('select[aria-label="业务员回款部门"]').setValue('sales2')
    expect(wrapper.find('.salesperson-panel tfoot').text()).toContain('$0.00')
    expect(wrapper.find('.salesperson-panel tfoot').text()).not.toContain('$0.30')
    wrapper.unmount()
  })

  it('shows only the selected department’s salespeople and retains that selection when the year changes', async () => {
    const dashboard: FopDashboardData = { ...sample, receipts: { currency: 'USD', months: ['2026-01', '2026-02'], departments: [
      { id: 'sales1', name: '业务一部', amounts: [30, 45], salespeople: [{ id: 'a', name: '林知远', amounts: [10, 20] }, { id: 'b', name: '许清和', amounts: [20, 25] }] },
      { id: 'sales2', name: '业务二部', amounts: [50, 60], salespeople: [{ id: 'c', name: '周雨桐', amounts: [50, 60] }] },
      { id: 'sales3', name: '业务三部', amounts: [0, 0], salespeople: [] },
      { id: 'sales4', name: '业务四部', amounts: [0, 0], salespeople: [] },
    ] } }
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture(dashboard))
    const wrapper = mountView()
    await flushPromises()
    const employeeChart = () => wrapper.findAllComponents({ name: 'EChart' }).find(chart => chart.props('label') === '业务员月度回款对比柱状图')!
    expect(employeeChart().props('option').series.map((series: {name: string}) => series.name)).toEqual(['业务一部 · 当前成员合计', '林知远', '许清和'])
    const filter = wrapper.find('select[aria-label="业务员回款部门"]')
    expect(filter.findAll('option').map(option => option.text())).toEqual(['业务一部', '业务二部', '业务三部', '业务四部'])
    await filter.setValue('sales2')
    expect(employeeChart().props('option').series).toEqual([expect.objectContaining({ name: '业务二部 · 当前成员合计', data: [50, 60] }), expect.objectContaining({ name: '周雨桐', data: [50, 60] })])
    expect(wrapper.find('.salesperson-panel .receipt-summary strong').text()).toBe('$110.00')
    expect(wrapper.find('.salesperson-panel table').text()).toContain('业务二部 · 当前成员合计')
    expect(wrapper.find('.salesperson-panel table').text()).not.toContain('林知远')
    expect(employeeChart().props('option').series.every((series: { stack?: string }) => !series.stack)).toBe(true)
    expect(getFopDashboard).toHaveBeenCalledTimes(1)
    await wrapper.find('select[aria-label="回款年份"]').setValue(String(new Date().getFullYear() - 1))
    await flushPromises()
    expect((filter.element as HTMLSelectElement).value).toBe('sales2')
    await filter.setValue('sales3')
    expect(employeeChart().props('option').series).toEqual([expect.objectContaining({ name: '业务三部 · 当前成员合计', data: [0, 0] })])
    expect(wrapper.text()).toContain('该部门在所选年份暂无业务员回款数据')
    await filter.setValue('sales1')
    vi.mocked(getFopDashboard).mockRejectedValueOnce({ code: 'fop_binding_required' })
    await wrapper.find('button.refresh-button').trigger('click')
    await flushPromises()
    expect(employeeChart()).toBeUndefined()
    expect(wrapper.text()).not.toContain('林知远')
    wrapper.unmount()
  })
  it('switches registration dimensions within the applied date range and clears them on revocation', async () => {
    const payload: FopDashboardData = { ...sample, registrations: [{ date: '2026-10-20', count: 12 }, { date: '2026-10-21', count: 18 }], registrationDepartments: [
      { id: 'sales1', name: '业务一部', counts: [5, 8], salespeople: [{ id: 'a', name: '林知远', counts: [2, 3] }, { id: 'b', name: '许清和', counts: [3, 5] }] },
      { id: 'sales2', name: '业务二部', counts: [7, 10], salespeople: [{ id: 'c', name: '周雨桐', counts: [7, 10] }] },
      { id: 'sales3', name: '业务三部', counts: [0, 0], salespeople: [] },
      { id: 'sales4', name: '业务四部', counts: [0, 0], salespeople: [] },
    ] }
    vi.mocked(getFopDashboard).mockResolvedValue(dashboardFixture(payload))
    const wrapper = mountView()
    await flushPromises()
    const chart = () => wrapper.findAllComponents({ name: 'EChart' }).find(item => item.props('label') === '每日注册会员趋势图')!
    expect(wrapper.find('.registration-panel').findAll('select')).toHaveLength(1)
    expect(wrapper.find('[aria-label="注册统计维度"]').findAll('option').map(item => item.text())).toEqual(['营销中心', '业务一部', '业务二部', '业务三部', '业务四部'])
    expect(chart().props('option').series.map((item: {name: string}) => item.name)).toEqual(['当前成员合计', '业务一部', '业务二部', '业务三部', '业务四部'])
    expect(wrapper.find('.chart-summary strong').text()).toBe('30')
    await wrapper.find('[aria-label="注册统计维度"]').setValue('sales1')
    expect(chart().props('option').series.map((item: {name: string}) => item.name)).toEqual(['业务一部 · 当前成员合计', '林知远', '许清和'])
    expect(wrapper.find('.registration-data-list').text()).toContain('业务一部 · 当前成员合计')
    expect(wrapper.find('.registration-data-list').text()).toContain('13')
    expect(wrapper.find('.registration-data-list').find('details').exists()).toBe(false)
    await wrapper.find('[aria-label="注册统计维度"]').setValue('sales2')
    expect(chart().props('option').series).toEqual([expect.objectContaining({ name: '业务二部 · 当前成员合计', data: [7, 10] }), expect.objectContaining({ name: '周雨桐', data: [7, 10] })])
    expect(wrapper.find('.chart-summary strong').text()).toBe('17')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect((wrapper.find('[aria-label="注册统计维度"]').element as HTMLSelectElement).value).toBe('sales2')
    expect(chart().props('option').xAxis.data).toEqual(['2026-10-20', '2026-10-21'])
    vi.mocked(getFopDashboard).mockRejectedValueOnce({ code: 'fop_binding_required' })
    await wrapper.find('.refresh-button').trigger('click')
    await flushPromises()
    expect(chart()).toBeUndefined()
    expect(wrapper.text()).not.toContain('周雨桐')
    wrapper.unmount()
  })
  it('places the marketing aggregate first without counting it twice or adding it to the salesperson filter', async () => {
    vi.mocked(getFopDashboard).mockResolvedValueOnce(dashboardFixture({ ...sample, registrations: [{ date: '2026-01-01', count: 3 }], receipts: { currency: 'USD', months: ['2026-01'], marketingCenter: { id: 'marketing', name: '营销中心', amounts: [100] }, departments: [
      { id: 'sales1', name: '业务一部', amounts: [40], salespeople: [] },
      { id: 'sales2', name: '业务二部', amounts: [60], salespeople: [] },
    ] } }))
    const wrapper = mountView()
    await flushPromises()
    const charts = wrapper.findAllComponents({ name: 'EChart' })
    const chart = charts[1]!
    const aggregateColor = charts[0]!.props('option').series[0].itemStyle.color
    expect(chart.props('option').series[0].itemStyle.color).toBe(aggregateColor)
    expect(charts[2]!.props('option').series[0].itemStyle.color).toBe(aggregateColor)
    expect(chart.props('option').series[1].itemStyle.color).not.toBe(aggregateColor)
    expect(charts[2]!.props('option').series[0].data).toEqual([40])
    expect(chart.props('option').series.map((item: {name: string}) => item.name)).toEqual(['营销中心', '业务一部', '业务二部'])
    expect(wrapper.find('.receipt-summary strong').text()).toBe('$100.00')
    expect(wrapper.find('[aria-label="业务员回款部门"]').text()).not.toContain('营销中心')
    wrapper.unmount()
  })
  it('clears previous counts and customer data when authorization is revoked', async () => {
    const wrapper = mountView()
    await flushPromises()
    expect(wrapper.text()).toContain('My customer')
    vi.mocked(getFopDashboard).mockRejectedValueOnce({ code: 'fop_binding_required' })
    await wrapper.find('button.refresh-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('业务数据暂不可查看')
    expect(wrapper.text()).not.toContain('My customer')
    expect(wrapper.findAll('.summary-card strong').map(node => node.text())).toEqual(['—', '—', '—', '—', '—'])
    expect(wrapper.findAll('.task-row')).toHaveLength(0)
    wrapper.unmount()
  })
})

it('hides denied charts even when a stale payload contains their old numbers', async () => {
  vi.mocked(getFopDashboard).mockResolvedValue({ ...sample, chartAccess: [], registrations: [{ date: '2026-10-20', count: 999 }], receipts: { currency: 'USD', months: ['2026-10'], departments: [{ id: 'sales1', amounts: [900], salespeople: [{ id: 'hidden', name: 'Hidden employee', amounts: [900] }] }] } } as FopDashboardData)
  const wrapper = mountView(); await flushPromises()
  expect(wrapper.find('.registration-panel').exists()).toBe(false)
  expect(wrapper.find('.receipts-panel').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('Hidden employee')
  wrapper.unmount()
})
it('shows independent department summaries without record drilldown or employee spillover', async () => {
  vi.mocked(getFopDashboard).mockResolvedValue({ ...sample, chartAccess: [{ chartId: 'department_receipts', visible: true, scopeLabel: '业务二部组织汇总', dataScope: 'none', summaryOnly: true, summaryDepartments: ['sales2'], canViewDetails: false, canExport: false }], departmentReceipts: { currency: 'USD', months: ['2026-10'], departments: [{ id: 'sales2', name: '业务二部', amounts: [765], salespeople: [] }] } } as FopDashboardData)
  const wrapper = mountView(); await flushPromises()
  expect(wrapper.text()).toContain('$765.00')
  expect(wrapper.find('.receipts-panel h2').text()).toBe('部门月度回款分析')
  expect(wrapper.find('.salesperson-panel').exists()).toBe(false)
  expect(wrapper.find('.receipts-panel .receipt-link').exists()).toBe(false)
  wrapper.unmount()
})

it('labels partial record aggregates as scoped subtotals rather than complete organization totals', async () => {
  vi.mocked(getFopDashboard).mockResolvedValue({ ...sample, chartAccess: chartAccessFixture().charts.map(item => ({ ...item, dataScope: 'self', summaryDepartments: [] })), registrations: [{ date: '2026-10-20', count: 2 }], registrationDepartments: [{ id: 'sales1', name: '业务一部', counts: [2], salespeople: [{ id: 'self', name: '本人', counts: [2] }] }], receipts: { currency: 'USD', months: ['2026-10'], departments: [{ id: 'sales1', name: '业务一部', amounts: [125], salespeople: [{ id: 'self', name: '本人', amounts: [125] }] }] } })
  const wrapper = mountView(); await flushPromises()
  expect(wrapper.find('.registration-panel').text()).toContain('本人合计')
  expect(wrapper.find('.registration-panel').text()).not.toContain('营销中心合计')
  expect(wrapper.find('.salesperson-panel').text()).toContain('本人合计')
  expect(wrapper.find('.salesperson-panel').text()).not.toContain('蓝紫色为部门合计')
  wrapper.unmount()
})

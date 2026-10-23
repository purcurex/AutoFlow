import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import OrderVolumeAnalysis from '@/components/order-volume/OrderVolumeAnalysis.vue'
import { getOrderVolume, searchOrderCustomers, type OrderVolumeData, type OrderVolumeQuery } from '@/api/fop-order-volume'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/fop-order-volume', () => ({ getOrderVolume: vi.fn(), searchOrderCustomers: vi.fn() }))
vi.mock('@/composables/useWorkbenchAccess', () => ({ refreshWorkbenchAccess: vi.fn(), useWorkbenchAccess: () => ({ roles: { value: [] } }) }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option', 'label'], template: '<div class="chart-stub" />' } }))
const series = (id: string, label: string, kind: 'total' | 'detail' | 'other', total: number, entityId?: string) => {
  const hz = Math.round(total * 0.6), sz = total - hz, money = (n: number) => Math.round(n * 1001) / 100
  return { id, label, kind, total, entityId, code: entityId ? 'C001' : undefined, values: [total], warehouses: { HZ: [hz], SZ: [sz], UNASSIGNED: [0] },
    amounts: { currency: 'USD' as const, total: money(total), values: [money(total)], warehouses: { HZ: [money(hz)], SZ: [money(sz)], UNASSIGNED: [0] }, excludedOrderCount: 0 } }
}
function result(query: OrderVolumeQuery): OrderVolumeData { return { source: 'mock', query, timeZone: 'Asia/Shanghai', asOf: '2026-10-22T00:00:00Z', total: 12, customerCount: 11, periods: [{ id: '2026-10', label: '10月', from: '2026-10-01', to: '2026-10-31', future: false }], series: query.customerId ? [series('total', '客户合计', 'total', 5)] : [series('total', '合计', 'total', 12), series('customer:c1', 'Northstar', 'detail', 5, 'c1'), series('other', '其他客户', 'other', 7)], options: { departments: [{ id: 'sales1', label: '业务一部' }], objects: [] } } }
enableAutoUnmount(afterEach)
// jsdom does not implement the native dialog top layer.
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close') })
async function setup(teleportStub = true, customer = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/workbench/:role', name: 'RoleWorkbench', component: { template: '<div />' } }, { path: '/workbench/:role/receipts', name: 'RoleWorkbenchReceipts', component: { template: '<div />' } }] })
  await router.push('/')
  const wrapper = mount(OrderVolumeAnalysis, { attachTo: document.body, props: { customer }, global: { stubs: { teleport: teleportStub }, plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises(); return { wrapper, router }
}
describe('customer order analysis', () => {
  beforeEach(() => { vi.mocked(refreshWorkbenchAccess).mockReset().mockResolvedValue({ roles: ['allocation'], isAdmin: false }); vi.mocked(getOrderVolume).mockReset().mockImplementation(async q => result(q)); vi.mocked(searchOrderCustomers).mockReset() })
  it.each([true, false])('offers only supported warehouse choices for customer mode %s', async customer => {
    const { wrapper } = await setup(true, customer)
    expect(wrapper.find('select[aria-label="订单量仓库"]').findAll('option').map(option => option.attributes('value'))).toEqual(['ALL', 'HZ', 'SZ'])
    wrapper.unmount()
  })
  it('shows warehouse-specific receipt hints without attributing customer-wide sources to warehouse cells', async () => {
    vi.mocked(getOrderVolume).mockImplementation(async query => {
      const payload = result(query)
      payload.series.forEach(row => { if (row.amounts) row.amounts.breakdown = { fulfillment: 0, fullPaymentStock: row.amounts.total } })
      return payload
    })
    const { wrapper } = await setup()
    for (const [code, name] of [['HZ', '杭州仓'], ['SZ', '深圳仓']]) {
      const hint = wrapper.find(`[data-row-id="customer:c1"][data-metric="amount"] button[data-warehouse="${code}"]`).attributes('title')
      expect(hint).toContain(name)
      expect(hint).toContain('回款')
      expect(hint).not.toContain('$')
    }
    expect(wrapper.find('[data-row-id="customer:c1"][data-metric="amount"] button:not([data-warehouse])').attributes('title')).toContain('全款备货 $50.05')
    wrapper.unmount()
  })
  it('queries customers using start/end dates without timeline or year controls and preserves dates in drill links', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.find('select[aria-label="客户订单时间轴"]').exists()).toBe(false)
    expect(wrapper.find('select[aria-label="订单量年份"]').exists()).toBe(false)
    expect(wrapper.find('select[aria-label="客户订单部门"]').text()).not.toContain('授权范围')
    await wrapper.find('input[aria-label="客户订单开始日期"]').setValue('2025-12-31')
    await wrapper.find('input[aria-label="客户订单结束日期"]').setValue('2026-01-02')
    await wrapper.find('.ov-filters').trigger('submit'); await flushPromises()
    const query = vi.mocked(getOrderVolume).mock.calls.at(-1)![0]
    expect(query).toMatchObject({ category: 'customer', from: '2025-12-31', to: '2026-01-02' })
    expect(query).not.toHaveProperty('grain'); expect(query).not.toHaveProperty('year')
    await wrapper.find('tfoot button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ from: '2025-12-31', to: '2026-01-02' })
    expect(router.currentRoute.value.query).not.toHaveProperty('grain')
    wrapper.unmount()
  })
  it('does not query an incomplete or reversed date range', async () => {
    const { wrapper } = await setup()
    const count = vi.mocked(getOrderVolume).mock.calls.length
    await wrapper.find('input[aria-label="客户订单开始日期"]').setValue('2026-02-02')
    await wrapper.find('input[aria-label="客户订单结束日期"]').setValue('2026-01-01')
    await wrapper.find('.ov-filters').trigger('submit'); await flushPromises()
    expect(getOrderVolume).toHaveBeenCalledTimes(count)
    expect(wrapper.find('[role=alert]').text()).toContain('结束日期不能早于开始日期')
    wrapper.unmount()
  })
  it('shows ranking initially, selects a ranked customer and clears individual trends when input changes', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('客户订单分析')
    expect(wrapper.text()).toContain('订单量排名 · 前十＋其他')
    expect(wrapper.text()).toContain('其他客户')
    expect(wrapper.find('.ov-selected').exists()).toBe(false)
    await wrapper.findAll('button').find(b => b.text() === '趋势')!.trigger('click'); await flushPromises()
    expect(wrapper.find('.ov-selected').text()).toContain('Northstar')
    expect(getOrderVolume).toHaveBeenLastCalledWith(expect.objectContaining({ customerId: 'c1' }))
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('C999')
    expect(wrapper.find('.ov-selected').exists()).toBe(false)
    expect(wrapper.text()).toContain('其他客户')
    wrapper.unmount()
  })
  it('discards late search results and never opens a chart for a stale customer selection', async () => {
    let resolve!: (r: Awaited<ReturnType<typeof searchOrderCustomers>>) => void
    vi.mocked(searchOrderCustomers).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('C001')
    await wrapper.find('.ov-customer-search form').trigger('submit')
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('C002')
    resolve({ source: 'mock', total: 1, page: 1, pageSize: 10, items: [{ id: 'c1', code: 'C001', name: 'OLD SECRET', departments: [] }] }); await flushPromises()
    expect(wrapper.text()).not.toContain('OLD SECRET')
    expect(wrapper.find('.ov-selected').exists()).toBe(false)
    wrapper.unmount()
  })
  it('drills other into an authorized role, retaining the ranking query, then clears data on session reset', async () => {
    const { wrapper, router } = await setup()
    const row = wrapper.findAll('tbody tr').find(r => r.text().includes('其他客户'))!
    await row.find('button').trigger('click'); await flushPromises()
    expect(router.currentRoute.value.params.role).toBe('allocation')
    expect(router.currentRoute.value.query).toMatchObject({ queue: 'order-volume', category: 'customer', seriesId: 'other', warehouse: 'ALL' })
    invalidateSession()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Northstar')
    expect(wrapper.findAll('tbody tr')).toHaveLength(0)
    wrapper.unmount()
  })
  it('removes searched customer identities and pending responses after authorization is revoked', async () => {
    vi.mocked(searchOrderCustomers).mockResolvedValueOnce({ source: 'mock', total: 1, page: 1, pageSize: 10, items: [{ id: 'c1', code: 'C001', name: 'PRIVATE CUSTOMER', departments: ['业务一部'] }] })
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('C001')
    await wrapper.find('.ov-customer-search form').trigger('submit'); await flushPromises()
    expect(wrapper.text()).toContain('PRIVATE CUSTOMER')
    vi.mocked(getOrderVolume).mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.setProps({ revision: 1 }); await flushPromises()
    expect(wrapper.text()).not.toContain('PRIVATE CUSTOMER')
    expect(wrapper.find('.ov-selected').exists()).toBe(false)
    expect(wrapper.find('.ov-candidates').exists()).toBe(false)
    wrapper.unmount()
  })
  it('invalidates a pending customer search when a refresh loses permission', async () => {
    let resolve!: (r: Awaited<ReturnType<typeof searchOrderCustomers>>) => void
    vi.mocked(searchOrderCustomers).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('C001')
    await wrapper.find('.ov-customer-search form').trigger('submit')
    vi.mocked(getOrderVolume).mockRejectedValueOnce({ code: 'fop_binding_changed' })
    await wrapper.setProps({ revision: 1 }); await flushPromises()
    resolve({ source: 'mock', total: 1, page: 1, pageSize: 10, items: [{ id: 'c1', code: 'C001', name: 'REVOKED CUSTOMER', departments: [] }] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('REVOKED CUSTOMER')
    expect(wrapper.find('.ov-candidates').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keeps the explicitly clicked ranking customer when an earlier search finishes later', async () => {
    let resolve!: (r: Awaited<ReturnType<typeof searchOrderCustomers>>) => void
    vi.mocked(searchOrderCustomers).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('C002')
    await wrapper.find('.ov-customer-search form').trigger('submit')
    await wrapper.findAll('button').find(b => b.text() === '趋势')!.trigger('click'); await flushPromises()
    resolve({ source: 'mock', total: 1, page: 1, pageSize: 10, items: [{ id: 'c2', code: 'C002', name: 'LATE CUSTOMER', departments: [] }] })
    await flushPromises()
    expect(wrapper.find('.ov-selected').text()).toContain('Northstar')
    expect(wrapper.find('.ov-selected').text()).not.toContain('LATE CUSTOMER')
    wrapper.unmount()
  })
  it('shows quantity and amount rows and splits both customer charts by warehouse without reranking customers', async () => {
    const { wrapper, router } = await setup()
    const rows = wrapper.findAll('[data-row-id="customer:c1"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('订单量')
    expect(rows[1]!.text()).toContain('回款业绩金额')
    expect(rows[1]!.text()).toContain('$50.05')
    const charts = () => wrapper.findAllComponents({ name: 'EChart' })
    const labels = charts()[0]!.props('option').yAxis.data
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(charts()).toHaveLength(2)
    expect(charts()[0]!.props('option').yAxis.data).toEqual(labels)
    expect(charts()[1]!.props('option').yAxis.data).toEqual(labels)
    expect(charts()[0]!.props('option').series.map((s: {name: string; data: number[]}) => [s.name, s.data])).toEqual([['杭州仓', [3, 4]], ['深圳仓', [2, 3]]])
    expect(charts()[1]!.props('option').series.map((s: {name: string; data: number[]}) => [s.name, s.data])).toEqual([['杭州仓', [30.03, 40.04]], ['深圳仓', [20.02, 30.03]]])
    expect(charts()[1]!.props('option').tooltip.valueFormatter(30.03)).toBe('$30.03')
    await wrapper.find('[data-row-id="customer:c1"][data-metric="amount"] button[data-warehouse="SZ"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('RoleWorkbenchReceipts')
    expect(router.currentRoute.value.query).toMatchObject({ mode: 'customer', seriesId: 'customer:c1', detailWarehouse: 'SZ' })
    wrapper.unmount()
  })
  it('renders a stock-only customer and opens receipt details from the amount chart', async () => {
    vi.mocked(getOrderVolume).mockImplementation(async query => {
      const payload = result(query)
      payload.total = 0
      payload.series.forEach(row => { row.total = 0; row.values = [0]; row.warehouses = { HZ: [0], SZ: [0], UNASSIGNED: [0] } })
      return payload
    })
    const { wrapper, router } = await setup()
    const charts = wrapper.findAllComponents({ name: 'EChart' })
    expect(charts).toHaveLength(2)
    charts[1]!.vm.$emit('select', { dataIndex: 0, seriesId: 'total' })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('RoleWorkbenchReceipts')
    expect(router.currentRoute.value.query).toMatchObject({ mode: 'customer', seriesId: 'customer:c1' })
    wrapper.unmount()
  })
  it('keeps order counts visible when receipt amounts are omitted for permission reasons', async () => {
    vi.mocked(getOrderVolume).mockImplementation(async query => {
      const payload = result(query); payload.series.forEach(row => { delete row.amounts }); return payload
    })
    const { wrapper } = await setup()
    expect(wrapper.findAllComponents({ name: 'EChart' })).toHaveLength(1)
    expect(wrapper.text()).toContain('Northstar')
    expect(wrapper.find('.customer-amount-kpi').text()).toBe('—')
    expect(wrapper.find('[data-row-id="customer:c1"][data-metric="amount"] button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('opens customer trends in a modal immediately, preserves filters and ignores responses after closing', async () => {
    const { wrapper } = await setup(false)
    await wrapper.find('input[aria-label="客户订单开始日期"]').setValue('2026-09-01')
    await wrapper.find('input[aria-label="客户订单结束日期"]').setValue('2026-09-30')
    await wrapper.find('.ov-filters').trigger('submit')
    await wrapper.find('select[aria-label="客户订单部门"]').setValue('sales1')
    await wrapper.find('select[aria-label="订单量仓库"]').setValue('HZ')
    await flushPromises()
    let resolve!: (data: OrderVolumeData) => void
    vi.mocked(getOrderVolume).mockReturnValueOnce(new Promise(r => { resolve = r }))
    const trigger = wrapper.findAll('button').find(b => b.text() === '趋势')!
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('Northstar')
    expect(dialog.textContent).toContain('正在加载客户趋势')
    expect(dialog.textContent).toContain('2026-09-01')
    expect(dialog.textContent).toContain('业务一部')
    expect(dialog.textContent).toContain('杭州仓')
    expect(wrapper.find('.ov-selected').exists()).toBe(false)
    const query = vi.mocked(getOrderVolume).mock.calls.at(-1)![0]
    expect(query).toMatchObject({ customerId: 'c1', from: '2026-09-01', to: '2026-09-30', department: 'sales1', warehouse: 'HZ' })
    dialog.querySelector<HTMLButtonElement>('[aria-label="关闭客户趋势"]')!.click()
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    resolve(result(query)); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(wrapper.find('.ov-selected').exists()).toBe(false)
  })
  it('opens search matches in the same modal, closes on Escape and clears on session reset', async () => {
    vi.mocked(searchOrderCustomers).mockResolvedValue({ source: 'mock', total: 1, page: 1, pageSize: 10, items: [{ id: 'c1', code: 'C001', name: 'Northstar', departments: ['业务一部'] }] })
    const { wrapper } = await setup(false)
    await wrapper.find('input[aria-label="客户名称或编码"]').setValue('Northstar')
    await wrapper.find('.ov-customer-search form').trigger('submit'); await flushPromises()
    await wrapper.find('.ov-candidate').trigger('click'); await flushPromises()
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!
    expect(dialog.querySelector('.chart-stub')).not.toBeNull()
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    await wrapper.findAll('button').find(b => b.text() === '趋势')!.trigger('click'); await flushPromises()
    expect(document.querySelector('dialog[open]')).not.toBeNull()
    invalidateSession(); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
  })
  it('uses the authoritative total once for Top 10 plus other and warehouse totals', async () => {
    const { wrapper } = await setup()
    const cells = wrapper.find('tfoot').findAll('td').map(cell => cell.text())
    expect(cells.slice(0, 4)).toEqual(['12', '100.0%', '7', '5'])
    expect(wrapper.find('tfoot').text()).toContain('$120.12')
    expect(wrapper.find('tfoot').text()).toContain('$70.07')
    expect(wrapper.find('tfoot').text()).toContain('$50.05')
    await wrapper.find('tfoot button').trigger('click'); await flushPromises()
    wrapper.unmount()
  })
  it('replaces failed refreshes with an error and no cached ranking', async () => {
    const { wrapper } = await setup()
    vi.mocked(getOrderVolume).mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.setProps({ revision: 1 }); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无权读取')
    expect(wrapper.text()).not.toContain('Northstar')
    wrapper.unmount()
  })
})

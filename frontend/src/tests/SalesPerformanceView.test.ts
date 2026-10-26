vi.mock('@/api/fop-chart-access', async importOriginal => { const { chartAccessFixture } = await import('./chart-access-fixtures'); return { ...await importOriginal<object>(), getChartAccess: vi.fn(async () => chartAccessFixture()) } })
import { getChartAccess } from '@/api/fop-chart-access'
import { chartAccessFixture } from './chart-access-fixtures'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
import { invalidateSession } from '@/utils/session'

const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/index', () => ({ default: { get } }))
vi.mock('@/composables/useWorkbenchAccess', async () => {
  const { ref } = await import('vue')
  return { useWorkbenchAccess: () => ({ roles: ref(['sales', 'procurement']) }) }
})
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<section>Sales activities</section>' } }))
vi.mock('@/components/charts/EChart.vue', () => ({ default: { name: 'EChart', props: ['option', 'label'], template: '<div role="img" :aria-label="label" />' } }))

const metrics = { orderAmount: 100, stockAmount: 200, collectionsAmount: 300, settledGrossProfit: 40, estimatedGrossProfit: 15, unallocatedCount: 0, receiptCount: 3, profitCount: 2 }
const owner = { id: 'owner-1', name: 'Alice', department: { id: 'dept-1', name: '业务一部' } }
const otherOwner = { id: 'owner-2', name: 'Bob', department: { id: 'dept-2', name: '业务二部' } }
const sample = {
  chartAccess: chartAccessFixture().charts.find(item => item.chartId === 'sales_performance')!,
  source: 'mock', query: { from: '2026-01-01', to: '2026-10-23', grain: 'month' }, timeZone: 'UTC+8', currency: 'USD', asOf: '2026-10-22T16:30:00Z',
  owners: [owner, otherOwner], selectedOwner: owner, canSelectOwner: true,
  periods: [
    { ...metrics, id: '2026-09', label: '2026-09', from: '2026-09-01', to: '2026-09-30', profitStatus: 'settled' },
    { ...metrics, id: '2026-10', label: '2026-10', from: '2026-10-01', to: '2026-10-23', profitStatus: 'mixed' },
  ], totals: metrics, unallocatedSettlements: [],
}
const receipt = {
  id: 'r1', sourceType: 'full_payment_stock', documentId: 'stock-1', documentNumber: 'STOCK-001', customerId: 'c1', customerCode: 'C001', customerName: 'Example customer',
  department: owner.department, owner, salesDepartmentCode: 'sales1', warehouseCode: 'HZ', warehouse: '杭州仓', amount: 200, orderAmount: 195, handlingFee: 5, currency: 'USD', paidAt: '2026-09-30T16:05:00Z',
  reviewStatus: 'approved', receiptReviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, carrierCode: null, items: [],
}
const profit = {
  id: 'p1', orderId: 'order1', orderNumber: 'ORDER-001', customerCode: 'C001', customerName: 'Example customer', owner, department: owner.department, salesDepartmentCode: 'sales1',
  recognitionMonth: '2026-10', recognitionDate: '2026-10-01', knownAt: '2026-10-02T10:00:00+08:00', status: 'settled', settlementId: 'SETTLE-001', version: '3', approvedAt: '2026-10-02T10:00:00+08:00', cutoffAt: '2026-10-01T23:59:59+08:00', freightBasis: 'frozen',
  incomeAmount: 100, adjustmentIncome: 4, productCost: 30, freightCost: 10, refundCost: 2, returnCost: 3, otherCost: 4, previousRecognizedProfit: 15, roundingAdjustment: 0, amount: 40, currency: 'USD', originalAmount: 40, originalCurrency: 'USD', fxRateToUsd: 1, fxRateDate: '2026-10-01', fxRateSource: 'USD',
}
const details = { source: 'mock', timeZone: 'UTC+8', currency: 'USD', asOf: sample.asOf, kind: 'receipts', total: 23, page: 1, pageSize: 10, receipts: [receipt], profits: [], totals: metrics, range: { from: '2026-10-01', to: '2026-10-23' }, unallocatedSettlements: [] }
enableAutoUnmount(afterEach)
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterAll(() => { Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close') })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })
async function setup(path = '/workbench/sales?queue=performance', teleportStub = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/workbench/:role', name: 'RoleWorkbench', component: WorkbenchView },
    { path: '/dashboard', component: { template: '<div />' } },
  ] })
  await router.push(path)
  const wrapper = mount(WorkbenchView, { attachTo: document.body, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { Teleport: teleportStub } } })
  await flushPromises()
  return { wrapper, router }
}
describe('sales performance workbench', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-22T16:30:00Z'))
    get.mockReset().mockImplementation(async (path: string) => structuredClone(path.endsWith('/details') ? details : sample))
  })
  it('shows personal performance only in sales and retains the explicitly selected overview', async () => {
    const { wrapper, router } = await setup('/workbench/sales?queue=overview')
    expect(wrapper.text()).toContain('Sales activities')
    expect(wrapper.find('.workbench-queues').text()).toContain('个人收款与毛利')
    await router.push('/workbench/procurement?queue=performance'); await flushPromises()
    expect(wrapper.find('.workbench-queues').text()).not.toContain('个人收款与毛利')
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })
  it('loads the UTC+8 year-to-date scope without identity claims and names the selected person', async () => {
    const { wrapper } = await setup()
    expect(get).toHaveBeenCalledWith('/autoflow/integrations/fop/sales-performance', { params: { from: '2026-01-01', to: '2026-10-23', grain: 'month' } })
    expect(wrapper.text()).toContain('Alice · 业务一部')
    expect(wrapper.text()).toContain('MOCK')
    expect(wrapper.find('[data-testid=performance-kpis]').text()).toContain('$300.00')
    expect(wrapper.find('[data-testid=performance-kpis]').text()).toContain('$40.00')
    expect(wrapper.find('[data-testid=performance-kpis]').text()).toContain('$15.00')
    expect(wrapper.findAll('.performance-table tbody tr')[0]!.text()).toContain('2026-10')
    expect(wrapper.find('.performance-table tfoot').text()).toContain('$300.00')
    const charts = wrapper.findAllComponents({ name: 'EChart' })
    expect(charts).toHaveLength(2)
    expect(charts[0]!.props('option').xAxis.data).toEqual(['2026-09', '2026-10'])
    expect(charts[0]!.props('option').aria.label.description).toContain('分期统计')
    expect(charts[1]!.props('option').aria.label.description).toContain('分期统计')
    expect(charts[1]!.props('option').series.map((s: { name: string }) => s.name)).toEqual(['结算毛利', '预估毛利'])
  })
  it('applies dates and preserves the explicitly selected authorized owner through grain changes', async () => {
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="开始日期"]').setValue('2026-09-01')
    await wrapper.find('input[aria-label="结束日期"]').setValue('2026-10-21')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    await wrapper.find('select[aria-label="业务员"]').setValue('owner-2'); await flushPromises()
    await wrapper.find('select[aria-label="统计粒度"]').setValue('week'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/sales-performance', { params: { from: '2026-09-01', to: '2026-10-21', grain: 'week', ownerId: 'owner-2' } })
    await wrapper.find('select[aria-label="统计粒度"]').setValue('day'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/sales-performance', { params: expect.objectContaining({ grain: 'day', ownerId: 'owner-2' }) })
  })
  it('keeps missing settlement allocation as unknown and displays a separate monthly reference', async () => {
    get.mockResolvedValue({ ...sample, canSelectOwner: false, totals: { ...metrics, settledGrossProfit: null, unallocatedCount: 1 }, periods: [{ ...sample.periods[1], settledGrossProfit: null, unallocatedCount: 1, profitStatus: 'unallocated' }], unallocatedSettlements: [{ month: '2026-10', amount: 99, count: 1 }] })
    const { wrapper } = await setup()
    expect(wrapper.find('select[aria-label="业务员"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=settled-total]').text()).toBe('—')
    expect(wrapper.text()).toContain('待补充分期明细')
    expect(wrapper.find('[data-testid=unallocated]').text()).toContain('$99.00')
    expect(wrapper.find('.performance-table tfoot').text()).not.toContain('$99.00')
    const charts = wrapper.findAllComponents({ name: 'EChart' })
    expect(charts[1]!.props('option').series[0].data).toEqual([null])
  })
  it('opens receipt details centrally, uses full-scope totals and keeps scope when paging', async () => {
    const { wrapper } = await setup(undefined, false)
    await wrapper.findAll('button').find(b => b.text() === '收款明细')!.trigger('click'); await flushPromises()
    const dialog = new DOMWrapper(document.querySelector('dialog')!)
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('STOCK-001')
    expect(dialog.text()).toContain('Example customer')
    expect(dialog.text()).toContain('2026/10/1')
    expect(dialog.find('tfoot').text()).toContain('$300.00')
    await dialog.findAll('button').find(b => b.text() === '下一页')!.trigger('click'); await flushPromises()
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/sales-performance/details', { params: { from: '2026-01-01', to: '2026-10-23', grain: 'month', ownerId: 'owner-1', kind: 'receipts', periodId: '2026-10', page: 2, pageSize: 10 } })
    await dialog.trigger('cancel'); await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
  })
  it('shows profit components and settlement provenance without adding settled and estimated profit', async () => {
    get.mockImplementation(async (path: string) => structuredClone(path.endsWith('/details') ? { ...details, kind: 'profit', receipts: [], profits: [profit] } : sample))
    const { wrapper } = await setup()
    await wrapper.findAll('button').find(b => b.text() === '毛利明细')!.trigger('click'); await flushPromises()
    const dialog = wrapper.find('dialog')
    expect(dialog.text()).toContain('ORDER-001')
    expect(dialog.text()).toContain('已结算')
    expect(dialog.text()).toContain('SETTLE-001')
    expect(dialog.find('thead').text()).not.toContain('退款')
    await dialog.findAll('button').find(b => b.text() === '查看构成')!.trigger('click')
    expect(wrapper.find('dialog').text()).toContain('退款')
    expect(wrapper.find('dialog').text()).toContain('前期已确认')
    expect(wrapper.find('dialog tfoot').text()).toContain('$40.00')
    expect(wrapper.find('dialog tfoot').text()).toContain('$15.00')
    expect(wrapper.find('dialog tfoot').text()).not.toContain('$55.00')
  })
  it.each([
    ['day', '2026-09-01', '2026-09-01', true],
    ['week', '2026-09-01', '2026-09-30', true],
    ['month', '2026-09-02', '2026-09-30', true],
    ['month', '2026-09-01', '2026-09-30', false],
  ])('separates undated monthly settlement references from %s profit for %s through %s', async (grain, from, to, referenceOnly) => {
    const page = { ...details, kind: 'profit', receipts: [], profits: [{ ...profit, recognitionDate: null, recognitionMonth: '2026-09' }], range: { from, to }, totals: { ...metrics, settledGrossProfit: referenceOnly ? null : 40 }, unallocatedSettlements: referenceOnly ? [{ month: '2026-09', amount: 40, count: 1 }] : [] }
    get.mockImplementation(async (path: string) => structuredClone(path.endsWith('/details') ? page : sample))
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="开始日期"]').setValue(from)
    await wrapper.find('input[aria-label="结束日期"]').setValue(to)
    await wrapper.find('form').trigger('submit'); await flushPromises()
    await wrapper.find('select[aria-label="统计粒度"]').setValue(grain); await flushPromises()
    await wrapper.findAll('button').find(b => b.text() === '全部毛利')!.trigger('click'); await flushPromises()
    const amount = wrapper.find('dialog tbody tr td.performance-detail-amount')
    if (referenceOnly) {
      expect(amount.text()).toContain('—')
      expect(amount.text()).toContain('整月参考 · 不计本期')
      expect(amount.text()).not.toContain('$40.00')
      expect(wrapper.find('dialog .performance-detail-asof').text()).toContain('月结参考未计入分期合计')
      await wrapper.find('dialog').findAll('button').find(b => b.text() === '查看构成')!.trigger('click')
      expect(wrapper.find('dialog .performance-breakdown').text()).toContain('整月参考净毛利')
      expect(wrapper.find('dialog .performance-breakdown').text()).toContain('$40.00')
    } else {
      expect(amount.text()).toBe('$40.00')
      expect(amount.text()).not.toContain('不计本期')
      expect(wrapper.find('dialog tfoot').text()).toContain('结算 $40.00')
    }
  })
  it('clears all old amounts and owner options when a refreshed permission check fails', async () => {
    const { wrapper } = await setup()
    get.mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.find('select[aria-label="统计粒度"]').setValue('week'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无法查看这些数据')
    expect(wrapper.text()).not.toContain('$300.00')
    expect(wrapper.text()).not.toContain('Alice')
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('discards superseded filter responses and clears an open dialog on session reset', async () => {
    const { wrapper } = await setup()
    let resolve!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await wrapper.find('select[aria-label="统计粒度"]').setValue('week')
    get.mockResolvedValueOnce({ ...sample, selectedOwner: otherOwner })
    await wrapper.find('select[aria-label="统计粒度"]').setValue('day'); await flushPromises()
    resolve(sample); await flushPromises()
    expect(wrapper.text()).toContain('Bob · 业务二部')
    expect(wrapper.find('.performance-scope').text()).not.toContain('Alice')
    await wrapper.findAll('button').find(b => b.text() === '收款明细')!.trigger('click'); await flushPromises()
    expect(wrapper.find('dialog').exists()).toBe(true)
    invalidateSession(); await flushPromises()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Bob')
    expect(wrapper.text()).not.toContain('$300.00')
  })
  it('does not restore pending main or detail results after a session reset', async () => {
    const { wrapper } = await setup()
    let resolveDetail!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(r => { resolveDetail = r }))
    await wrapper.findAll('button').find(b => b.text() === '毛利明细')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('dialog [role=status]').exists()).toBe(true)
    invalidateSession(); resolveDetail({ ...details, kind: 'profit', profits: [profit] }); await flushPromises()
    expect(wrapper.text()).not.toContain('ORDER-001')
    wrapper.unmount()
    const fresh = await setup()
    let resolveMain!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(r => { resolveMain = r }))
    await fresh.wrapper.find('form').trigger('submit'); await flushPromises()
    invalidateSession(); resolveMain(sample); await flushPromises()
    expect(fresh.wrapper.text()).not.toContain('Alice')
  })
  it('handles empty detail pages and clears stale detail amounts on failure', async () => {
    const { wrapper } = await setup()
    get.mockResolvedValueOnce({ ...details, total: 0, receipts: [] })
    await wrapper.findAll('button').find(b => b.text() === '收款明细')!.trigger('click'); await flushPromises()
    expect(wrapper.find('dialog').text()).toContain('暂无收款')
    await wrapper.find('button[aria-label="关闭明细"]').trigger('click')
    get.mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.findAll('button').find(b => b.text() === '毛利明细')!.trigger('click'); await flushPromises()
    expect(wrapper.find('dialog [role=alert]').text()).toContain('无法查看这些数据')
    expect(wrapper.find('dialog tfoot').exists()).toBe(false)
    expect(wrapper.find('.performance-table').exists()).toBe(false)
  })
  it('clears a selected owner on session reset without issuing a request for the next account', async () => {
    const { wrapper } = await setup()
    await wrapper.find('select[aria-label="业务员"]').setValue('owner-2'); await flushPromises()
    const callCount = get.mock.calls.length
    invalidateSession(); await flushPromises()
    expect(get.mock.calls).toHaveLength(callCount)
    expect(wrapper.text()).not.toContain('Alice')
    expect(wrapper.text()).not.toContain('Bob')
    expect(wrapper.find('table').exists()).toBe(false)
  })
  it('rejects future or reversed dates without replacing the applied scope', async () => {
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="开始日期"]').setValue('2026-10-24')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('有效日期')
    expect(get).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.performance-scope').text()).toContain('2026-01-01')
  })
  it('limits the query to 366 inclusive days and explains the range limit before requesting', async () => {
    const { wrapper } = await setup()
    await wrapper.find('input[aria-label="开始日期"]').setValue('2025-10-22')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('366')
    expect(get).toHaveBeenCalledTimes(1)
    await wrapper.find('input[aria-label="开始日期"]').setValue('2025-10-23')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
  })
  it('starts charts on the latest six months while retaining all periods and full totals through table paging', async () => {
    get.mockResolvedValue({ ...sample, periods: Array.from({ length: 20 }, (_, i) => ({ ...sample.periods[0], id: `2026-${String(i + 1).padStart(2, '0')}`, label: `Period ${i + 1}`, from: `2026-${String(i + 1).padStart(2, '0')}-01` })) })
    const { wrapper } = await setup()
    const option = wrapper.findAllComponents({ name: 'EChart' })[0]!.props('option')
    expect(option.dataZoom[0]).toMatchObject({ startValue: 14, endValue: 19, type: 'slider', zoomLock: true })
    expect(wrapper.findAll('.performance-table tbody tr')).toHaveLength(12)
    await wrapper.findAll('button').find(b => b.text() === '下一页')!.trigger('click')
    expect(wrapper.findAll('.performance-table tbody tr')).toHaveLength(8)
    expect(wrapper.find('.performance-table tfoot').text()).toContain('$300.00')
  })
  it('clears old employee choices as soon as a narrowed-scope refresh begins', async () => {
    const { wrapper } = await setup()
    expect(wrapper.get('select[aria-label="业务员"]').text()).toContain('Bob')
    vi.mocked(getChartAccess).mockResolvedValueOnce({ ...chartAccessFixture(), charts: chartAccessFixture().charts.map(item => ({ ...item, dataScope: 'self' })) })
    let resolve!: (value: unknown) => void
    get.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(wrapper.text()).not.toContain('Bob')
    invalidateSession(); resolve(sample); await flushPromises()
  })

  it('requires an explicit employee choice when a manager has no bound personal owner', async () => {
    get.mockResolvedValueOnce({ ...sample, selectedOwner: null, periods: [], totals: { ...metrics, collectionsAmount: 0, orderAmount: 0, stockAmount: 0, settledGrossProfit: 0, estimatedGrossProfit: 0 } })
    const { wrapper } = await setup()
    const select = wrapper.get('select[aria-label="业务员"]')
    expect(select.element).toHaveProperty('value', '')
    expect(select.find('option[value=""]').text()).toBe('请选择业务员')
    expect(wrapper.find('.performance-charts').exists()).toBe(false)
    expect(get.mock.calls[0]![1].params).not.toHaveProperty('ownerId')
  })

})

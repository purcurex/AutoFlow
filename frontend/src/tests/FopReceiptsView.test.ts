vi.mock('@/api/fop-chart-access', async importOriginal => { const { chartAccessFixture } = await import('./chart-access-fixtures'); return { ...await importOriginal<object>(), getChartAccess: vi.fn(async () => chartAccessFixture()) } })
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
import { invalidateSession } from '@/utils/session'
const get = vi.hoisted(() => vi.fn())
vi.mock('@/api/index', () => ({ default: { get } }))
vi.mock('@/composables/useWorkbenchAccess', async () => { const { ref } = await import('vue'); return { useWorkbenchAccess: () => ({ roles: ref(['allocation']) }) } })
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/views/autoflow/FopOrdersView.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/order-volume/OrderVolumeAnalysis.vue', () => ({ default: { template: '<div />' } }))
const sample = {
  source: 'fop', timeZone: 'UTC+8', total: 2, page: 1, pageSize: 20,
  totals: { receiptCount: 2, currency: 'USD', amount: 125, fulfillmentAmount: 25, fullPaymentStockAmount: 100, orderAmount: 120, handlingFee: 5 },
  items: [{ id: 'receipt-stock', sourceType: 'full_payment_stock', documentId: 'stock-1', documentNumber: 'STOCK-001', customerId: 'c1', customerCode: 'C001', customerName: 'Stock-only customer', organization: { id: 'org', name: 'HyperZone' }, department: { id: 'dept', name: '业务一部' }, owner: { id: 'owner-1', name: 'Alice' }, salesDepartmentCode: 'sales1', warehouseCode: 'HZ', warehouse: '杭州仓', amount: 100, orderAmount: 96, handlingFee: 4, currency: 'USD', paidAt: '2026-09-30T16:05:00Z', reviewStatus: 'approved', receiptReviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, carrierCode: null, items: [{ sku: 'SKU-1', name: 'Stocked item', imageUrl: null, variant: 'Blue', quantity: 3 }] }],
}
enableAutoUnmount(afterEach)
async function setup(query = 'from=2026-10-01&to=2026-10-31&department=sales1&ownerId=owner-1', locale = 'zh-CN') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role/receipts', name: 'RoleWorkbenchReceipts', component: WorkbenchView }, { path: '/workbench/:role', name: 'RoleWorkbench', component: { template: '<div />' } }, { path: '/dashboard', component: { template: '<div />' } }] })
  await router.push(`/workbench/allocation/receipts?${query}`)
  const wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale, messages: {} })] } })
  await flushPromises()
  return { wrapper, router }
}
describe('receipt workbench details', () => {
  beforeEach(() => get.mockReset().mockResolvedValue(structuredClone(sample)))
  it('renders actual receipts, source totals, products and UTC+8 payment dates in the authorized workbench', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('回款明细')
    expect(wrapper.text()).toContain('STOCK-001')
    expect(wrapper.text()).toContain('全款备货')
    expect(wrapper.text()).toContain('SKU-1')
    expect(wrapper.text()).toContain('2026/10/1')
    expect(wrapper.text()).toContain('不适用')
    expect(wrapper.text()).not.toContain('其他物流')
    expect(wrapper.find('tfoot').text()).toContain('$125.00')
    expect(wrapper.find('tfoot').text()).toContain('$100.00')
    expect(get).toHaveBeenCalledWith('/autoflow/integrations/fop/receipts', { params: { from: '2026-10-01', to: '2026-10-31', department: 'sales1', ownerId: 'owner-1', warehouse: 'ALL', workbenchRole: 'allocation', page: 1, pageSize: 20 } })
  })
  it.each([['zh-CN', '业务一部', '全部发货仓库'], ['en-US', 'Sales I', 'All shipping warehouses']])('shows readable scope labels in %s without internal identifiers', async (locale, department, warehouse) => {
    const { wrapper } = await setup(undefined, locale)
    const summary = wrapper.get('.ov-applied-filters').text() || ''
    expect(summary).toContain(department)
    expect(summary).toContain(warehouse)
    expect(summary).toContain('Alice')
    expect(summary).not.toContain('sales1')
    expect(summary).not.toContain('owner-1')
    expect(summary).not.toContain('ALL')
  })
  it('uses a neutral selected-owner label when rows cannot resolve the owner and identifies fulfillment service providers', async () => {
    get.mockResolvedValue({ ...sample, items: [{ ...sample.items[0], sourceType: 'fulfillment', carrierCode: 'YT' }] })
    const { wrapper } = await setup('from=2026-10-01&to=2026-10-31&department=sales4&ownerId=unavailable-owner&warehouse=HZ')
    const summary = wrapper.get('.ov-applied-filters').text() || ''
    expect(summary).toContain('业务四部')
    expect(summary).toContain('杭州仓')
    expect(summary).toContain('所选业务员')
    expect(summary).not.toContain('unavailable-owner')
    expect(wrapper.find('thead').text()).toContain('物流服务商')
    expect(wrapper.findAll('tbody td')[7]!.text()).toContain('云途YT')
  })
  it('retains the customer cohort and warehouse filters through receipt pagination', async () => {
    get.mockResolvedValue({ ...sample, total: 30 })
    const { wrapper, router } = await setup('mode=customer&category=customer&from=2026-10-01&to=2026-10-31&seriesId=other&warehouse=ALL&detailWarehouse=SZ&periodId=2026-10-01')
    expect(wrapper.text()).toContain('STOCK-001')
    await wrapper.findAll('button').find(button => button.text() === '下一页')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ mode: 'customer', seriesId: 'other', detailWarehouse: 'SZ', page: '2' })
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/order-volume/receipts', { params: { category: 'customer', from: '2026-10-01', to: '2026-10-31', seriesId: 'other', periodId: '2026-10-01', warehouse: 'ALL', detailWarehouse: 'SZ', workbenchRole: 'allocation', page: 2, pageSize: 20 } })
  })
  it('resets pagination when changing receipt sources and removes totals on a denied query', async () => {
    const { wrapper, router } = await setup('from=2026-10-01&to=2026-10-31&page=3')
    expect(wrapper.find('select[aria-label="回款来源"]').exists()).toBe(true)
    await wrapper.find('select[aria-label="回款来源"]').setValue('full_payment_stock'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sourceType: 'full_payment_stock', page: '1' })
    expect(get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/receipts', { params: expect.objectContaining({ sourceType: 'full_payment_stock', page: 1 }) })
    get.mockRejectedValueOnce({ code: 'fop_permission_denied' })
    await wrapper.find('select[aria-label="回款来源"]').setValue('fulfillment'); await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    expect(wrapper.find('tfoot').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('STOCK-001')
  })
  it('clears receipt identities on session reset and ignores pending responses', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('STOCK-001')
    let resolve!: (value: typeof sample) => void
    get.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click')
    invalidateSession(); resolve(sample); await flushPromises()
    expect(wrapper.text()).not.toContain('STOCK-001')
  })
})

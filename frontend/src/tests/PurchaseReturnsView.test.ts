vi.mock('@/api/workbench-replica', () => ({ getWorkbenchReplicaStatus: vi.fn().mockResolvedValue({ readMode: 'live' }), requestWorkbenchReplicaSync: vi.fn(), getWorkbenchReplicaJob: vi.fn() }))
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import PurchaseReturnsView from '@/views/autoflow/PurchaseReturnsView.vue'
import { getPurchaseReturns, exportPurchaseReturns, type PurchaseReturnPage } from '@/api/purchase-returns'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { invalidateSession } from '@/utils/session'
import { downloadBlob } from '@/utils/export'
vi.mock('@/api/purchase-returns', async importOriginal => ({ ...await importOriginal<typeof import('@/api/purchase-returns')>(), getPurchaseReturns: vi.fn(), exportPurchaseReturns: vi.fn() }))
vi.mock('@/utils/export', () => ({ downloadBlob: vi.fn() }))
const document = { id: 'r1', number: 'TH20261105000001', status: 'pending_outbound' as const, purchaseOrder: { id: 'p1', number: 'CG20261030000006' }, supplier: { id: 's1', name: 'Supplier' }, warehouseCode: 'HZ', warehouse: '杭州仓', createdAt: '2026-11-05T00:00:00Z', logistics: { carrier: '顺丰', trackingNumber: '0001234567890123456789' }, quantity: 2, returnedQuantity: 0, lines: [{ id: 'l1', sku: 'SKU-A', name: 'Product A', variant: 'Red', imageUrl: null, quantity: 2, returnedQuantity: 0, sourceOrder: { id: 'o1', number: 'SO123', kind: 'fulfillment' as const, customerName: 'Customer A', owner: { id: 'alice', name: 'Alice' }, department: { id: 'd1', name: '业务一部' } } }] }
const page: PurchaseReturnPage = { source: 'mock', refreshedAt: '2026-11-05T00:00:00Z', page: 1, pageSize: 50, total: 1, departments: [{ id: 'd1', name: '业务一部' }], totals: { orderCount: 1, itemQuantity: 1, amountsByCurrency: [{ currency: 'USD', amount: 10 }], returnCount: 1, quantity: 2, returnedQuantity: 0 }, items: [{ ...mockFopOrders[0]!, id: 'o1', orderNumber: 'SO123', amount: 10, currency: 'USD', purchaseReturns: [document], returnQuantity: 2, returnedQuantity: 0 }] }
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount(); vi.clearAllMocks() })
async function setup(role = 'warehouse') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: PurchaseReturnsView }] })
  await router.push(`/workbench/${role}?queue=purchase_returns`)
  const wrapper = mount(PurchaseReturnsView, { global: { stubs: { SupplierFollowUpDialog: true }, plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } }); wrappers.push(wrapper); await flushPromises()
  return { wrapper, router }
}
describe('physical purchase return workbench', () => {
  it('shows return facts, exports all by default, and exports selected fulfillment order IDs when selected', async () => {
    vi.mocked(getPurchaseReturns).mockResolvedValue(page); vi.mocked(exportPurchaseReturns).mockResolvedValue(new Blob(['xlsx']))
    const { wrapper, router } = await setup()
    expect(wrapper.get('thead th').text()).toBe('订单编号')
    expect(wrapper.get('tbody .order-cell').text()).toContain('SO123')
    expect(wrapper.get('tbody .order-cell').text()).not.toContain('TH202611')
    expect(wrapper.get('tbody').text()).toContain('CG20261030000006'); expect(wrapper.get('tbody').text()).toContain('0001234567890123456789')
    expect(wrapper.get('tbody .workbench-status-badge').text()).toBe('待退货出库')
    await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
    expect(exportPurchaseReturns).toHaveBeenLastCalledWith(expect.objectContaining({ workbenchRole: 'warehouse' }), 'filtered', [], expect.any(AbortSignal))
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    await wrapper.get('input[aria-label="选择订单 SO123"]').setValue(true)
    await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
    expect(exportPurchaseReturns).toHaveBeenLastCalledWith(expect.anything(), 'selected', ['o1'], expect.any(AbortSignal))
    await wrapper.get('select[aria-label="退货进度筛选"]').setValue('in_transit'); await flushPromises()
    expect(router.currentRoute.value.query.returnStatus).toBe('in_transit')
    expect(getPurchaseReturns).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'in_transit', page: 1 }), expect.any(AbortSignal))
    expect(wrapper.get('input[aria-label="选择订单 SO123"]').element).toHaveProperty('checked', false)
  })
  it('keeps multiple linked returns inside one fulfillment row and does not invent missing bill numbers', async () => {
    vi.mocked(getPurchaseReturns).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, purchaseReturns: [document, { ...document, id: 'r2', number: null, status: 'unknown' }] }] })
    const { wrapper } = await setup()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.findAll('.purchase-return-link')).toHaveLength(2)
    expect(wrapper.findAll('.return-bill-number')).toHaveLength(1)
    expect(wrapper.get('.return-bill-number').text()).toBe('TH20261105000001')
  })
  it('renders every product of a SKU-matched fulfillment order', async () => {
    const item = page.items[0]!.items[0]!
    vi.mocked(getPurchaseReturns).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, items: [{ ...item, sku: 'SKU-ONE', name: 'First product', quantity: 2 }, { ...item, sku: 'SKU-TWO', name: 'Second product', quantity: 3 }] }] })
    const { wrapper, router } = await setup()
    await router.replace({ query: { queue: 'purchase_returns', search: 'SKU-ONE' } }); await flushPromises()
    expect(wrapper.findAll('tbody .product')).toHaveLength(2)
    expect(wrapper.get('tbody .product-cell').text()).toContain('SKU-ONE')
    expect(wrapper.get('tbody .product-cell').text()).toContain('SKU-TWO')
    expect(wrapper.get('tbody .order-cell').text()).toContain('2 款商品 · 5 件')
  })
  it('clears records on session reset and rejects a late response from the old account', async () => {
    let resolve!: (value: PurchaseReturnPage) => void
    vi.mocked(getPurchaseReturns).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { wrapper } = await setup(); invalidateSession(); resolve(page); await flushPromises()
    expect(wrapper.text()).not.toContain('TH20261105000001')
    expect(wrapper.find('tbody').exists()).toBe(false)
  })
})

it('does not query on timers, focus, visibility changes or network reconnection', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    vi.mocked(getPurchaseReturns).mockResolvedValue(page)
    const { wrapper } = await setup()
    const baseline = vi.mocked(getPurchaseReturns).mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    window.dispatchEvent(new Event('focus'))
    window.document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(getPurchaseReturns).toHaveBeenCalledTimes(baseline)
    expect(wrapper.text()).toContain('手动刷新')
    wrapper.unmount()
  } finally { vi.useRealTimers() }
})

it.each(['procurement', 'warehouse'])('opens the selected return contact in %s and closes on navigation', async role => {
  vi.mocked(getPurchaseReturns).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, purchaseReturns: [document, { ...document, id: 'r2', purchaseOrder: { id: 'p2', number: 'CG-2' }, supplier: { id: 's2', name: 'Second supplier' } }] }] })
  const { wrapper, router } = await setup(role)
  const requests = vi.mocked(getPurchaseReturns).mock.calls.length
  expect(wrapper.findAll('.return-supplier-contact')).toHaveLength(2)
  await wrapper.findAll('.return-supplier-contact')[1]!.trigger('click')
  expect(wrapper.getComponent(SupplierFollowUpDialog).props()).toMatchObject({ orderId: 'o1', purchaseOrderId: 'p2', returnContext: { returnId: 'r2', workbenchRole: role } })
  expect(getPurchaseReturns).toHaveBeenCalledTimes(requests)
  expect(wrapper.get('input[aria-label="选择订单 SO123"]').element).toHaveProperty('checked', false)
  await router.push(`/workbench/${role}?queue=purchase_returns&page=2`); await flushPromises()
  expect(wrapper.findComponent(SupplierFollowUpDialog).exists()).toBe(false)
})

it('labels uncollected counts and empty states without implying a business zero', async () => {
  vi.mocked(getPurchaseReturns).mockResolvedValue({ ...page, items: [], total: 0, dataAvailability: { mode: 'collected', complete: false, missingDatasets: ['returns'] } })
  const { wrapper } = await setup()
  expect(wrapper.get('.result-count').text()).toBe('— · 待接入')
  expect(wrapper.text()).toContain('采购退货数据尚未接入')
  expect(wrapper.text()).not.toContain('暂无符合条件')
  wrapper.unmount()
})

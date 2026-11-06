import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RmaOrdersView from '@/views/autoflow/RmaOrdersView.vue'
import { getRmaOrders, exportRmaOrders, type RmaPage } from '@/api/rma-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/rma-orders', async importOriginal => ({ ...await importOriginal<typeof import('@/api/rma-orders')>(), getRmaOrders: vi.fn(), exportRmaOrders: vi.fn() }))
vi.mock('@/utils/export', () => ({ downloadBlob: vi.fn() }))
const page: RmaPage = { source: 'mock', refreshedAt: '2026-11-05T00:00:00Z', page: 1, pageSize: 50, total: 1, departments: [], totals: { orderCount: 1, caseCount: 2, itemQuantity: 1, amountsByCurrency: [{ currency: 'USD', amount: 10 }] }, items: [{ ...mockFopOrders[0]!, id: 'o1', orderNumber: 'TO261104036001', amount: 10, currency: 'USD', rmaUpdatedAt: '2026-11-05T00:00:00Z', orderTags: ['intercepted'], refundAmounts: [{ currency: 'USD', amount: 3 }], rmaCases: [ { id: 'r1', orderId: 'o1', type: 'refund', isOpen: true, number: 'RMA-001', stage: '退款待审核', reason: '<img src=x onerror=alert(1)>', requestedAmount: 5, currency: 'USD', createdAt: null, updatedAt: null }, { id: 'r2', orderId: 'o1', type: 'interception', isOpen: true, number: null, stage: '拦截处理中', reason: null, requestedAmount: null, currency: null, createdAt: null, updatedAt: null } ] }] }
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.clearAllMocks() })
async function setup(path = '/workbench/sales?queue=rma') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/sales', component: RmaOrdersView }] }); await router.push(path)
  const wrapper = mount(RmaOrdersView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } }); mounted.push(wrapper); await flushPromises(); return { wrapper, router }
}
describe('sales RMA workbench', () => {
  it('groups multiple flows in one order, treats reasons as text, and exports filtered or selected orders', async () => {
    vi.mocked(getRmaOrders).mockResolvedValue(page); vi.mocked(exportRmaOrders).mockResolvedValue(new Blob(['xlsx']))
    const { wrapper, router } = await setup()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.findAll('thead th').map(th => th.text())).toContain('退款金额')
    expect(wrapper.get('.rma-refund').text()).toContain('$3.00')
    expect(wrapper.get('.rma-order-number').text()).toContain('订单拦截')
    expect(wrapper.get('.rma-types').text()).toContain('仅退款')
    expect(wrapper.get('.rma-types').text()).toContain('RMA-001')
    expect(wrapper.findAll('select[aria-label="售后类型筛选"] option').map(option => option.text())).toEqual(['全部', '仅退款', '退货退款', '补发货'])
    expect(wrapper.get('.rma-reason').text()).toBe('<img src=x onerror=alert(1)>')
    expect(wrapper.get('.rma-reason').find('img').exists()).toBe(false)
    expect(getRmaOrders).toHaveBeenLastCalledWith(expect.objectContaining({ flowStatus: 'active', pageSize: 50 }), expect.any(AbortSignal))
    await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
    expect(exportRmaOrders).toHaveBeenLastCalledWith(expect.anything(), 'filtered', [], expect.any(AbortSignal))
    await wrapper.get('input[aria-label="选择订单 TO261104036001"]').setValue(true)
    await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
    expect(exportRmaOrders).toHaveBeenLastCalledWith(expect.anything(), 'selected', ['o1'], expect.any(AbortSignal))
    await wrapper.get('select[aria-label="售后类型筛选"]').setValue('reshipment'); await flushPromises()
    expect(router.currentRoute.value.query.rmaType).toBe('reshipment')
    expect(getRmaOrders).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'reshipment', page: 1 }), expect.any(AbortSignal))
  })
  it('keeps the whole order and an independent partial refund amount in a single row', async () => {
    const product = page.items[0]!.items[0]!
    vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, items: [{ ...product, sku: 'SKU-ONE', quantity: 2 }, { ...product, sku: 'SKU-TWO', quantity: 3 }] }] })
    const { wrapper } = await setup()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.findAll('.rma-product')).toHaveLength(2)
    expect(wrapper.get('.rma-order-number').text()).toContain('2 款商品 · 5 件')
    expect(wrapper.get('.rma-amount').text()).toContain('$10.00')
    expect(wrapper.get('.rma-refund').text()).toContain('$3.00')
  })
  it('pairs each RMA bill with its type instead of collapsing bills of the same type', async () => {
    const refund = page.items[0]!.rmaCases[0]!
    vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, rmaCases: [refund, { ...refund, id: 'r3', number: 'RMA-002' }, { ...refund, id: 'r4', number: null }] }] })
    const { wrapper } = await setup()
    const bills = wrapper.findAll('.rma-bill')
    expect(bills.map(bill => bill.text())).toEqual(['仅退款RMA-001', '仅退款RMA-002', '仅退款—'])
    expect(wrapper.get('.rma-types').attributes('data-label')).toBe('RMA单')
    expect(wrapper.findAll('select[aria-label="售后类型筛选"] option')).toHaveLength(4)
  })
  it('does not display a response with mutually conflicting after-sales types', async () => {
    const refund = page.items[0]!.rmaCases[0]!
    vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, rmaCases: [refund, { ...refund, id: 'return', type: 'return_refund' }] }] })
    const { wrapper } = await setup()
    expect(wrapper.find('tbody').exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('售后类型存在冲突')
  })
  it('loads immediately after removing a retired event-type bookmark', async () => {
    vi.mocked(getRmaOrders).mockResolvedValue(page)
    const { wrapper, router } = await setup('/workbench/sales?queue=rma&rmaType=cancellation')
    expect(router.currentRoute.value.query.rmaType).toBeUndefined()
    expect(wrapper.get('tbody .rma-order-number').text()).toContain('TO261104036001')
  })
  it('discards pending RMA responses after account switching', async () => {
    let resolve!: (page: RmaPage) => void; vi.mocked(getRmaOrders).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { wrapper } = await setup(); invalidateSession(); resolve(page); await flushPromises()
    expect(wrapper.text()).not.toContain('TO261104036001')
  })
})

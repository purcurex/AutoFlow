import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RmaOrdersView from '@/views/autoflow/RmaOrdersView.vue'
import { getRmaOrders, exportRmaOrders, hasRmaTypeConflict, type RmaPage } from '@/api/rma-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { invalidateSession } from '@/utils/session'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
vi.mock('@/api/workbench-replica', () => ({ getWorkbenchReplicaStatus: vi.fn().mockResolvedValue({ readMode: 'live' }), requestWorkbenchReplicaSync: vi.fn(), getWorkbenchReplicaJob: vi.fn() }))
vi.mock('@/api/rma-orders', async importOriginal => ({ ...await importOriginal<typeof import('@/api/rma-orders')>(), getRmaOrders: vi.fn(), exportRmaOrders: vi.fn() }))
vi.mock('@/utils/export', () => ({ downloadBlob: vi.fn() }))
const page: RmaPage = { source: 'mock', refreshedAt: '2026-11-05T00:00:00Z', page: 1, pageSize: 100, total: 1, departments: [], totals: { orderCount: 1, caseCount: 1, itemQuantity: 1, amountsByCurrency: [{ currency: 'USD', amount: 10 }] }, items: [{ ...mockFopOrders[0]!, id: 'r1', sourceOrderId: 'o1', orderNumber: 'TO261104036001', amount: 10, currency: 'USD', rmaUpdatedAt: '2026-11-05T00:00:00Z', orderTags: ['intercepted'], refundAmounts: [{ currency: 'USD', amount: 3 }], rmaCases: [ { id: 'r1', orderId: 'o1', type: 'refund', isOpen: true, number: 'RMA-001', stage: '退款待审核', reason: '<img src=x onerror=alert(1)>', requestedAmount: 5, currency: 'USD', createdAt: null, updatedAt: null } ] }] }
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.clearAllMocks() })
async function setup(path = '/workbench/sales?queue=rma') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/sales', component: RmaOrdersView }] }); await router.push(path)
  const wrapper = mount(RmaOrdersView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } }); mounted.push(wrapper); await flushPromises(); return { wrapper, router }
}
describe('sales RMA workbench', () => {
  it('clears selections and rereads the local list when source synchronization succeeds', async () => {
    vi.mocked(getRmaOrders).mockResolvedValue(page)
    const { wrapper } = await setup()
    expect(wrapper.findAll('thead th:first-child input[type=checkbox]')).toHaveLength(1)
    await wrapper.get('thead input[aria-label="全选本页售后单"]').setValue(true)
    expect(wrapper.find('[data-testid="sync-workbench"]').exists()).toBe(false)
    wrapper.getComponent(WorkbenchTaskHeading).vm.$emit('replica-synced'); await flushPromises()
    expect(getRmaOrders).toHaveBeenCalledTimes(2)
    expect((wrapper.get('input[aria-label="选择售后单 RMA-001"]').element as HTMLInputElement).checked).toBe(false)
  })
  it('distinguishes an unconnected RMA integration from a genuine empty list', async () => {
    vi.mocked(getRmaOrders).mockRejectedValue({ code: 'fop_rma_not_configured' })
    const { wrapper } = await setup()
    expect(wrapper.get('[role="alert"]').text()).toContain('业务数据暂不可用')
    expect(wrapper.find('.rma-empty').exists()).toBe(false)
    expect(wrapper.get('.result-count').text()).toBe('—')
    expect(wrapper.find('tbody tr:not(.workbench-state-row)').exists()).toBe(false)
  })
  it.each([
    ['workbench_replica_not_initialized', '业务数据暂不可用'],
    ['workbench_replica_incomplete', '本地工作台数据尚不完整'],
  ])('keeps unavailable local data distinct from a genuine empty list for %s', async (code, message) => {
    vi.mocked(getRmaOrders).mockRejectedValue({ code })
    const { wrapper } = await setup()
    expect(wrapper.get('[role="alert"]').text()).toContain(message)
    expect(wrapper.get('.result-count').text()).toBe('—')
    expect(wrapper.find('.rma-empty').exists()).toBe(false)
    expect(wrapper.find('tbody tr:not(.workbench-state-row)').exists()).toBe(false)
  })
  it('treats reasons as text and exports selected RMA IDs', async () => {
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
    expect(getRmaOrders).toHaveBeenLastCalledWith(expect.objectContaining({ flowStatus: 'active', pageSize: 100 }), expect.any(AbortSignal))
    await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
    expect(exportRmaOrders).toHaveBeenLastCalledWith(expect.anything(), 'filtered', [], expect.any(AbortSignal))
    expect(wrapper.findAll('thead th:first-child input[type=checkbox]')).toHaveLength(1)
    await wrapper.get('thead input[aria-label="全选本页售后单"]').setValue(true)
    await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
    expect(exportRmaOrders).toHaveBeenLastCalledWith(expect.anything(), 'selected', ['r1'], expect.any(AbortSignal))
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
    vi.mocked(getRmaOrders).mockResolvedValue({ ...page, total:3, items: [refund,{...refund,id:'r3',number:'RMA-002'},{...refund,id:'r4',number:null}].map(item=>({...page.items[0]!,id:item.id,rmaCases:[item]})) })
    const { wrapper } = await setup()
    const bills = wrapper.findAll('.rma-bill')
    expect(bills.map(bill => bill.text())).toEqual(['仅退款RMA-001', '仅退款RMA-002', '仅退款—'])
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
    expect(wrapper.findAll('.rma-types')[0]!.attributes('data-label')).toBe('RMA单')
    expect(wrapper.findAll('select[aria-label="售后类型筛选"] option')).toHaveLength(4)
  })
  it('does not display a response with mutually conflicting after-sales types', async () => {
    const refund = page.items[0]!.rmaCases[0]!
    vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, rmaCases: [refund, { ...refund, id: 'return', type: 'return_refund' }] }] })
    const { wrapper } = await setup()
    expect(wrapper.find('tbody tr:not(.workbench-state-row)').exists()).toBe(false)
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

it('allows different closed historical RMA types while rejecting simultaneous active conflicts', () => {
  expect(hasRmaTypeConflict([{ type: 'refund', isOpen: false }, { type: 'reshipment', isOpen: false }])).toBe(false)
  expect(hasRmaTypeConflict([{ type: 'refund', isOpen: true }, { type: 'reshipment', isOpen: true }])).toBe(true)
})
it('shows missing settlement currency without inventing a yuan or dollar amount', async () => {
  vi.mocked(getRmaOrders).mockResolvedValue({ ...page, totals: { ...page.totals, amountsByCurrency: [] }, items: page.items.map(row => ({ ...row, currency: 'XXX' })) })
  const { wrapper } = await setup()
  expect(wrapper.text()).not.toContain('币种未提供')
  expect(wrapper.text()).not.toContain('¤')
})

it('does not query on timers, focus, visibility changes or network reconnection', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    vi.mocked(getRmaOrders).mockResolvedValue(page)
    const { wrapper } = await setup()
    const baseline = vi.mocked(getRmaOrders).mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    window.dispatchEvent(new Event('focus'))
    window.document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(getRmaOrders).toHaveBeenCalledTimes(baseline)
    expect(wrapper.text()).toContain('手动刷新')
    wrapper.unmount()
  } finally { vi.useRealTimers() }
})

it('labels uncollected counts and empty states without implying a business zero', async () => {
  vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [], total: 0, dataAvailability: { mode: 'collected', complete: false, missingDatasets: ['rma'] } })
  const { wrapper } = await setup()
  expect(wrapper.get('.result-count').text()).toBe('—')
  expect(wrapper.text()).not.toContain('售后数据尚未接入')
  expect(wrapper.text()).not.toContain('暂无符合条件')
  wrapper.unmount()
})

it('labels partial captured coverage when filters return zero without implying company-wide zero or dollar totals', async () => {
  vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [], total: 0, totals: { ...page.totals, orderCount: 0, caseCount: 0, complete: false, amountsByCurrency: [] }, dataAvailability: { mode: 'collected', complete: false, queueAvailable: true, coverage: 'partial_customer_scan', reason: '部分付款客户覆盖' } } as RmaPage)
  const { wrapper } = await setup()
  expect(wrapper.get('.result-count').text()).toContain('共 0')
  expect(wrapper.get('.workbench-table-state').text()).toContain('暂无符合条件的售后订单')
  expect(wrapper.text()).not.toContain('$0.00')
})
it('labels scoped RMA totals as captured values and shows native after-sales quantity',async()=>{
 vi.mocked(getRmaOrders).mockResolvedValue({...page,totals:{...page.totals,itemQuantity:4,complete:true},dataAvailability:{mode:'collected',complete:false,queueAvailable:true,coverage:'partial_customer_scan'}} as RmaPage)
 const {wrapper}=await setup()
 expect(wrapper.get('.rma-footer').text()).toContain('当前已采集')
 expect(wrapper.get('.rma-footer').text()).toContain('售后商品 4 件')
 expect(wrapper.get('.rma-footer').text()).toContain('$10.00')
})
it('preserves unknown native types and status in captured rows and never invents currency', async () => {
  vi.mocked(getRmaOrders).mockResolvedValue({ ...page, items: [{ ...page.items[0]!, currency: null, rmaCases: [{ ...page.items[0]!.rmaCases[0]!, type: 'unknown', rawType: 'Z', rawStatus: '9', isOpen: null }] }] } as RmaPage)
  const { wrapper } = await setup('/workbench/sales?queue=rma&flowStatus=all')
  expect(wrapper.get('.rma-types').text()).toContain('RMA-001')
  expect(wrapper.get('.rma-types').text()).not.toContain('类型未提供')
  expect(wrapper.get('.rma-types').text()).not.toContain('状态未提供')
  expect(wrapper.get('.rma-amount').text()).not.toContain('币种未提供')
  expect(wrapper.get('.rma-amount').text()).not.toContain('$')
})
it('collapses repeated SKU source lines within one RMA without changing selection or requesting details', async () => {
 vi.mocked(getRmaOrders).mockResolvedValue({...page,items:[{...page.items[0]!,items:[1,2,3].map(i=>({...page.items[0]!.items[0]!,name:`RMA line ${i}`}))}]})
 const {wrapper}=await setup()
 expect(wrapper.findAll('.rma-product')).toHaveLength(1)
 await wrapper.get('.product-lines-toggle').trigger('click')
 expect(wrapper.findAll('.rma-product')).toHaveLength(3)
 expect(wrapper.get('[data-testid=toggle-all-products]').text()).toContain('全部收起')
 await wrapper.get('[data-testid=toggle-all-products]').trigger('click')
 expect(wrapper.findAll('.rma-product')).toHaveLength(1)
 expect(wrapper.get('[data-testid=toggle-all-products]').text()).toContain('全部展开')
 await wrapper.get('[data-testid=toggle-all-products]').trigger('click')
 expect(wrapper.findAll('.rma-product')).toHaveLength(3)

 expect(wrapper.get('tbody input[type=checkbox]').element).toHaveProperty('checked',false)
 expect(getRmaOrders).toHaveBeenCalledTimes(1)
})

it('automatically reloads when its warehouse dropdown changes',async()=>{
vi.mocked(getRmaOrders).mockResolvedValue(page)
 const {wrapper}=await setup()
 const select=wrapper.findAll('select').find(s=>s.find('option[value="SZ"]').exists())!
 expect(select.text()).toContain('HangZhou');expect(select.text()).toContain('ShenZhen')
 await select.setValue('SZ');await flushPromises()
 expect(getRmaOrders).toHaveBeenLastCalledWith(expect.objectContaining({warehouseCode:'SZ',page:1}),expect.any(AbortSignal))
 wrapper.unmount()
})

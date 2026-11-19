import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FopOrdersView from '@/views/autoflow/FopOrdersView.vue'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { getFopOrders, matchesFopQueue, type FopOrder, type FopOrderQuery } from '@/api/fop-orders'
import { exportFopOrders } from '@/api/fop-order-export'
import api from '@/api'
import { invalidateSession } from '@/utils/session'
import { getTaskStatus } from '@/utils/workbench-status'

vi.mock('@/api/index', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('@/api/workbench-replica', () => ({ getWorkbenchReplicaStatus: vi.fn().mockResolvedValue({ readMode: 'live' }), requestWorkbenchReplicaSync: vi.fn(), getWorkbenchReplicaJob: vi.fn() }))
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))

const source = {
  skuId: 'sku-1', sku: 'SKU-001', lineIds: ['line-1', 'line-2'], demandQuantity: '10',
  fullPaymentQuantity: '4', depositQuantity: '2', directQuantity: '4',
  fullPaymentReserved: '1', fullPaymentUsed: '3', depositReserved: '2', depositUsed: '0', complete: true,
  records: [
    { stockId: 'stock-1', stockNumber: 'BK-001', recordId: 'record-1', orderNumber: 'TO-001', skuId: 'sku-1', skuNumber: 'SKU-001', stockType: '1' as const, status: '0' as const, quantity: '1', usedAt: null },
    { stockId: 'stock-1', recordId: 'record-2', orderNumber: 'TO-001', skuId: 'sku-1', skuNumber: 'SKU-001', stockType: '1' as const, status: '1' as const, quantity: '3', usedAt: '2026-11-18T02:00:00Z' },
    { stockId: 'stock-2', recordId: 'record-3', orderNumber: 'TO-001', skuId: 'sku-1', skuNumber: 'SKU-001', stockType: '2' as const, status: '0' as const, quantity: '2', usedAt: null },
  ],
}
const mounted: VueWrapper[] = []
function page(row: FopOrder) {
  return { source: 'fop', items: [row], total: 1, page: 1, pageSize: 100, departments: [], refreshedAt: '', totals: { orderCount: 1, itemQuantity: 10, amountsByCurrency: [] }, ...(row.dataQuality ? { replica: { dataMode: 'collected', readMode: 'local', complete: false }, dataAvailability: { mode: 'collected', complete: false } } : {}) }
}
async function setup(procurementSource: unknown = source, queue = 'procurement_shipping', role = 'procurement', patch: Partial<FopOrder> = {}) {
  const base = mockFopOrders.find(order => matchesFopQueue(order, queue as FopOrderQuery['queue']))!
  const row = { ...base, items: [{ ...base.items[0]!, id: 'line-1', sku: 'SKU-001', quantity: 5, procurementSource }, { ...base.items[0]!, id: 'line-2', sku: 'SKU-001', quantity: 5 }], ...patch } as FopOrder
  vi.mocked(api.get).mockResolvedValue(page(row))
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', name: 'RoleWorkbench', component: FopOrdersView }] })
  await router.push(`/workbench/${role}?queue=${queue}`)
  const wrapper = mount(FopOrdersView, { attachTo: document.body, global: { stubs: { Teleport: true }, plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
afterEach(() => { mounted.splice(0).forEach(wrapper => wrapper.unmount()); vi.clearAllMocks(); document.documentElement.classList.remove('dark'); document.documentElement.removeAttribute('data-palette') })

describe('SKU procurement sources', () => {
  it('replaces the fulfillment number with per-source documents, including multiple purchase orders', async () => {
    const { wrapper } = await setup({ ...source, documentGroups: [
      { source: 'full_payment', documents: [{ id: 'p1', number: 'CG-FULL-1' }, { id: 'p2', number: 'CG-FULL-2' }], unresolved: false },
      { source: 'deposit', documents: [{ id: 's2', number: 'IO-DEPOSIT' }], unresolved: false },
      { source: 'direct', documents: [{ id: 'p3', number: 'CG-DIRECT' }], unresolved: false },
    ] })
    await wrapper.get('button.procurement-source-summary').trigger('click')
    const identity = wrapper.get('.source-identity')
    expect(identity.get('[data-document-source="full_payment"]').text()).toBe('全款采购单CG-FULL-1CG-FULL-2')
    expect(identity.get('[data-document-source="deposit"]').text()).toBe('押金备货单IO-DEPOSIT')
    expect(identity.get('[data-document-source="direct"]').text()).toBe('直采采购单CG-DIRECT')
    expect(identity.text()).not.toContain('TO')
    expect(identity.findAll('button[aria-label^="复制 / Copy"]')).toHaveLength(4)
  })
  it('does not substitute TO numbers for missing purchase links and hides zero source groups', async () => {
    const { wrapper } = await setup({ ...source, depositQuantity: '0', directQuantity: '0', documentGroups: [{ source: 'full_payment', documents: [{ id: 'p1', number: 'CG-FULL' }], unresolved: true }] })
    await wrapper.get('button.procurement-source-summary').trigger('click')
    expect(wrapper.get('.source-identity').text()).toContain('部分单据暂未关联')
    expect(wrapper.findAll('.source-documents')).toHaveLength(1)
    expect(wrapper.get('.source-identity').text()).not.toContain('TO')
  })
  it.each([
    ['pending', 'supplier_pending'], ['partial', 'supplier_partial'], ['shipped', 'shipped'],
    ['unknown', 'unknown'], ['not_required', 'not_required'], [undefined, 'purchase_order_pending'],
  ] as const)('uses native supplier shipment %s for the shipping queue without changing procurement stage', (nativeSupplierShipment, expected) => {
    const order = { ...mockFopOrders[0]!, nativeProcurementCaptured: true, procurementStage: 'purchase_order_pending', nativeSupplierShipment }
    expect(getTaskStatus(order, 'procurement_shipping')).toBe(expected)
    expect(getTaskStatus(order, 'procurement')).toBe('purchase_order_pending')
  })
  it.each([
    ['pending', 'supplier_pending', '供应商待发货'],
    ['partial', 'supplier_partial', '供应商部分发货'],
  ] as const)('keeps mixed direct-purchase and stock-shipment orders in both filtered lists (%s)', async (shipment, taskStatus, label) => {
    const base = mockFopOrders.find(order => matchesFopQueue(order, 'procurement_shipping'))!
    const patch = { sourcePurchaseStatus: '0', items: [{ ...base.items[0]!, purchaseState: 'unpurchased', procurementSource: source }], nativeProcurementCaptured: true, nativeSupplierShipment: shipment, procurementStage: 'purchase_order_pending', procurementQueueFlags: { pending: true, shipping: true, completed: false }, dataQuality: { mode: 'collected', readOnly: true, missingFields: [], reasons: [] }, fulfillmentProgress: { ...base.fulfillmentProgress, supplierShipment: shipment } } as Partial<FopOrder>
    const { wrapper, router } = await setup(source, 'procurement_shipping', 'procurement', patch)
    await wrapper.get('select[aria-label="供应商发货状态筛选"]').setValue(taskStatus); await flushPromises()
    expect(wrapper.findAll('tbody .order-record')).toHaveLength(1)
    expect(wrapper.get('tbody .order-record').text()).toContain(label)
    expect(wrapper.find('.product-purchase-status').exists()).toBe(false)
    expect(wrapper.findAll('thead th').map(node => node.text())).toContain('供应商发货状态')
    expect(wrapper.get('tbody .order-record').text()).not.toContain('未采购')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await router.push({ query: { queue: 'procurement_shipping', procurementStage: taskStatus } }); await flushPromises()
    expect(wrapper.findAll('tbody .order-record')).toHaveLength(1)
    expect(wrapper.get('tbody .order-record').text()).toContain(label)
    expect(wrapper.find('.product-purchase-status').exists()).toBe(false)
    expect(wrapper.findAll('thead th').map(node => node.text())).toContain('供应商发货状态')
    expect(wrapper.get('tbody .order-record').text()).not.toContain('未采购')
    await router.push({ query: { queue: 'procurement', taskStatus: 'purchase_order_pending' } }); await flushPromises()
    expect(wrapper.findAll('tbody .order-record')).toHaveLength(1)
    expect(wrapper.get('tbody .order-record .procurement-stage').text()).toBe('待建采购订单')
    expect(wrapper.get('tbody .order-record').text()).not.toContain('未采购')
  })
  it('shows one mixed quantity strip for repeated SKU rows and opens read-only state details', async () => {
    const original = JSON.stringify(source)
    const { wrapper } = await setup()
    expect(wrapper.findAll('.procurement-source-summary')).toHaveLength(1)
    const button = wrapper.get('button.procurement-source-summary')
    expect(button.text()).toBe('全款 4 · 押金 2 · 直采 4')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-haspopup')).toBe('dialog')
    ;(button.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(button.element)
    await button.trigger('click')
    const dialog = wrapper.get('dialog')
    expect(dialog.text()).toContain('SKU需求数量10')
    expect(dialog.get('[data-source="full_payment"]').text()).toContain('全款备货413')
    expect(dialog.get('[data-source="deposit"]').text()).toContain('押金备货220')
    const rows = dialog.findAll('.procurement-source-records tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('BK-001')
    expect(rows[0]!.text()).not.toContain('备货记录ID')
    expect(rows[0]!.text()).toContain('待使用（预占）')
    expect(rows[1]!.text()).toContain('stock-1')
    expect(rows[1]!.text()).toContain('备货记录ID')
    expect(rows[1]!.text()).toContain('已使用（支付确认）')
    expect(rows[1]!.text()).toContain('2026/11/18 10:00')
    expect(dialog.findAll('input, select, textarea')).toHaveLength(0)
    expect(dialog.findAll('button')).toHaveLength(1)
    expect(api.post).not.toHaveBeenCalled()
    expect(JSON.stringify(source)).toBe(original)
    await dialog.get('button[aria-label="关闭 / Close"]').trigger('click')
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(document.activeElement).toBe(button.element)
  })
  it('keeps unknown quantities and states blank while exposing available incomplete records', async () => {
    const { wrapper } = await setup({ ...source, complete: false, depositQuantity: null, directQuantity: null, depositReserved: null, depositUsed: null, records: [{ ...source.records[2], status: null, stockType: null, quantity: null }] })
    expect(wrapper.get('.procurement-source-summary').text()).toBe('全款 4')
    expect(wrapper.get('.procurement-source-summary').attributes('title')).toContain('其余来源数据待补齐')
    await wrapper.get('.procurement-source-summary').trigger('click')
    const dialog = wrapper.get('dialog')
    expect(dialog.get('[data-source="deposit"]').text()).toBe('押金备货———')
    expect(dialog.get('[data-source="direct"]').text()).toBe('直接采购—')
    expect(dialog.get('.procurement-source-records tbody tr').text()).toBe('备货记录IDstock-2—————')
  })
  it.each([
    ['0', '未采购'], ['1', '采购中'], ['2', '已采购'], ['4', '已发货'], ['3', '已入库'],
    [null, '—'], [undefined, '—'], ['unknown', '—'],
  ])('shows stock native purchase status %s independently below its type', async (stockPurchaseStatus, expected) => {
    const { wrapper } = await setup({ ...source, records: [{ ...source.records[0], stockPurchaseStatus }] })
    await wrapper.get('.procurement-source-summary').trigger('click')
    const row = wrapper.get('.procurement-source-records tbody tr')
    expect(row.findAll('td')).toHaveLength(5)
    expect(row.get('.source-stock-purchase-status').text()).toBe(expected)
    expect(row.findAll('td')[1]!.text()).toBe(`全款备货${expected}`)
    expect(row.text()).toContain('待使用（预占）')
  })
  it.each([
    [false, '耗用明细待补齐'],
    [true, '暂无备货耗用记录'],
  ])('distinguishes incomplete record linkage from confirmed empty records (complete=%s)', async (complete, expected) => {
    const { wrapper } = await setup({ ...source, complete, records: [] })
    await wrapper.get('.procurement-source-summary').trigger('click')
    expect(wrapper.get('dialog .source-empty').text()).toBe(expected)
    expect(wrapper.get('.procurement-source-records caption').text()).toBe('备货耗用记录')
  })
  it('does not label a single product line as a multi-line SKU aggregate', async () => {
    const { wrapper } = await setup({ ...source, lineIds: ['line-1'] })
    expect(wrapper.get('.procurement-source-summary').text()).toBe('全款 4 · 押金 2 · 直采 4')
  })
  it.each([
    ['absent', undefined, ''],
    ['zero', { ...source, fullPaymentQuantity: '0', depositQuantity: '0.00', directQuantity: '0' }, ''],
    ['decimal and zero', { ...source, fullPaymentQuantity: '0', depositQuantity: '0.25', directQuantity: '9.75' }, '押金 0.25 · 直采 9.75'],
    ['only direct', { ...source, fullPaymentQuantity: '0', depositQuantity: '0', directQuantity: '10' }, '直采 10'],
    ['only fully paid', { ...source, fullPaymentQuantity: '10', depositQuantity: '0', directQuantity: '0' }, '全款 10'],
    ['only deposit', { ...source, fullPaymentQuantity: '0', depositQuantity: '10', directQuantity: '0' }, '押金 10'],
    ['missing and known', { ...source, fullPaymentQuantity: null, depositQuantity: '2', directQuantity: null }, '押金 2'],
  ])('renders %s quantities without inventing zero-valued sources', async (_label, value, expected) => {
    const { wrapper } = await setup(value === undefined ? null : value)
    expect(wrapper.find('.procurement-source-summary').exists()).toBe(Boolean(expected))
    if (expected) expect(wrapper.get('.procurement-source-summary').text()).toBe(expected)
  })
  it('keeps source controls out of sales fulfillment views', async () => {
    const { wrapper } = await setup(source, 'review', 'sales')
    expect(wrapper.find('.procurement-source-summary').exists()).toBe(false)
    expect(wrapper.find('select[aria-label="采购来源"]').exists()).toBe(false)
  })
  it.each(['procurement', 'procurement_shipping'])('applies and clears the source filter in %s without changing main columns', async queue => {
    const { wrapper, router } = await setup(source, queue)
    const headers = wrapper.findAll('thead th').map(node => node.text())
    const filter = wrapper.get('select[aria-label="采购来源"]')
    await filter.setValue('deposit'); await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ procurementSource: 'deposit', page: '1' })
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', expect.objectContaining({ params: expect.objectContaining({ procurementSource: 'deposit' }) }))
    expect(wrapper.findAll('thead th').map(node => node.text())).toEqual(headers)
    await filter.setValue(''); await flushPromises()
    expect(router.currentRoute.value.query.procurementSource).toBeUndefined()
    expect(api.get).toHaveBeenLastCalledWith('/autoflow/integrations/fop/fulfillment-orders', expect.objectContaining({ params: expect.objectContaining({ procurementSource: undefined }) }))
  })
  it('rejects unsupported source filters before sending a query', async () => {
    await expect(getFopOrders({ queue: 'review', procurementSource: 'deposit', page: 1, pageSize: 100 } as FopOrderQuery)).rejects.toThrow('Invalid procurement source')
    await expect(getFopOrders({ queue: 'procurement', procurementSource: 'other', page: 1, pageSize: 100 } as unknown as FopOrderQuery)).rejects.toThrow('Invalid procurement source')
    expect(api.get).not.toHaveBeenCalled()
  })
  it('preserves source scope in the export request', async () => {
    vi.mocked(api.post).mockResolvedValue(new Blob(['xlsx']))
    await exportFopOrders({ queue: 'procurement_shipping', procurementSource: 'full_payment', mode: 'filtered' } as Parameters<typeof exportFopOrders>[0])
    expect(api.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ procurementSource: 'full_payment' }), expect.any(Object))
  })
  it('keeps the same source details across light/dark theme changes without another query and clears them on session reset', async () => {
    const { wrapper } = await setup()
    await wrapper.get('.procurement-source-summary').trigger('click')
    const calls = vi.mocked(api.get).mock.calls.length
    for (const palette of ['blue', 'green', 'purple', 'orange']) for (const dark of [false, true]) {
      document.documentElement.setAttribute('data-palette', palette)
      document.documentElement.classList.toggle('dark', dark)
      await flushPromises()
      expect(wrapper.get('dialog').text()).toContain('已使用（支付确认）')
      expect(wrapper.get('.procurement-source-summary').text()).toBe('全款 4 · 押金 2 · 直采 4')
    }
    expect(api.get).toHaveBeenCalledTimes(calls)
    invalidateSession(); await flushPromises()
    expect(wrapper.find('dialog').exists()).toBe(false)
    expect(wrapper.find('.procurement-source-summary').exists()).toBe(false)
  })
})

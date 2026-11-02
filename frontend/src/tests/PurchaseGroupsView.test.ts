import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import PurchaseGroupsView from '@/views/autoflow/PurchaseGroupsView.vue'
import ProcurementOrdersView from '@/views/autoflow/ProcurementOrdersView.vue'
import api from '@/api/index'
import { useWorkbenchAccess, clearWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/index', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const group = { id: 'purchase:p1', kind: 'purchase', purchase: { id: 'p1', number: 'CG20261030000006', supplier: { id: 's', name: 'Supplier One' }, purchaseType: 'online', platform: '1688', platformOrderNumber: '5127833916176022434', payment: 'paid', placement: 'placed', paidAt: '2026-10-28T00:00:00Z' }, orderCount: 2, skuCount: 1, quantity: 4, shippedQuantity: 1, pendingQuantity: 3, shipment: 'partial', earliestReceiptAt: '2026-10-27T00:00:00Z' }
const row = { orderId: 'o1', orderNumber: 'SO-001', shopifyOrderNumber: '#1', customerName: 'Visible Customer', storeName: 'Store', ownerName: 'Alice', departmentName: '业务一部', warehouse: 'HZ', paidAt: '2026-10-27T00:00:00Z', lines: [{ fulfillmentLineId: 'f1', purchaseLineId: 'p1', sku: 'LINKED-SKU', name: 'Lamp', imageUrl: null, variant: '', quantity: 4, shippedQuantity: 1 }] }
const page = { items: [group], total: 1, page: 1, pageSize: 50, refreshedAt: '2026-10-29T00:00:00Z', source: 'mock', departments: [{ id: 'd1', name: '业务一部' }], totals: { groupCount: 1, purchaseCount: 1, orderCount: 2, uncreatedCount: 0, pendingQuantity: 3 } }
const detail = { group, items: [row], total: 21, page: 1, pageSize: 20 }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { clearWorkbenchAccess(); vi.resetAllMocks(); vi.mocked(api.get).mockImplementation(async url => String(url).includes('/purchase%3Ap1') ? detail : page) })
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function setup(path = '/workbench/procurement?queue=procurement_shipping', switcher = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: switcher ? ProcurementOrdersView : PurchaseGroupsView }] })
  await router.push(path)
  const wrapper = mount(switcher ? ProcurementOrdersView : PurchaseGroupsView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: switcher ? { FopOrdersView: { template: '<section><slot name="heading-actions" /><p>original fulfillment view</p></section>' } } : {} } })
  wrappers.push(wrapper); await flushPromises(); return { wrapper, router }
}
it('renders merged header with only linked source items and lazily paginates source rows', async () => {
  const { wrapper } = await setup()
  expect(wrapper.find('tbody').exists()).toBe(false)
  expect(vi.mocked(api.get).mock.calls).toHaveLength(1)
  await wrapper.get('.group-expand').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('CG20261030000006'); expect(wrapper.text()).toContain('Supplier One'); expect(wrapper.text()).toContain('Visible Customer'); expect(wrapper.text()).toContain('LINKED-SKU')
  expect(api.get).toHaveBeenCalledWith(expect.stringContaining('purchase-groups'), expect.objectContaining({ params: expect.objectContaining({ page: 1, pageSize: 50 }) }))
  await wrapper.get('.detail-pagination').findAll('button')[1].trigger('click'); await flushPromises()
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('purchase%3Ap1'), expect.objectContaining({ params: expect.objectContaining({ page: 2, pageSize: 20 }) }))
  await wrapper.get('.group-expand').trigger('click'); expect(wrapper.find('tbody').exists()).toBe(false)
})
it('defaults to fulfillment first, opts into purchases, and retains scope while clearing incompatible filters', async () => {
  const { wrapper, router } = await setup('/workbench/procurement?queue=procurement&departmentId=d1&search=Lamp&taskStatus=pending', true)
  expect(wrapper.text()).toContain('original fulfillment view')
  expect(wrapper.findAll('.purchase-view-switch button').map(b => b.text())).toEqual(['按履约单查看', '按采购单查看'])
  await wrapper.findAll('.purchase-view-switch button')[1].trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('CG20261030000006')
  expect(router.currentRoute.value.query).toMatchObject({ view: 'purchase', departmentId: 'd1', search: 'Lamp' })
  expect(router.currentRoute.value.query.taskStatus).toBeUndefined()
})
it('expands and collapses this page, retaining a group-level follow-up without row actions', async () => {
  const second = { ...group, id: 'purchase:p2', purchase: { ...group.purchase, id: 'p2', number: 'CG20261030000007' } }
  vi.mocked(api.get).mockImplementation(async url => String(url).endsWith('/purchase-groups') ? { ...page, items: [group, second], total: 2 } : { ...detail, group: String(url).includes('p2') ? second : group })
  const { wrapper } = await setup()
  expect(wrapper.find('tbody').exists()).toBe(false)
  const all = () => wrapper.findAll('button').find(b => /全部展开|全部收起/.test(b.text()))!
  await all().trigger('click'); await flushPromises()
  expect(wrapper.findAll('tbody')).toHaveLength(2)
  expect(wrapper.text()).toContain('Visible Customer')
  expect(wrapper.find('tbody .source-follow-up').exists()).toBe(false)
  expect(wrapper.get('.group-head .group-follow-up').text()).toBe('采购催办')
  await all().trigger('click'); await flushPromises()
  expect(wrapper.find('tbody').exists()).toBe(false)
})
it('exports selected groups or filtered results and resets selection on filter changes', async () => {
  const create = vi.fn(() => 'blob:test'); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.mocked(api.post).mockResolvedValue(new Blob(['xlsx']))
  const { wrapper, router } = await setup()
  await wrapper.get('.group-head input[type=checkbox]').setValue(true)
  const exportButton = () => wrapper.findAll('button').find(b => b.text().includes('导出'))!
  await exportButton().trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('/export'), expect.objectContaining({ mode: 'selected', groupIds: ['purchase:p1'] }), expect.anything())
  await wrapper.get('input[type=search]').setValue('Lamp'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(router.currentRoute.value.query.search).toBe('Lamp')
  expect((wrapper.get('.group-head input').element as HTMLInputElement).checked).toBe(false)
  await exportButton().trigger('click'); await flushPromises()
  const payload = vi.mocked(api.post).mock.calls[1][1] as Record<string, unknown>
  expect(payload).toMatchObject({ mode: 'filtered', search: 'Lamp' }); expect(payload).not.toHaveProperty('page'); expect(payload).not.toHaveProperty('groupIds')
})
it('clears visible rows on account reset and ignores old pending detail responses', async () => {
  let resolve!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => String(url).includes('/purchase%3Ap1') ? new Promise(r => resolve = r) : page)
  const { wrapper } = await setup(); await wrapper.get('.group-expand').trigger('click'); await flushPromises(); invalidateSession(); await flushPromises()
  resolve(detail); await flushPromises()
  expect(wrapper.text()).not.toContain('CG20261030000006'); expect(wrapper.text()).not.toContain('Visible Customer')
})
it('recovers page 2 to page 1 when filtered groups become empty', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [], total: 0 })
  const { router } = await setup('/workbench/procurement?queue=procurement_shipping&page=2')
  expect(router.currentRoute.value.query.page).toBe('1')
})

it.each([
  ['purchase', '', true],
  ['fulfillment', '', false],
  ['purchase', '&view=fulfillment', false],
  ['fulfillment', '&view=purchase', true],
] as const)('uses account default %s with query %s (purchase: %s)', async (defaultProcurementView, suffix, purchase) => {
  useWorkbenchAccess().access.value = { roles: ['sales', 'procurement'], isAdmin: false, defaultProcurementView }
  const { wrapper } = await setup('/workbench/procurement?queue=procurement_shipping' + suffix, true)
  expect(wrapper.text().includes('original fulfillment view')).toBe(!purchase)
  expect(wrapper.find('.group-head').exists()).toBe(purchase)
  expect(wrapper.find('tbody').exists()).toBe(false)
})

it.each([
  ['offline', null, null, '线下采购'],
  ['online', 'other', 'WEB-123', '线上 · 其他平台'],
  ['online', '1688', '5127833916176022434', '线上 · 1688'],
])('shows the actual purchase channel %s/%s and only offers Wangwang for 1688', async (purchaseType, platform, platformOrderNumber, label) => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...group, purchase: { ...group.purchase, purchaseType, platform, platformOrderNumber } }] })
  const { wrapper } = await setup()
  expect(wrapper.get('.group-head').text()).toContain(label)
  expect(wrapper.find('button.group-follow-up').exists()).toBe(platform === '1688')
  expect(wrapper.find('.platform-number').exists()).toBe(platformOrderNumber !== null)
  if (platform === 'other') expect(wrapper.get('.platform-label').text()).toBe('平台订单')
  expect(wrapper.text()).not.toContain('采购关联待确认')
  expect(wrapper.get('.result-count').text()).not.toContain('待确认')
})
it.each([
  ['unpaid', 'pending', 'pending', '待推1688采购', 'warning'],
  ['unpaid', 'placed', 'pending', '待付款', 'warning'],
  ['partial', 'placed', 'pending', '部分付款', 'warning'],
  ['refunded', 'pending', 'pending', '已退款待处理', 'danger'],
  ['paid', 'placed', 'pending', '供应商待发货', 'success'],
  ['paid', 'placed', 'partial', '供应商部分发货', 'success'],
])('emphasizes only the current action for %s / %s / %s', async (payment, placement, shipment, label, tone) => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...group, shipment, purchase: { ...group.purchase, payment, placement, paidAt: new Date().toISOString() } }] })
  const { wrapper } = await setup(`/workbench/procurement?queue=${payment === 'paid' ? 'procurement_shipping' : 'procurement'}`)
  if (payment !== 'paid') expect(wrapper.get('.group-badges').text()).not.toContain('供应商')
  const active = wrapper.findAll('.group-badges [data-current=true]')
  expect(active).toHaveLength(1)
  expect(active[0].text()).toBe(label)
  expect(active[0].attributes('data-tone')).toBe(tone)
})
it('preserves shipment overdue severity on the emphasized current stage', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...group, shipment: 'pending', purchase: { ...group.purchase, paidAt: new Date(Date.now() - 49 * 3600_000).toISOString() } }] })
  const { wrapper } = await setup()
  expect(wrapper.get('.group-badges [data-current=true]').attributes('data-tone')).toBe('danger')
  expect(wrapper.get('.group-badges [data-current=true]').attributes('title')).toContain('超过48小时')
})
it('filters purchase progress in the secondary toolbar and carries it through details and export', async () => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.mocked(api.post).mockResolvedValue(new Blob(['xlsx']))
  const { wrapper, router } = await setup('/workbench/procurement?queue=procurement&departmentId=d1')
  await wrapper.get('.workbench-filter-secondary select[aria-label="采购进度筛选"]').setValue('payment_pending'); await flushPromises()
  expect(router.currentRoute.value.query.purchaseStage).toBe('payment_pending')
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('purchase-groups'), expect.objectContaining({ params: expect.objectContaining({ purchaseStage: 'payment_pending', departmentId: 'd1', page: 1 }) }))
  expect(wrapper.find('tbody').exists()).toBe(false)
  await wrapper.get('.group-expand').trigger('click'); await flushPromises()
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('purchase%3Ap1'), expect.objectContaining({ params: expect.objectContaining({ purchaseStage: 'payment_pending' }) }))
  await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('/export'), expect.objectContaining({ purchaseStage: 'payment_pending', mode: 'filtered' }), expect.anything())
  await router.push('/workbench/procurement?queue=procurement_shipping&purchaseStage=payment_pending'); await flushPromises()
  expect(wrapper.find('select[aria-label="采购进度筛选"]').exists()).toBe(false)
  expect(api.get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ params: expect.objectContaining({ purchaseStage: undefined }) }))
})


it.each(['procurement', 'procurement_shipping'])('shows the account department for purchase groups in %s', async queue => {
  useWorkbenchAccess().access.value = { roles: [], isAdmin: false, businessRole: 'salesperson', businessDepartment: { id: 'd1', name: '业务一部' } }
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [], departments: [], total: 0 })
  const { wrapper, router } = await setup(`/workbench/procurement?queue=${queue}`)
  expect(wrapper.findAll('select')[0].get('option[value=""]').text()).toBe('业务一部')
  expect(router.currentRoute.value.query.departmentId).toBeUndefined()
})

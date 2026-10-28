import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { beforeEach, expect, it, vi } from 'vitest'
import StockOrdersView from '@/views/autoflow/StockOrdersView.vue'
import api from '@/api/index'
import { invalidateSession } from '@/utils/session'

async function exportNow(wrapper: Pick<VueWrapper, 'get'>) {
  await wrapper.get('[data-testid="export-orders"]').trigger('click'); await flushPromises()
}
vi.mock('@/api/index', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const row = { id: 's1', stockNumber: 'BH261028000001', stockType: 'full_payment', items: [{ sku: 'SKU-1', name: 'Lamp', imageUrl: null, variant: 'White', quantity: 20 }], amount: 100, currency: 'USD', paidAt: '2026-10-01T01:00:00Z', customerId: 'c1', customerCode: 'C1', customerName: 'Customer One', storeName: 'Shop One', owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, warehouse: '杭州仓', warehouseCode: 'HZ', purchaseStatus: 'received' }
const response = { source: 'mock', refreshedAt: '2026-10-28T00:00:00Z', items: [row], total: 1, page: 1, pageSize: 50, departments: [row.department], totals: { orderCount: 1, itemQuantity: 20, amounts: [{ currency: 'USD', amount: 100 }] } }
it('prioritizes unpurchased orders and shares supplier shipment labels and aging without using customer payment time', async () => {
  const now = Date.now()
  const statuses = ['unpurchased', 'partial', 'purchased', 'purchased', 'purchased', 'purchased']
  const times = [null, null, null, 12, 30, 60]
  vi.mocked(api.get).mockResolvedValue({ ...response, items: statuses.map((purchaseStatus, i) => ({ ...row, id: `s${i}`, purchaseStatus, procurementPaidAt: typeof times[i] === 'number' ? new Date(now - times[i]! * 3600000).toISOString() : null })) })
  const { wrapper } = await setup('/workbench/procurement?queue=stock_procurement', true)
  const statusesInTable = wrapper.findAll('td[data-label="采购状态"]')
  expect(statusesInTable.map(cell => cell.text())).toEqual(['未采购', '部分采购', '供应商待发货', '供应商待发货', '供应商待发货', '供应商待发货'])
  expect(statusesInTable.map(cell => cell.get('[data-tone]').attributes('data-tone'))).toEqual(['info', 'info', 'success', 'success', 'warning', 'danger'])
  expect(wrapper.findAll('select').find(s => s.text().includes('未采购'))!.text()).toContain('供应商待发货')
  wrapper.unmount()
})
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.get).mockImplementation(async (url) => String(url).endsWith('stock-inventory') ? { ...response, items: [], total: 0, customerId: null } : response) })
async function setup(path = '/workbench/sales?queue=stock', procurement = false) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: StockOrdersView }] })
  await router.push(path)
  const wrapper = mount(StockOrdersView, { props: { procurement }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises()
  return { wrapper, router }
}
it('renders stock-specific completed orders, no fulfillment columns, 50 rows by default', async () => {
  const { wrapper } = await setup()
  expect(wrapper.find('thead').text()).toContain('备货单号')
  expect(wrapper.find('thead').text()).toContain('收货仓库')
  expect(wrapper.find('thead').text()).not.toMatch(/Shopify|Customer|履约|物流|C端/)
  expect(wrapper.find('tbody').text()).toContain('已入库')
  expect(wrapper.find('tbody').text()).toContain('全款备货')
  expect(api.get).toHaveBeenCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ page: 1, pageSize: 50 }) }))
  wrapper.unmount()
})
it('renders lifecycle states and applies the status filter to queries and both exports', async () => {
  const rows = ['unpaid', 'paid', 'approved', null].map((orderStatus, i) => ({ ...row, id: `s${i}`, orderStatus }))
  vi.mocked(api.get).mockResolvedValue({ ...response, items: rows, total: 101 })
  vi.mocked(api.post).mockRejectedValue(new Error('download unavailable'))
  const { wrapper, router } = await setup('/workbench/sales?queue=stock&warehouseCode=HZ&departmentId=d1&search=Lamp&page=2')
  expect(wrapper.findAll('td[data-label="备货订单状态"]').map(cell => cell.text())).toEqual(['未支付', '已支付', '已审核', '—'])
  await wrapper.get('tbody input[type=checkbox]').setValue(true)
  const select = wrapper.findAll('select').find(s => s.text().includes('未支付'))!
  expect(select).toBeDefined()
  expect(select.findAll('option').map(o => o.text())).toEqual(['全部', '未支付', '已支付', '已审核'])
  await select.setValue('paid'); await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ orderStatus: 'paid', search: 'Lamp', warehouseCode: 'HZ', departmentId: 'd1' })
  expect(router.currentRoute.value.query.page).toBeUndefined()
  expect((wrapper.get('tbody input[type=checkbox]').element as HTMLInputElement).checked).toBe(false)
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ orderStatus: 'paid', page: 1 }) }))
  await wrapper.get('tbody input[type=checkbox]').setValue(true)
  await exportNow(wrapper)
  await wrapper.get('tbody input[type=checkbox]').setValue(false)
  await exportNow(wrapper)
  expect(vi.mocked(api.post).mock.calls.map(call => (call[1] as Record<string, unknown>).orderStatus)).toEqual(['paid', 'paid'])
  wrapper.unmount()
})
it('automatically clears search, retains scope and resets pagination', async () => {
  const { wrapper, router } = await setup('/workbench/sales?queue=stock&search=Alice&warehouseCode=HZ&departmentId=d1&page=2')
  await wrapper.get('input[type=search]').setValue('')
  await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ queue: 'stock', warehouseCode: 'HZ', departmentId: 'd1' })
  expect(router.currentRoute.value.query.search).toBeUndefined()
  expect(router.currentRoute.value.query.page).toBeUndefined()
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ page: 1, warehouseCode: 'HZ', departmentId: 'd1' }) }))
  wrapper.unmount()
})
it('opens the stock inventory dialog and clears old data on account change', async () => {
  const { wrapper } = await setup()
  const button = wrapper.findAll('button').find(b => b.text().includes('查询备货库存'))!
  await button.trigger('click'); await flushPromises()
  expect(document.querySelector('dialog')?.textContent).toContain('客户')
  invalidateSession(); await flushPromises()
  expect(wrapper.text()).not.toContain('Customer One')
  expect(document.querySelector('dialog')).toBeNull()
  wrapper.unmount()
})
it('makes an incoming salesperson filter clearable and clears it when changing departments', async () => {
  vi.mocked(api.get).mockResolvedValue({ ...response, departments: [row.department, { id: 'd2', name: '业务二部' }] })
  const { wrapper, router } = await setup('/workbench/sales?queue=stock&ownerId=e1&departmentId=d1')
  expect(wrapper.get('button[aria-label="清除业务员筛选"]').text()).toContain('Alice')
  await wrapper.get('button[aria-label="清除业务员筛选"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.ownerId).toBeUndefined()
  await router.push('/workbench/sales?queue=stock&ownerId=e1&departmentId=d1'); await flushPromises()
  await wrapper.findAll('select').find(s => s.text().includes('业务二部'))!.setValue('d2'); await flushPromises()
  expect(router.currentRoute.value.query.departmentId).toBe('d2')
  expect(router.currentRoute.value.query.ownerId).toBeUndefined()
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ departmentId: 'd2', ownerId: undefined }) }))
  wrapper.unmount()
})
it('exports selected IDs or filtered results without pagination', async () => {
  const create = vi.fn(() => 'blob:test'), revoke = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  vi.mocked(api.post).mockResolvedValue(new Blob(['xlsx']))
  const { wrapper } = await setup('/workbench/sales?queue=stock&warehouseCode=HZ')
  await wrapper.get('tbody input[type=checkbox]').setValue(true)
  await exportNow(wrapper)
  expect(api.post).toHaveBeenCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ mode: 'selected', orderIds: ['s1'], warehouseCode: 'HZ' }), expect.anything())
  await wrapper.get('tbody input[type=checkbox]').setValue(false)
  await exportNow(wrapper)
  const payload = vi.mocked(api.post).mock.calls[1][1] as Record<string, unknown>
  expect(payload.mode).toBe('filtered'); expect(payload).not.toHaveProperty('page'); expect(payload).not.toHaveProperty('orderIds')
  expect(create).toHaveBeenCalledTimes(2)
  wrapper.unmount(); vi.unstubAllGlobals()
})

it('uses the procurement queue for listing and export and offers unfinished purchases and purchased stock awaiting shipment', async () => {
  const { wrapper } = await setup('/workbench/procurement?queue=stock_procurement', true)
  expect(wrapper.get('h2').text()).toContain('备货待采购清单')
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ queue: 'procurement' }) }))
  const options = wrapper.findAll('select').find(s => s.text().includes('未采购'))!
  expect(options.findAll('option').map(o => o.text())).toEqual(['全部', '未采购', '部分采购', '供应商待发货'])
  await options.setValue('purchased'); await flushPromises()
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ queue: 'procurement', purchaseStatus: 'purchased' }) }))
  vi.mocked(api.post).mockRejectedValue(new Error('test export'))
  await exportNow(wrapper)
  expect(api.post).toHaveBeenCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ queue: 'procurement', purchaseStatus: 'purchased', mode: 'filtered' }), expect.anything())
  wrapper.unmount()
})

it('exports all filtered rows on one click and switches to selected rows without a menu', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('download unavailable'))
  const { wrapper } = await setup('/workbench/sales?queue=stock&search=Lamp')
  const actions = wrapper.get('.workbench-list-actions')
  const button = actions.findAll('button').find(b => b.text().includes('导出'))!
  expect(actions.findAll('button').filter(b => b.text().includes('导出'))).toHaveLength(1)
  await button.trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ mode: 'filtered', search: 'Lamp' }), expect.anything())
  expect(document.querySelector('[role="menu"][aria-label="导出范围"]')).toBeNull()
  await wrapper.get('tbody input[type=checkbox]').setValue(true)
  await button.trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ mode: 'selected', orderIds: ['s1'] }), expect.anything())
  await wrapper.get('tbody input[type=checkbox]').setValue(false)
  await button.trigger('click'); await flushPromises()
  expect((vi.mocked(api.post).mock.calls.at(-1)![1] as Record<string,unknown>).mode).toBe('filtered')
  wrapper.unmount()
})


it.each([['备货订单状态', 'orderStatus', false], ['采购状态', 'purchaseStatus', false], ['采购状态', 'purchaseStatus', true]] as const)('sorts %s in procurement=%s, resets page/selection and preserves the applied scope in export', async (label, sortBy, procurement) => {
  vi.mocked(api.post).mockRejectedValue(new Error('download unavailable'))
  const { wrapper, router } = await setup(`/workbench/${procurement ? 'procurement?queue=stock_procurement' : 'sales?queue=stock'}&page=2&search=Lamp&warehouseCode=HZ&departmentId=d1`, procurement)
  await wrapper.get('tbody input[type=checkbox]').setValue(true)
  const button = wrapper.findAll('thead button').find(b => b.text() === label)
  expect(button).toBeDefined()
  await button!.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ sortBy, sortOrder: 'asc', warehouseCode: 'HZ', departmentId: 'd1', search: 'Lamp' })
  expect(router.currentRoute.value.query.page).toBeUndefined()
  expect((wrapper.get('tbody input[type=checkbox]').element as HTMLInputElement).checked).toBe(false)
  expect(wrapper.get('th[aria-sort="ascending"]').text()).toBe(label)
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ sortBy, sortOrder: 'asc', page: 1 }) }))
  await button!.trigger('click'); await flushPromises()
  expect(wrapper.get('th[aria-sort="descending"]').text()).toBe(label)
  await exportNow(wrapper)
  expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ sortBy, sortOrder: 'desc', mode: 'filtered', search: 'Lamp', warehouseCode: 'HZ' }), expect.anything())
  await wrapper.findAll('thead button').find(b => b.text() === '收款时间')!.trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ sortBy: 'paidAt', sortOrder: 'asc' })
  wrapper.unmount()
})

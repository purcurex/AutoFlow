import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { beforeEach, expect, it, vi } from 'vitest'
import StockOrdersView from '@/views/autoflow/StockOrdersView.vue'
import api from '@/api/index'
import { invalidateSession } from '@/utils/session'

vi.mock('@/api/index', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const row = { id: 's1', stockNumber: 'BH261028000001', stockType: 'full_payment', items: [{ sku: 'SKU-1', name: 'Lamp', imageUrl: null, variant: 'White', quantity: 20 }], amount: 100, currency: 'USD', paidAt: '2026-10-01T01:00:00Z', customerId: 'c1', customerCode: 'C1', customerName: 'Customer One', storeName: 'Shop One', owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, warehouse: '杭州仓', warehouseCode: 'HZ', purchaseStatus: 'received' }
const response = { source: 'mock', refreshedAt: '2026-10-28T00:00:00Z', items: [row], total: 1, page: 1, pageSize: 50, departments: [row.department], totals: { orderCount: 1, itemQuantity: 20, amounts: [{ currency: 'USD', amount: 100 }] } }
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
  await wrapper.findAll('button').find(b => b.text().includes('导出所选'))!.trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ mode: 'selected', orderIds: ['s1'], warehouseCode: 'HZ' }), expect.anything())
  await wrapper.findAll('button').find(b => b.text().includes('导出筛选结果'))!.trigger('click'); await flushPromises()
  const payload = vi.mocked(api.post).mock.calls[1][1] as Record<string, unknown>
  expect(payload.mode).toBe('filtered'); expect(payload).not.toHaveProperty('page'); expect(payload).not.toHaveProperty('orderIds')
  expect(create).toHaveBeenCalledTimes(2)
  wrapper.unmount(); vi.unstubAllGlobals()
})

it('uses the procurement queue for listing and export and offers only unfinished purchase states', async () => {
  const { wrapper } = await setup('/workbench/procurement?queue=stock_procurement', true)
  expect(wrapper.get('h2').text()).toContain('待采购待备货清单')
  expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('stock-orders'), expect.objectContaining({ params: expect.objectContaining({ queue: 'procurement' }) }))
  const options = wrapper.findAll('select').find(s => s.text().includes('未采购'))!
  expect(options.findAll('option').map(o => o.text())).toEqual(['全部', '未采购', '部分采购'])
  vi.mocked(api.post).mockRejectedValue(new Error('test export'))
  await wrapper.findAll('button').find(b => b.text() === '导出筛选结果')!.trigger('click'); await flushPromises()
  expect(api.post).toHaveBeenCalledWith(expect.stringContaining('stock-orders/export'), expect.objectContaining({ queue: 'procurement', mode: 'filtered' }), expect.anything())
  wrapper.unmount()
})

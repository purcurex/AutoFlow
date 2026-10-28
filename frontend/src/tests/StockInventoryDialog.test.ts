import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, expect, it, vi } from 'vitest'
import StockInventoryDialog from '@/components/autoflow/StockInventoryDialog.vue'
import { getStockCustomers, getStockInventory } from '@/api/fop-stock'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/fop-stock', () => ({ getStockCustomers: vi.fn(), getStockInventory: vi.fn() }))
const page = { source: 'mock' as const, customerId: 'c1', page: 1, pageSize: 50, total: 1, refreshedAt: '2026-10-28T01:00:00Z', items: [{ id: 'i1', customerId: 'c1', customerCode: 'C1', customerName: 'Client', owner: { id: 'e1', name: 'Alice' }, department: { id: 'd1', name: '业务一部' }, sku: 'SKU-1', name: 'Lamp', imageUrl: null, warehouse: '杭州仓', warehouseCode: 'HZ', fullPayment: { available: 12, locked: 3, onHand: 15 }, deposit: { available: 7, locked: 2, onHand: 9 }, onHand: 24 }] }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getStockCustomers).mockResolvedValue({ items: [{ id: 'c1', name: 'Client', code: 'C1' }, { id: 'c2', name: 'Client', code: 'C2' }], total: 2 }); vi.mocked(getStockInventory).mockResolvedValue(page) })
async function setup() { const wrapper = mount(StockInventoryDialog, { props: { departmentId: 'd1', warehouseCode: 'HZ' }, global: { stubs: { Teleport: true }, plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } }); await flushPromises(); return wrapper }
it('loads all authorized customers immediately and shows customer identity beside separate balances', async () => {
  vi.mocked(getStockInventory).mockResolvedValue({ ...page, total: 2, items: [page.items[0], { ...page.items[0], id: 'i2', customerId: 'c2', customerName: 'Client Two', customerCode: 'C2' }] })
  const wrapper = await setup()
  expect(getStockCustomers).not.toHaveBeenCalled()
  expect(getStockInventory).toHaveBeenCalledWith({ customerSearch: undefined, departmentId: 'd1', ownerId: undefined, warehouseCode: 'HZ', search: undefined, page: 1, pageSize: 50 })
  expect(wrapper.text()).toContain('Client Two')
  expect(wrapper.findAll('.inventory-balance').slice(0,2).map(c => c.text())).toEqual(['可用 12锁定 3 · 在库 15', '可用 7锁定 2 · 在库 9'])
  expect(wrapper.find('.inventory-total').text()).toBe('24')
  expect(wrapper.find('select[aria-label="选择客户"]').exists()).toBe(false)
  wrapper.unmount()
})
it('combines fuzzy customer/SKU search and clears only the cleared filter automatically', async () => {
  const wrapper = await setup()
  await wrapper.get('input[aria-label="搜索客户"]').setValue('client')
  await wrapper.get('input[aria-label="搜索库存 SKU"]').setValue('lamp')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(getStockInventory).toHaveBeenLastCalledWith(expect.objectContaining({ customerSearch: 'client', search: 'lamp' }))
  await wrapper.get('input[aria-label="搜索客户"]').setValue(''); await flushPromises()
  expect(getStockInventory).toHaveBeenLastCalledWith(expect.objectContaining({ customerSearch: undefined, search: 'lamp', page: 1 }))
  await wrapper.get('select[aria-label="收货仓库"]').setValue('SZ'); await flushPromises()
  expect(getStockInventory).toHaveBeenLastCalledWith(expect.objectContaining({ warehouseCode: 'SZ', search: 'lamp', page: 1 }))
  await wrapper.get('input[aria-label="搜索库存 SKU"]').setValue(''); await flushPromises()
  expect(getStockInventory).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, warehouseCode: 'SZ' }))
  wrapper.unmount()
})
it('ignores old search responses and clears private rows on session reset', async () => {
  const wrapper = await setup()
  let resolve!: (value: typeof page) => void
  vi.mocked(getStockInventory).mockReturnValueOnce(new Promise(r => { resolve = r }))
  await wrapper.get('input[aria-label="搜索客户"]').setValue('Old')
  await wrapper.get('form').trigger('submit')
  await wrapper.get('input[aria-label="搜索客户"]').setValue('')
  await flushPromises()
  resolve({ ...page, items: [{ ...page.items[0], name: 'Stale confidential product' }] }); await flushPromises()
  expect(wrapper.text()).not.toContain('Stale confidential')
  invalidateSession(); await flushPromises()
  expect(wrapper.emitted('close')).toBeTruthy(); expect(wrapper.find('tbody').exists()).toBe(false)
  wrapper.unmount()
})

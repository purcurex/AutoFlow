import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, expect, it, vi } from 'vitest'
import AllocationInventoryDialog from '@/components/autoflow/AllocationInventoryDialog.vue'
import { getAllocationInventory, type AllocationInventoryPage } from '@/api/allocation-inventory'
import { invalidateSession } from '@/utils/session'
vi.mock('@/api/allocation-inventory', () => ({ getAllocationInventory: vi.fn() }))
const page: AllocationInventoryPage = { source: 'mock', asOf: '2026-10-28T01:00:00Z', page: 1, pageSize: 50, total: 2, items: [
  { id: 'common', sku: 'SKU-1', name: 'Lamp', warehouseCode: 'HZ', warehouse: '杭州仓', customer: null, onHand: 0, occupied: 0, free: 0 },
  { id: 'client', sku: 'SKU-1', name: 'Lamp', warehouseCode: 'HZ', warehouse: '杭州仓', customer: { id: 'c1', name: 'Customer One' }, onHand: 20, occupied: 5, free: 15 },
] }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getAllocationInventory).mockResolvedValue(page) })
async function setup(orderIds: string[] = [], queue?: 'allocation' | 'shipping') { const w = mount(AllocationInventoryDialog, { props: { orderIds, queue }, global: { stubs: { Teleport: true }, plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } }); await flushPromises(); return w }
it('only loads selected IDs and displays separate public/customer zero balances without source badges', async () => {
  const w = await setup(['o1', 'o2'])
  expect(getAllocationInventory).toHaveBeenCalledWith({ mode: 'selected', queue: 'allocation', orderIds: ['o1', 'o2'], warehouseCode: undefined, page: 1, pageSize: 50 })
  expect(w.findAll('tbody tr')).toHaveLength(2)
  expect(w.text()).toContain('公共库存'); expect(w.text()).toContain('Customer One'); expect(w.findAll('tbody tr')[0].text()).toContain('0')
  expect(w.text()).not.toMatch(/MOCK|演示数据/i); w.unmount()
})
it('carries warehouse context through selected-order, SKU search and warehouse changes', async () => {
  const selected = await setup(['warehouse-order'], 'shipping')
  expect(getAllocationInventory).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'shipping', mode: 'selected', orderIds: ['warehouse-order'] }))
  await selected.get('select').setValue('SZ'); await flushPromises()
  expect(getAllocationInventory).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'shipping', warehouseCode: 'SZ' }))
  selected.unmount()
  const search = await setup([], 'shipping')
  await search.get('input[type=search]').setValue('SKU'); await search.get('form').trigger('submit'); await flushPromises()
  expect(getAllocationInventory).toHaveBeenLastCalledWith(expect.objectContaining({ queue: 'shipping', mode: 'search', search: 'SKU' }))
  search.unmount()
})
it('does not query before a SKU search and returns to the prompt when cleared', async () => {
  const w = await setup()
  expect(getAllocationInventory).not.toHaveBeenCalled()
  await w.get('input[type=search]').setValue(' SKU-1 '); await w.get('form').trigger('submit'); await flushPromises()
  expect(getAllocationInventory).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'search', search: 'SKU-1' }))
  await w.get('input[type=search]').setValue(''); await flushPromises()
  expect(w.find('tbody').exists()).toBe(false)
  expect(getAllocationInventory).toHaveBeenCalledTimes(1); w.unmount()
})
it('does not present errors as zero and discards results arriving after session change', async () => {
  vi.mocked(getAllocationInventory).mockRejectedValueOnce(new Error('offline'))
  const w = await setup(['o1'])
  expect(w.find('[role=alert]').exists()).toBe(true); expect(w.find('tbody').exists()).toBe(false)
  w.unmount()
  let finish!: (page: AllocationInventoryPage) => void
  vi.mocked(getAllocationInventory).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const next = await setup(['o1']); invalidateSession(); finish(page); await flushPromises()
  expect(next.emitted('close')).toBeTruthy(); expect(next.find('tbody').exists()).toBe(false); next.unmount()
})

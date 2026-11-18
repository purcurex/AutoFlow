import { afterEach, expect, it, vi } from 'vitest'
import { inventoryMockEnabled, mockAllocationInventory, mockStockInventory } from '@/mocks/inventory'
afterEach(() => vi.unstubAllEnvs())
it('requires an explicit development switch and is disabled in production', () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_INVENTORY_MOCK', 'true'); expect(inventoryMockEnabled()).toBe(true)
  vi.stubEnv('DEV', false); expect(inventoryMockEnabled()).toBe(false)
})
it('filters customer, SKU and warehouse, paginates and preserves stock arithmetic', async () => {
  const all = await mockStockInventory({ page: 1, pageSize: 50 })
  expect(all.total).toBe(12)
  all.items.forEach(r => { expect(r.onHand!).toBe(r.fullPayment.onHand! + r.deposit.onHand!); expect(r.fullPayment.onHand!).toBe(r.fullPayment.available! + r.fullPayment.locked!) })
  const filtered = await mockStockInventory({ page: 1, pageSize: 1, customerSearch: 'northstar', search: 'HZ', warehouseCode: 'HZ' })
  expect(filtered.total).toBe(2); expect(filtered.items).toHaveLength(1)
  expect((await mockStockInventory({ page: 1, pageSize: 50, search: 'does-not-exist' })).total).toBe(0)
})
it('provides public and dedicated balances without duplicated pools and stable selected scenarios', async () => {
  const result = await mockAllocationInventory({ mode: 'search', search: 'HZ510011', page: 1, pageSize: 50 })
  expect(result.total).toBe(4); expect(new Set(result.items.map(r => r.id)).size).toBe(4)
  expect(result.items.some(r => r.customer === null)).toBe(true); expect(result.items.some(r => r.free === 0)).toBe(true)
  result.items.forEach(r => expect(r.free).toBe(r.onHand! - r.occupied!))
  const selected = await mockAllocationInventory({ mode: 'selected', orderIds: ['one'], warehouseCode: 'HZ', page: 1, pageSize: 50 })
  expect(selected.total).toBe(4)
  expect((await mockAllocationInventory({ mode: 'selected', orderIds: [], page: 1, pageSize: 50 })).total).toBe(0)
})

import type { FopOrderCandidate } from './fop-data.types'
import { AllocationInventoryScope, inventoryKey } from './allocation-inventory'
export function demoAllocationScopes(orders: FopOrderCandidate[]) {
  const scopes = new Map<string, AllocationInventoryScope>()
  for (const order of orders) {
    if (!order.customerId || !['HZ', 'SZ'].includes(order.warehouseCode ?? '')) continue
    for (const item of order.items) for (const customer of [null, { id: order.customerId, name: order.customerName }]) {
      const row: AllocationInventoryScope = { id: '', sku: item.sku, name: item.name, warehouseCode: order.warehouseCode as 'HZ' | 'SZ', warehouse: order.warehouse, customer,
        ...(customer ? { owner: order.owner, department: order.department, departmentPathIds: order.departmentPathIds } : {}) }
      row.id = inventoryKey(row)
      scopes.set(row.id, row)
    }
  }
  return [...scopes.values()]
}
export function demoAllocationBalances(scopes: readonly AllocationInventoryScope[]) {
  return scopes.flatMap(scope => {
    const seed = [...scope.id].reduce((n, char) => n + char.charCodeAt(0), 0)
    // A complete snapshot with absent balances explicitly exercises zero-stock display.
    if (seed % 4 === 0) return []
    const onHand = seed % 83 + 8, occupied = seed % 8
    return [{ scopeId: scope.id, onHand, occupied }]
  })
}

import { createHash } from 'crypto'
import type { FopOrderCandidate } from './fop-data.types'
import type { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
import { businessDate } from './fop-business-time'

/** Independent synthetic stock records; never mixed into fulfillment orders or receipt statistics. */
export function demoStockOrders(orders: readonly FopOrderCandidate[]): FopStockOrderCandidate[] {
  const customers = [...new Map(orders.filter(o => o.customerId && o.owner && o.department && o.salesDepartmentCode).map(o => [o.customerId!, o])).values()]
  return customers.flatMap((order, index) => [0, 1].map((type): FopStockOrderCandidate => {
    const date = businessDate(order.createdAt).replaceAll('-', '')
    const id = `${order.tenantId}:stock-order:${order.customerId}:${type}`
    return { tenantId: order.tenantId, id, stockNumber: `BH${date.slice(2)}${String(index * 2 + type + 1).padStart(6, '0')}`,
      stockType: type ? 'deposit' : 'full_payment', customerId: order.customerId!, customerCode: order.customerCode!, customerName: order.customerName,
      owner: order.owner!, department: order.department!, departmentPathIds: order.departmentPathIds, salesDepartmentCode: order.salesDepartmentCode,
      storeName: order.storeName, warehouseCode: type ? 'SZ' : 'HZ', warehouse: type ? '深圳仓' : '杭州仓',
      items: order.items.map(item => ({ ...item, quantity: 20 + item.quantity * 10 })), amount: Math.round(order.amount * (type ? 3 : 10) * 100) / 100, currency: 'USD',
      paymentStatus: index % 7 === 0 ? 'unpaid' : 'paid', reviewStatus: index % 7 === 0 || index % 11 === 0 ? 'pending' : 'approved',
      paidAt: index % 7 === 0 ? null : order.paidAt ?? order.createdAt,
      purchaseStatus: (['unpurchased', 'partial', 'purchased', 'shipped', 'received'] as const)[(index + type) % 5], cancelled: false }
  }))
}
export function demoStockInventory(orders: readonly FopOrderCandidate[]): FopStockInventoryCandidate[] {
  const rows = new Map<string, FopStockInventoryCandidate>()
  for (const order of demoStockOrders(orders)) for (const item of order.items) {
    const id = `${order.tenantId}:stock-inventory:${order.customerId}:${order.warehouseCode}:${item.sku}`
    if (rows.has(id)) continue
    const seed = createHash('sha256').update(id).digest().readUInt16BE(0)
    rows.set(id, { tenantId: order.tenantId, id, customerId: order.customerId, customerCode: order.customerCode, customerName: order.customerName,
      owner: order.owner, department: order.department, departmentPathIds: order.departmentPathIds, salesDepartmentCode: order.salesDepartmentCode,
      sku: item.sku, name: item.name, imageUrl: item.imageUrl, warehouseCode: order.warehouseCode, warehouse: order.warehouse,
      fullPayment: { available: seed % 9 === 0 ? 0 : 20 + seed % 180, locked: seed % 9 === 0 ? 0 : seed % 17 },
      deposit: { available: seed % 7 === 0 ? 0 : 10 + seed % 90, locked: seed % 7 === 0 ? 0 : seed % 11 } })
  }
  return [...rows.values()]
}

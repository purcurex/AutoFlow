import { createHash } from 'crypto'
import type { FopOrderCandidate } from './fop-data.types'
import type { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
import { businessDate } from './fop-business-time'

/** Independent synthetic stock records; never mixed into fulfillment orders or receipt statistics. */
export function demoStockOrders(orders: readonly FopOrderCandidate[], now = new Date()): FopStockOrderCandidate[] {
  const customers = [...new Map(orders.filter(o => o.customerId && o.owner && o.department && o.salesDepartmentCode).map(o => [o.customerId!, o])).values()]
  const rows = customers.flatMap((order, index) => [0, 1].map((type): FopStockOrderCandidate => {
    const date = businessDate(order.createdAt).replaceAll('-', '')
    const id = `${order.tenantId}:stock-order:${order.customerId}:${type}`
    // Partial procurement is a rare compatibility scenario, not the main workload.
    const stage = (index * 2 + type) % 20
    const purchaseStatus = index % 7 === 0 || index % 11 === 0 ? 'unpurchased' : stage < 8 ? 'unpurchased' : stage < 16 ? 'purchased' : stage === 16 ? 'partial' : stage < 19 ? 'shipped' : 'received'
    const procurementPaidAt = purchaseStatus === 'purchased' ? new Date(Math.max(Date.parse(order.paidAt ?? order.createdAt), now.getTime() - [12, 30, 60][(index + type) % 3] * 3600000)).toISOString() : null
    return { tenantId: order.tenantId, id, stockNumber: `BH${date.slice(2)}${String(index * 2 + type + 1).padStart(6, '0')}`,
      stockType: type ? 'deposit' : 'full_payment', customerId: order.customerId!, customerCode: order.customerCode!, customerName: order.customerName,
      owner: order.owner!, department: order.department!, departmentPathIds: order.departmentPathIds, salesDepartmentCode: order.salesDepartmentCode,
      storeName: order.storeName, warehouseCode: type ? 'SZ' : 'HZ', warehouse: type ? '深圳仓' : '杭州仓',
      items: order.items.map(item => ({ ...item, quantity: 20 + item.quantity * 10 })), amount: Math.round(order.amount * (type ? 3 : 10) * 100) / 100, currency: 'USD',
      paymentStatus: index % 7 === 0 ? 'unpaid' : 'paid', reviewStatus: index % 7 === 0 || index % 11 === 0 ? 'pending' : 'approved',
      paidAt: index % 7 === 0 ? null : order.paidAt ?? order.createdAt, createdAt: order.createdAt,
      purchaseStatus, procurementPaidAt, cancelled: false }
  }))
  // Independent stock examples cover recent and historical creation periods for each owner.
  // They reuse authorized customer/SKU dimensions, not fulfillment payment/creation events.
  const owners = [...new Map(rows.map(row => [row.owner.id, row])).values()]
  const samples = owners.flatMap((base, ownerIndex) => [2, 14, 60, 100].flatMap((days, period) => [0, 1, 2].map((stage): FopStockOrderCandidate => {
    const createdAt = new Date(now.getTime() - days * 86400000).toISOString()
    const date = businessDate(createdAt).replaceAll('-', '').slice(2)
    return { ...base, id: `${base.id}:lifecycle:${period}:${stage}`, stockNumber: `BH${date}${String(800000 + ownerIndex * 12 + period * 3 + stage).padStart(6, '0')}`,
      stockType: (period + stage) % 2 ? 'deposit' : 'full_payment', createdAt,
      paidAt: stage === 0 ? null : new Date(Date.parse(createdAt) + 3600000).toISOString(),
      paymentStatus: stage === 0 ? 'unpaid' : 'paid', reviewStatus: stage === 0 || stage === 1 && period % 2 ? 'pending' : 'approved',
      purchaseStatus: stage === 2 ? 'received' : 'unpurchased', procurementPaidAt: null }
  })))
  return [...rows, ...samples]
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

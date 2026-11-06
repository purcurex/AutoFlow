import type { FopIdentity, FopOrderCandidate } from './fop-data.types'
import { demoPurchaseLinks } from './procurement-groups-demo'
import { purchaseReturnStatuses, type PurchaseReturnCandidate } from './purchase-returns'
export function demoPurchaseReturns(identity: FopIdentity, orders: FopOrderCandidate[]): PurchaseReturnCandidate[] {
  const selected = orders.filter(order => !order.cancelled && order.reviewStatus === 'approved' && order.owner && order.department).slice(0, 60)
  const links = demoPurchaseLinks(identity, selected)
  const rows: PurchaseReturnCandidate[] = []
  for (const link of links.orders) {
    const order = selected.find(order => order.id === link.orderId)!
    for (const [n, obligation] of (link.obligations ?? []).entries()) {
      const purchase = obligation.purchase
      if (!purchase || !obligation.lines.length) continue
      const i = rows.length, status = purchaseReturnStatuses[i % purchaseReturnStatuses.length]
      rows.push({ id: `${order.id}:return:${n}`, tenantId: identity.tenantId, kind: 'physical_return', number: `TH${order.createdAt.slice(0, 10).replaceAll('-', '')}${String(i + 1).padStart(6, '0')}`, status, purchaseOrder: { id: purchase.id, number: purchase.number }, supplier: { ...purchase.supplier }, warehouseCode: order.warehouseCode || '', warehouse: order.warehouse, createdAt: order.createdAt,
        logistics: { carrier: status === 'pending_outbound' || status === 'cancelled' ? null : '顺丰速运', trackingNumber: status === 'pending_outbound' || status === 'cancelled' ? null : `SF000${String(i + 1).padStart(12, '0')}` },
        lines: obligation.lines.map((line, index) => {
          const item = order.items.find(item => item.sku === line.sku)!, quantity = Math.min(item.quantity, 1 + i % 3)
          return { id: `${order.id}:${n}:${index}`, sku: item.sku, name: item.name, imageUrl: item.imageUrl, variant: item.variant, quantity, returnedQuantity: ['in_transit', 'received', 'completed'].includes(status) ? quantity : 0,
            sourceOrder: { id: order.id, number: order.orderNumber, kind: 'fulfillment', customerName: order.customerName, owner: { ...order.owner! }, department: { ...order.department! }, departmentPathIds: order.departmentPathIds ? [...order.departmentPathIds] : undefined } }
        }) })
      if (rows.length >= 24) return rows
    }
  }
  return rows
}

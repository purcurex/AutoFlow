import { demoShipmentObligation } from './supplier-shipment-demo'
import type { FopOrderCandidate, FopIdentity } from './fop-data.types'
import type { PurchaseHeader, PurchaseLinkSnapshot, PurchaseObligation } from './procurement-groups.types'
/** Demo only: stable merged purchases across owners, with explicit source quantities. */
export function demoPurchaseLinks(subject: FopIdentity, orders: readonly FopOrderCandidate[]): PurchaseLinkSnapshot {
  return { subject: { ...subject }, orders: orders.map(order => {
    if (order.cancelled || order.paymentStatus !== 'paid' || order.reviewStatus === 'pending') return { orderId: order.id, obligations: [] }
    const shipmentExample = demoShipmentObligation(order)
    if (shipmentExample) return { orderId: order.id, obligations: [shipmentExample] }
    const p = order.procurementProgress ?? { purchaseOrder: 'not_ordered', supplierPayment: 'not_required' }
    if (p.purchaseOrder === 'not_required' || p.purchaseOrder === 'cancelled') return { orderId: order.id, obligations: [] }
    const uncreated = p.purchaseOrder === 'not_ordered' || p.purchaseOrder === 'unknown'
    const obligations: PurchaseObligation[] = []
    for (const [index, item] of order.items.entries()) {
      const payment: PurchaseHeader['payment'] = p.supplierPayment === 'partial' ? index % 2 ? 'unpaid' : 'paid' : ['paid', 'unpaid', 'refunded'].includes(p.supplierPayment) ? p.supplierPayment as PurchaseHeader['payment'] : 'unknown'
      const placement = p.alibabaOrder === 'not_pushed' || p.alibabaOrder === 'partial' ? 'pending' : 'placed'
      const supplier = index % 2
      // Weekly Demo batches make merged procurement visible across source dates/owners.
      const day = `${order.createdAt.slice(0, 8)}${String(1 + Math.floor((Number(order.createdAt.slice(8, 10)) - 1) / 7) * 7).padStart(2, '0')}`
      const platform: PurchaseHeader['platform'] = supplier === 0 || Number(day.slice(8, 10)) === 1 || Number(day.slice(8, 10)) >= 22 ? '1688' : Number(day.slice(8, 10)) % 2 ? 'other' : null
      const purchaseType = platform === null ? 'offline' : 'online'
      const key = `${day.replace(/-/g, '')}-${order.warehouseCode}-${supplier}-${payment}-${placement}`
      const sequence = (order.warehouseCode === 'HZ' ? 0 : 1000) + supplier * 100 + ['paid', 'unpaid', 'partial', 'refunded', 'unknown'].indexOf(payment) * 10 + (placement === 'placed' ? 1 : 2)
      const purchase: PurchaseHeader | null = uncreated ? null : { purchaseType, platform, id: `${subject.tenantId}:merged:${key}`, number: `CG${day.replace(/-/g, '')}${String(sequence).padStart(6, '0')}`, supplier: { id: `demo-supplier-${supplier}`, name: supplier ? '杭州优品供应商' : '深圳智选供应商' }, platformOrderNumber: placement === 'placed' && platform ? (platform === 'other' ? `WEB${day.replace(/-/g, '')}${sequence}` : (5127800000000000000n + BigInt(day.replace(/-/g, '')) * 1000000n + BigInt(sequence)).toString()) : null,
        payment, placement, paidAt: payment === 'paid' ? `${day}T08:00:00+08:00` : null }
      const existing = obligations.find(o => o.purchase?.id === purchase?.id)
      const line = { fulfillmentLineId: `${order.id}:line:${index}`, purchaseLineId: purchase ? `${purchase.id}:${item.sku}` : null, sku: item.sku, quantity: item.quantity,
        shippedQuantity: uncreated ? 0 : order.fulfillmentProgress.supplierShipment === 'shipped' ? item.quantity : order.fulfillmentProgress.supplierShipment === 'partial' ? Math.floor(item.quantity / 2) : 0 }
      if (existing) existing.lines.push(line); else obligations.push({ purchase, lines: [line] })
    }
    return { orderId: order.id, obligations }
  }) }
}

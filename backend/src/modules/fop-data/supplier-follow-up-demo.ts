import type { FopOrderCandidate } from './fop-data.types'
import type { SupplierFollowUpCandidate } from './supplier-follow-up'
import { demoPurchaseLinks } from './procurement-groups-demo'
/** Use the same synthetic purchase/source identities as the grouped workbench. Mock launches never leave the app. */
export function demoSupplierFollowUps(order: FopOrderCandidate): SupplierFollowUpCandidate[] {
  const links = demoPurchaseLinks({ tenantId: order.tenantId, userId: 'demo' }, [order]).orders[0].obligations ?? []
  return links.flatMap(link => {
    const purchase = link.purchase
    if (!purchase || purchase.platform !== '1688' || purchase.payment !== 'paid' || purchase.placement !== 'placed') return []
    const lines = link.lines.filter(line => line.shippedQuantity !== null && line.quantity > line.shippedQuantity).map(line => ({ fulfillmentLineId: line.fulfillmentLineId, purchaseLineId: line.purchaseLineId!, sku: line.sku, name: order.items.find(i => i.sku === line.sku)!.name, pendingQuantity: line.quantity - line.shippedQuantity! }))
    if (!lines.length) return []
    const account = purchase.platform !== '1688' || purchase.supplier.id.endsWith('-1') ? null : 'HyperZone演示供应商'
    return [{ tenantId: order.tenantId, fulfillmentOrderId: order.id, purchaseOrderId: purchase.id, purchaseOrderNumber: purchase.number, platformOrderNumber: purchase.platformOrderNumber,
      supplier: { ...purchase.supplier, wangwangAccount: account }, chatUrl: account ? `aliim:sendmsg?touid=${encodeURIComponent(`cnalichn${account}`)}` : null,
      paid: true, cancelled: order.cancelled, shipmentStatus: link.lines.some(line => line.shippedQuantity !== null && line.shippedQuantity > 0) ? 'partial' as const : 'pending' as const, lines }]
  })
}

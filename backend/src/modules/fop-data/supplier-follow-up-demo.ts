import type { FopOrderCandidate } from './fop-data.types'
import type { SupplierFollowUpCandidate } from './supplier-follow-up'
import { businessDate } from './fop-business-time'
/** Synthetic suppliers never leave the app: mock launches always return a null URL. */
export function demoSupplierFollowUps(order: FopOrderCandidate): SupplierFollowUpCandidate[] {
  const number = Number(order.orderNumber.match(/(\d{1,6})$/)?.[1] ?? 0)
  const documentDate = businessDate(order.createdAt).replaceAll('-', '')
  const groups = order.items.length > 1 ? order.items.map((item, index) => [{ item, index }]) : [order.items.map((item, index) => ({ item, index }))]
  return groups.map((group, index) => {
    const purchaseOrderId = `${order.id}:purchase:${index + 1}`
    const account = (number + index) % 5 === 0 ? null : `HyperZone演示供应商${(number + index) % 4 + 1}`
    return {
      tenantId: order.tenantId, fulfillmentOrderId: order.id, purchaseOrderId, purchaseOrderNumber: `CG${documentDate}${String((number % 100000) * 10 + index + 1).padStart(6, '0')}`,
      // 1688 numbers exceed Number.MAX_SAFE_INTEGER; generate and return exact strings.
      platformOrderNumber: (5127891553471031616n + BigInt(number) * 10n + BigInt(index)).toString(), supplier: { id: `demo-supplier-${(number + index) % 4}`, name: ['杭州云帆箱包（演示）', '深圳星禾数码（演示）', '义乌青禾家居（演示）', '宁波悦行用品（演示）'][(number + index) % 4], wangwangAccount: account },
      chatUrl: account ? `aliim:sendmsg?touid=${encodeURIComponent(`cnalichn${account}`)}` : null,
      paid: order.procurementProgress?.supplierPayment === 'paid', cancelled: order.cancelled,
      shipmentStatus: order.fulfillmentProgress.supplierShipment === 'partial' ? 'partial' : 'pending',
      lines: group.map(({ item, index: line }) => ({ fulfillmentLineId: `${order.id}:line:${line}`, purchaseLineId: `${purchaseOrderId}:line:${line}`, sku: item.sku, name: item.name, pendingQuantity: order.fulfillmentProgress.supplierShipment === 'partial' ? Math.max(1, item.quantity - 1) : item.quantity })),
    }
  })
}

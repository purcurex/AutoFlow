import { createHash } from 'crypto'
import type { FopIdentity, FopPermissionGrant } from './fop-data.types'
import type { FopStockOrderCandidate } from './fop-stock.types'
import { supplierFollowUps, type SupplierFollowUpCandidate } from './supplier-follow-up'

export interface StockSupplierFollowUpCandidate extends Omit<SupplierFollowUpCandidate, 'fulfillmentOrderId' | 'lines'> {
  stockOrderId: string
  /** Only effective purchase source lines belonging to this stock order. */
  lines: { stockLineId: string; purchaseLineId: string; sku: string; name: string; pendingQuantity: number }[]
}
export interface StockSupplierFollowUpResult { subject: FopIdentity; orderId: string; items: StockSupplierFollowUpCandidate[] }

export function stockSupplierFollowUps(result: StockSupplierFollowUpResult, identity: FopIdentity, permission: FopPermissionGrant, orderId: string) {
  if (!result || result.orderId !== orderId || !Array.isArray(result.items)) throw new Error('Invalid stock supplier response')
  // Reuse the purchase/contact validator without treating stock orders as fulfillment grants.
  // The normalized source keys are internal only; stock endpoints retain stock-specific line IDs.
  const normalized = { ...result, items: result.items.filter(row => row?.stockOrderId === orderId).map(row => ({
    ...row, fulfillmentOrderId: row.stockOrderId,
    lines: Array.isArray(row.lines) ? row.lines.map(line => ({ ...line, fulfillmentLineId: line?.stockLineId })) : row.lines,
  })) }
  return supplierFollowUps(normalized, identity, permission, orderId).map(row => ({ ...row,
    contactVersion: createHash('sha256').update(`stock:${row.contactVersion}`).digest('hex'),
    lines: row.lines.map(({ fulfillmentLineId, ...line }) => ({ ...line, stockLineId: fulfillmentLineId })),
  }))
}

export function demoStockSupplierFollowUps(order: FopStockOrderCandidate): StockSupplierFollowUpCandidate[] {
  if (order.cancelled || order.paymentStatus !== 'paid' || order.reviewStatus !== 'approved' || order.purchaseStatus !== 'purchased') return []
  const seed = createHash('sha256').update(order.id).digest().readUInt32BE(0)
  return [0, 1].flatMap(index => {
    const items = order.items.map((item, line) => ({ item, line })).filter(({ line }) => line % 2 === index)
    if (!items.length) return []
    const purchaseOrderId = `${order.id}:purchase:${index}`
    const account = `HyperZone演示供应商${index + 1}`
    return [{ tenantId: order.tenantId, stockOrderId: order.id, purchaseOrderId,
      purchaseOrderNumber: `CG202611${String((seed + index) % 100000000).padStart(8, '0')}`,
      platformOrderNumber: String(5127833916000000000n + BigInt(seed) + BigInt(index)),
      supplier: { id: `stock-demo-supplier-${index}`, name: ['深圳智选供应商', '杭州优品供应商'][index], wangwangAccount: account },
      chatUrl: `aliim:sendmsg?touid=${encodeURIComponent(`cnalichn${account}`)}`, paid: true, cancelled: false, shipmentStatus: 'pending' as const,
      lines: items.map(({ item, line }) => ({ stockLineId: `${order.id}:line:${line}`, purchaseLineId: `${purchaseOrderId}:line:${line}`, sku: item.sku, name: item.name, pendingQuantity: item.quantity })),
    }]
  })
}

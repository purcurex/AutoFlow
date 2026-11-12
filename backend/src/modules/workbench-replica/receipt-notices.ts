import { ServiceUnavailableException } from '@nestjs/common'
import Decimal from 'decimal.js'

export function receiptNoticeProgress(shipment: string, wms: string | null, lines: { quantity: unknown; inboundQuantity: unknown }[]) {
  if (shipment === 'pending' || ['15', '20', '25', '30'].includes(wms ?? '')) return null
  const incomplete = () => new ServiceUnavailableException({ code: 'workbench_replica_incomplete', total: null, message: 'Receipt notice shipment or inbound facts are incomplete' })
  if (shipment !== 'shipped' || !['0', '5', '10'].includes(wms ?? '') || !lines.length) throw incomplete()
  let quantity = new Decimal(0), inbound = new Decimal(0)
  for (const line of lines) {
    if (line.quantity == null || line.inboundQuantity == null) throw incomplete()
    let q: Decimal, n: Decimal
    try { q = new Decimal(String(line.quantity)); n = new Decimal(String(line.inboundQuantity)) } catch { throw incomplete() }
    if (!q.isFinite() || !n.isFinite() || q.lte(0) || n.lt(0) || n.gt(q)) throw incomplete()
    quantity = quantity.plus(q); inbound = inbound.plus(n)
  }
  if (inbound.eq(quantity)) return null
  return { status: inbound.gt(0) ? 'partial' as const : 'pending' as const, quantity: quantity.toNumber(), inboundQuantity: inbound.toNumber(), pendingQuantity: quantity.minus(inbound).toNumber() }
}

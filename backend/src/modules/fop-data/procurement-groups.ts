import { completedAt, isStageCompleted } from './completed-orders'
import { consumerPaymentRange } from './consumer-payment-range'
import Decimal from 'decimal.js'
import type { FopOrder, FopPermissionGrant } from './fop-data.types'
import type { PurchaseGroup, PurchaseGroupFilters, PurchaseGroupRow, PurchaseHeader, PurchaseLinkSnapshot } from './procurement-groups.types'
import { normalizeBusinessTimestamp } from './fop-business-time'
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 500
const qty = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER
const sum = (values: number[]) => {
  const n = values.reduce((a, b) => a.plus(b), new Decimal(0)).toNumber()
  if (!qty(n)) throw new Error('Purchase quantity overflow')
  return n
}
function header(value: PurchaseHeader): PurchaseHeader {
  if (!text(value.id) || !text(value.number) || !text(value.supplier?.id) || !text(value.supplier?.name)
    || !['paid', 'unpaid', 'partial', 'refunded', 'unknown'].includes(value.payment) || !['pending', 'placed', 'unknown'].includes(value.placement)
    || value.platformOrderNumber !== null && !text(value.platformOrderNumber)) throw new Error('Invalid purchase header')
  if (value.purchaseType !== 'offline' && value.purchaseType !== 'online'
    || value.purchaseType === 'offline' && (value.platform !== null || value.platformOrderNumber !== null)
    || value.purchaseType === 'online' && value.platform !== '1688' && value.platform !== 'other') throw new Error('Invalid purchase channel')
  const paidAt = normalizeBusinessTimestamp(value.paidAt)
  if (value.paidAt !== null && !paidAt) throw new Error('Invalid purchase payment time')
  return { purchaseType: value.purchaseType, platform: value.platform, id: value.id, number: value.number, supplier: { id: value.supplier.id, name: value.supplier.name }, platformOrderNumber: value.platformOrderNumber, payment: value.payment, placement: value.placement, paidAt: value.payment === 'paid' ? paidAt : null }
}
const dateRank = (s: string | null) => s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null
const compareDate = (a: string | null, b: string | null, direction = 1) => {
  const x = dateRank(a), y = dateRank(b)
  return x === null ? y === null ? 0 : 1 : y === null ? -1 : (x - y) * direction
}
function rowFor(order: FopOrder): PurchaseGroupRow {
  return { orderId: order.id, orderNumber: order.orderNumber, shopifyOrderNumber: order.shopifyOrderNumber, customerName: order.customerName, storeName: order.storeName,
    ownerName: order.owner?.name || order.salesperson, departmentName: order.department?.name || '—', warehouse: order.warehouse, completedAt: completedAt(order, 'procurement'), paidAt: normalizeBusinessTimestamp(order.paidAt), consumerPaidAt: normalizeBusinessTimestamp(order.consumerPaidAt), lines: [] }
}
export function buildPurchaseGroups(orders: FopOrder[], paths: Map<string, readonly string[]>, permission: FopPermissionGrant, snapshot: PurchaseLinkSnapshot, query: PurchaseGroupFilters): PurchaseGroup[] {
  if (!snapshot || snapshot.subject?.tenantId !== permission.subject.tenantId || snapshot.subject?.userId !== permission.subject.userId || !Array.isArray(snapshot.orders)) throw new Error('Invalid purchase snapshot subject')
  const byOrder = new Map<string, PurchaseLinkSnapshot['orders'][number]>()
  const authorized = new Set(orders.map(o => o.id)), allowed = new Set(permission.allowedPurchaseOrderIds ?? [])
  for (const entry of snapshot.orders) {
    if (!entry || !authorized.has(entry.orderId)) continue
    if (byOrder.has(entry.orderId) || entry.obligations !== null && !Array.isArray(entry.obligations)) throw new Error('Invalid purchase snapshot entry')
    byOrder.set(entry.orderId, entry)
  }
  const groups = new Map<string, PurchaseGroup>(), headers = new Map<string, string>()
  const matchesPaymentRange = consumerPaymentRange(query.timeRange ?? '1w')
  const search = query.search?.trim().toLowerCase()
  function add(id: string, kind: PurchaseGroup['kind'], purchase: PurchaseHeader | null, row: PurchaseGroupRow) {
    const matches = !search || [purchase?.number, purchase?.platformOrderNumber, purchase?.supplier.name, row.orderNumber, row.shopifyOrderNumber, row.customerName, row.storeName, row.ownerName, ...row.lines.flatMap(l => [l.sku, l.name])].some(v => v?.toLowerCase().includes(search))
    if (!matches) return
    let group = groups.get(id)
    if (!group) { group = { id, kind, purchase, orderCount: 0, skuCount: 0, quantity: null, shippedQuantity: null, pendingQuantity: null, shipment: 'unknown', earliestReceiptAt: null, rows: [] }; groups.set(id, group) }
    group.rows.push(row)
  }
  for (const order of orders) {
    if (order.cancelled || order.paymentStatus !== 'paid') continue
    const entry = byOrder.get(order.id)
    if (!entry) throw new Error('Incomplete purchase snapshot')
    if (query.departmentId && order.department?.id !== query.departmentId && !paths.get(order.id)?.includes(query.departmentId)
      || query.ownerId && order.owner?.id !== query.ownerId || query.warehouseCode && order.warehouseCode !== query.warehouseCode) continue
    if (entry.obligations === null) throw new Error('Incomplete purchase linkage')
    const sourceTotals = new Map<string, number>(), seenPurchases = new Set<string>()
    // Uncreated demand may arrive split by supplier or SKU. Validate it as one
    // source row per fulfillment order before joining the shared pending group.
    const uncreated = entry.obligations.filter(o => o?.purchase === null)
    if (uncreated.some(o => !Array.isArray(o.lines) || !o.lines.length)) throw new Error('Missing source lines')
    const obligations = [...entry.obligations.filter(o => o?.purchase !== null),
      ...(uncreated.length ? [{ purchase: null, lines: uncreated.flatMap(o => o.lines) }] : [])]
    for (const obligation of obligations) {
      if (!obligation || obligation.purchase !== null && !text(obligation.purchase?.id)) throw new Error('Invalid purchase obligation')
      if (obligation.purchase && !allowed.has(obligation.purchase.id)) continue
      const purchase = obligation.purchase ? header(obligation.purchase) : null
      const id = purchase ? `purchase:${purchase.id}` : 'uncreated'
      if (seenPurchases.has(id)) throw new Error('Duplicate purchase source group')
      seenPurchases.add(id)
      if (purchase) {
        const signature = JSON.stringify(purchase)
        if (headers.has(id) && headers.get(id) !== signature) throw new Error('Inconsistent purchase header')
        headers.set(id, signature)
      }
      if (!Array.isArray(obligation.lines) || !obligation.lines.length) throw new Error('Missing source lines')
      const seen = new Set<string>(), row = rowFor(order)
      for (const line of obligation.lines) {
        const key = JSON.stringify([line?.fulfillmentLineId, line?.purchaseLineId])
        const item = order.items.find(i => i.sku === line?.sku)
        if (!line || !text(line.fulfillmentLineId) || purchase && !text(line.purchaseLineId) || !purchase && line.purchaseLineId !== null
          || !item || !qty(line.quantity) || line.quantity === 0 || !qty(line.shippedQuantity) || line.shippedQuantity > line.quantity
          || !purchase && line.shippedQuantity !== 0 || seen.has(key)) throw new Error('Invalid purchase source quantities')
        seen.add(key)
        const total = sum([sourceTotals.get(line.sku) ?? 0, line.quantity])
        if (total > sum(order.items.filter(i => i.sku === line.sku).map(i => i.quantity))) throw new Error('Source purchase exceeds fulfillment quantity')
        sourceTotals.set(line.sku, total)
        row.lines.push({ fulfillmentLineId: line.fulfillmentLineId, purchaseLineId: line.purchaseLineId, sku: line.sku, quantity: line.quantity, shippedQuantity: line.shippedQuantity, name: item.name, imageUrl: item.imageUrl, variant: item.variant })
      }
      const awaitingShipment = purchase?.payment === 'paid' && purchase.placement === 'placed'
      // A missing completion fact is not evidence of outstanding procurement.
      const awaitingProcurement = purchase === null || purchase.placement === 'pending'
        || purchase.payment === 'unpaid' || purchase.payment === 'partial' || purchase.payment === 'refunded'
      if (query.completed) {
        if (!awaitingShipment || !isStageCompleted(order, 'procurement') || !matchesPaymentRange(order.consumerPaidAt)) continue
      } else if (query.queue === 'procurement_shipping') {
        if (!awaitingShipment || !row.lines.some(l => l.shippedQuantity < l.quantity)) continue
      } else if (!awaitingProcurement) continue
      add(id, purchase ? 'purchase' : 'uncreated', purchase, row)
    }
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => compareDate(a.consumerPaidAt ?? null, b.consumerPaidAt ?? null, query.sortOrder === 'asc' ? 1 : -1) || a.orderId.localeCompare(b.orderId))
    if (query.completed) group.completedAt = group.rows.map(row => row.completedAt).filter((value): value is string => !!value).sort().slice(-1)[0] ?? null
    group.latestConsumerPaidAt = group.rows.reduce<string | null>((latest, row) => compareDate(row.consumerPaidAt ?? null, latest, -1) < 0 ? row.consumerPaidAt ?? null : latest, null)
    group.orderCount = group.rows.length
    group.earliestReceiptAt = group.rows.reduce<string | null>((earliest, row) => compareDate(row.paidAt, earliest) < 0 ? row.paidAt : earliest, null)
    const lines = group.rows.flatMap(r => r.lines)
    group.skuCount = new Set(lines.map(l => l.sku)).size
    group.quantity = sum(lines.map(l => l.quantity)); group.shippedQuantity = sum(lines.map(l => l.shippedQuantity))
    group.pendingQuantity = new Decimal(group.quantity).minus(group.shippedQuantity).toNumber()
    group.shipment = group.pendingQuantity === 0 ? 'shipped' : group.shippedQuantity > 0 ? 'partial' : 'pending'
  }
  const matchesStage = (group: PurchaseGroup) => {
    if (!query.purchaseStage) return true
    const purchase = group.purchase
    const stage = !purchase ? 'uncreated' : purchase.payment === 'refunded' ? 'refund_pending'
      : purchase.placement === 'pending' ? 'placement_pending'
      : purchase.placement === 'placed' && (purchase.payment === 'unpaid' || purchase.payment === 'partial') ? 'payment_pending' : undefined
    return stage === query.purchaseStage
  }
  return [...groups.values()].filter(matchesStage).sort((a, b) => Number(b.kind === 'uncreated') - Number(a.kind === 'uncreated')
    || compareDate(a.latestConsumerPaidAt ?? null, b.latestConsumerPaidAt ?? null, query.sortOrder === 'asc' ? 1 : -1) || a.id.localeCompare(b.id))
}
export function purchaseGroupSummary({ rows: _rows, ...group }: PurchaseGroup) { return group }
export function purchaseGroupTotals(groups: PurchaseGroup[]) {
  return { groupCount: groups.length, purchaseCount: groups.filter(g => g.kind === 'purchase').length, orderCount: new Set(groups.flatMap(g => g.rows.map(r => r.orderId))).size,
    uncreatedCount: groups.filter(g => g.kind === 'uncreated').reduce((n, g) => n + g.orderCount, 0),
    pendingQuantity: sum(groups.map(g => g.pendingQuantity ?? 0)) }
}

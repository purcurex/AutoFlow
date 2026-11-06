import { matchesBusinessScope, type BusinessScope } from '../users/business-scope'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { summarizeFopOrders } from './fop-order-totals'
import type { FopIdentity, FopPermissionGrant, FopOrder } from './fop-data.types'
export const purchaseReturnStatuses = ['pending_outbound', 'in_transit', 'received', 'completed', 'cancelled', 'unknown'] as const
export type PurchaseReturnStatus = typeof purchaseReturnStatuses[number]
export const purchaseReturnLabels: Record<PurchaseReturnStatus, readonly [string, string]> = {
  pending_outbound: ['待退货出库', 'Pending return outbound'], in_transit: ['退货在途', 'Return in transit'], received: ['供应商已收货', 'Supplier received'], completed: ['退货完成', 'Return completed'], cancelled: ['已取消', 'Cancelled'], unknown: ['待确认', 'Unconfirmed'],
}
export interface PurchaseReturnSource {
  id: string; number: string; kind: 'fulfillment' | 'stock'; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }; departmentPathIds?: string[]
}
export interface PurchaseReturnLine { id: string; sku: string; name: string; variant: string; imageUrl: string | null; quantity: number; returnedQuantity: number; sourceOrder: PurchaseReturnSource }
export interface PurchaseReturn {
  id: string; number: string | null; status: PurchaseReturnStatus; purchaseOrder: { id: string; number: string }; supplier: { id: string; name: string }
  warehouseCode: string; warehouse: string; createdAt: string | null; logistics: { carrier: string | null; trackingNumber: string | null }
  lines: PurchaseReturnLine[]; quantity: number; returnedQuantity: number
}
export interface PurchaseReturnCandidate extends Omit<PurchaseReturn, 'status' | 'quantity' | 'returnedQuantity'> { tenantId: string; kind: 'physical_return' | 'refund_only'; status: string }
export interface PurchaseReturnSnapshot { subject: FopIdentity; returns: PurchaseReturnCandidate[] }
export interface PurchaseReturnFilters { paidAtOrder?: 'asc' | 'desc'; search?: string; status?: PurchaseReturnStatus; departmentId?: string; ownerId?: string; warehouseCode?: string }
const text = (value: unknown, required = false): string => {
  if (typeof value !== 'string' || value.length > 1000 || required && !value.trim()) { if (required) throw new Error('Invalid purchase return text'); return '' }
  return value.trim()
}
function subtotal(row: Omit<PurchaseReturn, 'quantity' | 'returnedQuantity'>): PurchaseReturn {
  const quantity = row.lines.reduce((sum, line) => sum + line.quantity, 0), returnedQuantity = row.lines.reduce((sum, line) => sum + line.returnedQuantity, 0)
  if (!Number.isFinite(quantity) || !Number.isFinite(returnedQuantity)) throw new Error('Invalid purchase return totals')
  return { ...row, quantity, returnedQuantity }
}
export function buildPurchaseReturns(snapshot: unknown, permission: FopPermissionGrant, scope: BusinessScope, currentSources: readonly PurchaseReturnSource[]): PurchaseReturn[] {
  const data = snapshot as PurchaseReturnSnapshot
  if (!data || data.subject?.tenantId !== permission.subject.tenantId || data.subject?.userId !== permission.subject.userId || !Array.isArray(data.returns)) throw new Error('Invalid purchase return subject')
  const returns = new Set(permission.allowedPurchaseReturnIds ?? []), purchases = new Set(permission.allowedPurchaseOrderIds ?? [])
  const orders = new Set(permission.allowedOrderIds), stocks = new Set(permission.allowedStockOrderIds ?? [])
  const current = new Map(currentSources.map(source => [`${source.kind}:${source.id}`, source]))
  const ids = new Set<string>(), result: PurchaseReturn[] = []
  for (const row of data.returns) {
    if (!row || row.tenantId !== permission.subject.tenantId || !returns.has(row.id) || !purchases.has(row.purchaseOrder?.id) || row.kind !== 'physical_return') continue
    const rowId = text(row.id, true)
    if (ids.has(rowId) || !Array.isArray(row.lines)) throw new Error('Invalid purchase return document')
    ids.add(rowId)
    const lineIds = new Set<string>(), lines: PurchaseReturnLine[] = []
    for (const item of row.lines) {
      const reference = item?.sourceOrder
      const source = current.get(`${reference?.kind}:${reference?.id}`)
      if (!source || !(source.kind === 'stock' ? stocks : source.kind === 'fulfillment' ? orders : new Set()).has(source.id) || !matchesBusinessScope(scope, source)) continue
      const lineId = text(item.id, true)
      if (lineIds.has(lineId) || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.returnedQuantity) || item.returnedQuantity < 0 || item.returnedQuantity > item.quantity) throw new Error('Invalid purchase return quantity')
      lineIds.add(lineId)
      if (source.departmentPathIds !== undefined && (!Array.isArray(source.departmentPathIds) || source.departmentPathIds.some(id => typeof id !== 'string' || !id.trim()))) throw new Error('Invalid purchase return ancestry')
      lines.push({ id: lineId, sku: text(item.sku, true), name: text(item.name, true), variant: text(item.variant), imageUrl: text(item.imageUrl) || null, quantity: item.quantity, returnedQuantity: item.returnedQuantity,
        sourceOrder: { id: text(source.id, true), number: text(source.number, true), kind: source.kind, customerName: text(source.customerName), owner: { id: text(source.owner?.id, true), name: text(source.owner?.name, true) }, department: { id: text(source.department?.id, true), name: text(source.department?.name, true) }, ...(source.departmentPathIds ? { departmentPathIds: [...source.departmentPathIds] } : {}) } })
    }
    if (!lines.length) continue
    result.push(subtotal({ id: text(row.id, true), number: text(row.number) || null, status: purchaseReturnStatuses.includes(row.status as PurchaseReturnStatus) ? row.status as PurchaseReturnStatus : 'unknown', purchaseOrder: { id: text(row.purchaseOrder.id, true), number: text(row.purchaseOrder.number, true) }, supplier: { id: text(row.supplier?.id, true), name: text(row.supplier?.name, true) }, warehouseCode: text(row.warehouseCode), warehouse: text(row.warehouse), createdAt: normalizeBusinessTimestamp(row.createdAt), logistics: { carrier: text(row.logistics?.carrier) || null, trackingNumber: text(row.logistics?.trackingNumber) || null }, lines }))
  }
  return result.sort((a, b) => (b.createdAt ? Date.parse(b.createdAt) : -Infinity) - (a.createdAt ? Date.parse(a.createdAt) : -Infinity) || a.id.localeCompare(b.id))
}
export function filterPurchaseReturns(rows: PurchaseReturn[], query: PurchaseReturnFilters): PurchaseReturn[] {
  const search = query.search?.trim().toLowerCase()
  return rows.filter(row => (!query.status || row.status === query.status) && (!query.warehouseCode || row.warehouseCode === query.warehouseCode)).map(row => subtotal({ ...row, lines: row.lines.filter(line => (!query.ownerId || line.sourceOrder.owner.id === query.ownerId) && (!query.departmentId || line.sourceOrder.department.id === query.departmentId || line.sourceOrder.departmentPathIds?.includes(query.departmentId))) })).filter(row => row.lines.length && (!search || [row.number, row.purchaseOrder.number, row.supplier.name, row.logistics.trackingNumber, ...row.lines.flatMap(line => [line.sku, line.name, line.sourceOrder.number, line.sourceOrder.customerName, line.sourceOrder.owner.name])].some(value => value?.toLowerCase().includes(search))))
}

/** Fulfillment order is the primary row; linked return data is restricted to that order. */
export interface PurchaseReturnOrder extends FopOrder { purchaseReturns: PurchaseReturn[]; returnQuantity: number; returnedQuantity: number }
export function groupPurchaseReturnOrders(documents: PurchaseReturn[], orders: readonly FopOrder[], query: PurchaseReturnFilters): PurchaseReturnOrder[] {
  const source = new Map(orders.map(order => [order.id, order])), grouped = new Map<string, PurchaseReturnOrder>()
  for (const document of filterPurchaseReturns(documents, { ...query, search: undefined })) {
    const ids = new Set(document.lines.filter(line => line.sourceOrder.kind === 'fulfillment').map(line => line.sourceOrder.id))
    for (const id of ids) {
      const order = source.get(id)
      if (!order) continue
      const piece = subtotal({ ...document, lines: document.lines.filter(line => line.sourceOrder.kind === 'fulfillment' && line.sourceOrder.id === id) })
      let row = grouped.get(id)
      if (!row) { row = { ...order, purchaseReturns: [], returnQuantity: 0, returnedQuantity: 0 }; grouped.set(id, row) }
      row.purchaseReturns.push(piece); row.returnQuantity += piece.quantity; row.returnedQuantity += piece.returnedQuantity
    }
  }
  const search = query.search?.trim().toLowerCase()
  const rows = [...grouped.values()].filter(row => !search || [row.orderNumber, row.shopifyOrderNumber, row.customerName, row.storeName, row.owner?.name, ...row.items.flatMap(item => [item.sku, item.name]), ...row.purchaseReturns.flatMap(item => [item.number, item.purchaseOrder.number, item.supplier.name, item.logistics.trackingNumber, ...item.lines.flatMap(line => [line.sku, line.name])])].some(value => value?.toLowerCase().includes(search)))
  return rows.sort((a, b) => {
    const left = a.paidAt ? Date.parse(a.paidAt) : NaN, right = b.paidAt ? Date.parse(b.paidAt) : NaN
    if (!Number.isFinite(left) || !Number.isFinite(right)) { if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1 }
    else if (left !== right) return (left - right) * (query.paidAtOrder === 'desc' ? -1 : 1)
    return a.id.localeCompare(b.id)
  })
}
export function summarizePurchaseReturnOrders(rows: readonly PurchaseReturnOrder[]) {
  return { ...summarizeFopOrders(rows), returnCount: new Set(rows.flatMap(row => row.purchaseReturns.filter(document => document.number).map(document => document.id))).size, quantity: rows.reduce((sum, row) => sum + row.returnQuantity, 0), returnedQuantity: rows.reduce((sum, row) => sum + row.returnedQuantity, 0) }
}

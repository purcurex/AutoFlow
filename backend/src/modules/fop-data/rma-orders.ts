import { compareConsumerPaymentTime } from './fop-order-sort'
import { summarizeFopOrders } from './fop-order-totals'
import type { FopIdentity, FopOrder, FopPermissionGrant } from './fop-data.types'
import { normalizeBusinessTimestamp } from './fop-business-time'
export const rmaTypes = ['refund', 'return_refund', 'reshipment'] as const
export type RmaType = typeof rmaTypes[number]
export const rmaTypeLabels = { refund: ['仅退款', 'Refund only'], return_refund: ['退货退款', 'Return and refund'], reshipment: ['补发货', 'Reshipment'] } as const
export const rmaCaseTypes = [...rmaTypes, 'interception', 'cancellation', 'interception_release'] as const
export type RmaCaseType = typeof rmaCaseTypes[number]
export const rmaCaseLabels = { ...rmaTypeLabels, interception: ['订单拦截', 'Order interception'], cancellation: ['订单取消', 'Order cancellation'], interception_release: ['拦截取消', 'Interception cancelled'] } as const
export type RmaOrderTag = 'cancelled' | 'cancellation_requested' | 'intercepted' | 'interception_released'
export const rmaOrderTagLabels = { cancelled: ['订单取消', 'Order cancelled'], cancellation_requested: ['订单取消', 'Order cancellation'], intercepted: ['订单拦截', 'Order intercepted'], interception_released: ['拦截取消', 'Interception cancelled'] } as const
export interface RmaRefundAmount { currency: string | null; amount: number | null }
export interface RmaCase { id: string; orderId: string; type: RmaCaseType; isOpen: boolean | null; number: string | null; stage: string | null; reason: string | null; createdAt: string | null; updatedAt: string | null; requestedAmount: number | null; currency: string | null; refundAmount?: number | null; refundCurrency?: string | null }
export interface RmaCaseCandidate extends RmaCase { tenantId: string }
export interface RmaSnapshot { subject: FopIdentity; cases: RmaCaseCandidate[] }
export interface RmaFilters { type?: RmaType; flowStatus?: 'active' | 'closed' | 'all'; search?: string; departmentId?: string; ownerId?: string; warehouseCode?: string }
export interface RmaOrder extends FopOrder { sourceOrderId?: string; rmaCases: RmaCase[]; rmaUpdatedAt: string | null; orderTags?: RmaOrderTag[]; refundAmounts?: RmaRefundAmount[] }
export class RmaTypeConflictError extends Error {
  constructor() { super('Conflicting RMA after-sales types') }
}
export function assertRmaTypeCompatibility(cases: readonly (Pick<RmaCase, 'type'> & Partial<Pick<RmaCase, 'isOpen'>>)[]): void {
  const active = cases.filter(item => item.isOpen !== false && item.isOpen !== null)
  if (active.some(item => item.type === 'refund') && active.some(item => item.type === 'return_refund' || item.type === 'reshipment')) throw new RmaTypeConflictError()
}
const text = (value: unknown, limit = 1000) => typeof value === 'string' ? value.trim().slice(0, limit) || null : null
export function buildRmaOrders(snapshot: RmaSnapshot, permission: FopPermissionGrant, orders: readonly FopOrder[], query: RmaFilters, paths: ReadonlyMap<string, readonly string[]>): RmaOrder[] {
  if (!snapshot || snapshot.subject?.tenantId !== permission.subject.tenantId || snapshot.subject?.userId !== permission.subject.userId || !Array.isArray(snapshot.cases)) throw new Error('Invalid RMA snapshot')
  const allowedCases = new Set(permission.allowedRmaCaseIds ?? []), allowedOrders = new Set(permission.allowedOrderIds), byOrder = new Map<string, RmaCase[]>(), sources = new Map(orders.filter(order => allowedOrders.has(order.id)).map(order => [order.id, order]))
  const seen = new Set<string>()
  for (const row of snapshot.cases) {
    if (!row || row.tenantId !== permission.subject.tenantId || !allowedCases.has(row.id) || !sources.has(row.orderId)) continue
    const id = text(row.id)
    if (!id || id !== row.id || seen.has(id) || !rmaCaseTypes.includes(row.type) || row.isOpen !== null && typeof row.isOpen !== 'boolean') throw new Error('Invalid RMA case')
    seen.add(id)
    if (row.requestedAmount != null && (!Number.isFinite(row.requestedAmount) || row.requestedAmount < 0 || row.requestedAmount > Number.MAX_SAFE_INTEGER)) throw new Error('Invalid RMA amount')
    if (row.refundAmount != null && (!Number.isFinite(row.refundAmount) || row.refundAmount < 0 || row.refundAmount > Number.MAX_SAFE_INTEGER)) throw new Error('Invalid RMA refund amount')
    const item: RmaCase = { id, orderId: row.orderId, type: row.type, isOpen: row.isOpen, number: text(row.number), stage: text(row.stage), reason: text(row.reason, 4000), createdAt: normalizeBusinessTimestamp(row.createdAt), updatedAt: normalizeBusinessTimestamp(row.updatedAt), refundAmount: ['refund', 'return_refund'].includes(row.type) ? row.refundAmount ?? null : null, refundCurrency: typeof row.refundCurrency === 'string' && /^[A-Z]{3}$/.test(row.refundCurrency.trim().toUpperCase()) ? row.refundCurrency.trim().toUpperCase() : null, requestedAmount: row.requestedAmount ?? null, currency: typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency.trim().toUpperCase()) ? row.currency.trim().toUpperCase() : null }
    const group = byOrder.get(row.orderId) ?? []; group.push(item); byOrder.set(row.orderId, group)
  }
  const search = query.search?.trim().toLowerCase(), result: RmaOrder[] = []
  for (const [id, allCases] of byOrder) {
    assertRmaTypeCompatibility(allCases)
    const cases = allCases.filter(row => (!query.type || row.type === query.type) && (query.flowStatus === 'all' || row.isOpen === (query.flowStatus !== 'closed')))
    if (!cases.length) continue
    const order = sources.get(id)!
    if (query.departmentId && order.department?.id !== query.departmentId && !paths.get(id)?.includes(query.departmentId) || query.ownerId && order.owner?.id !== query.ownerId || query.warehouseCode && order.warehouseCode !== query.warehouseCode) continue
    for (const item of cases) {
      // A case is the list/selection identity; controls remain tags on that case's source order.
      if (!(rmaTypes as readonly string[]).includes(item.type)) continue
      if (search && ![order.orderNumber, order.shopifyOrderNumber, order.customerName, order.storeName, order.owner?.name, ...order.items.flatMap(product => [product.sku, product.name]), item.number, item.stage, item.reason].some(value => value?.toLowerCase().includes(search))) continue
      result.push({ ...order, id: item.id, sourceOrderId: order.id, rmaCases: [item], rmaUpdatedAt: item.updatedAt,
        orderTags: rmaOrderTags(order, allCases), refundAmounts: ['refund', 'return_refund'].includes(item.type) ? [{ currency: item.refundCurrency ?? null, amount: item.refundAmount ?? null }] : [] })
    }
  }
  return result.sort((a, b) => compareConsumerPaymentTime(a, b))
}

export function rmaOrderTags(order: FopOrder, cases: readonly RmaCase[]): RmaOrderTag[] {
  const tags: RmaOrderTag[] = []
  if (order.cancelled) tags.push('cancelled')
  else if (cases.some(item => item.type === 'cancellation' && item.isOpen)) tags.push('cancellation_requested')
  const latest = [...cases].filter(item => item.type === 'interception_release' || item.type === 'interception' && item.isOpen).sort((a, b) => (b.updatedAt ? Date.parse(b.updatedAt) : -Infinity) - (a.updatedAt ? Date.parse(a.updatedAt) : -Infinity) || a.id.localeCompare(b.id))[0]
  const interception = order.shipmentInterceptStatus ?? (latest?.type === 'interception' ? 'intercepted' : latest?.type === 'interception_release' ? 'released' : null)
  if (interception) tags.push(interception === 'intercepted' ? 'intercepted' : 'interception_released')
  return tags
}
/** Unknown settlement currencies are displayed per order, never mixed into monetary totals. */
export function summarizeRmaOrders(orders: readonly FopOrder[]) {
  orders = [...new Map(orders.map(order => [(order as RmaOrder).sourceOrderId ?? order.id, order])).values()]
  const totals = summarizeFopOrders(orders.filter(order => order.currency !== 'XXX'))
  return { ...totals, ...(orders.some(order => order.currency === 'XXX') ? { amountsByCurrency: [] } : {}), orderCount: orders.length, itemQuantity: orders.reduce((n, order) => n + order.items.reduce((q, item) => q + item.quantity, 0), 0) }
}

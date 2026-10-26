export const fopOrderQueues = ['unpaid', 'review', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'dispatch', 'shipping', 'exceptions'] as const
export type FopOrderQueue = typeof fopOrderQueues[number]
export interface FopOrderItem {
  productId?: string
  sku: string
  name: string
  imageUrl: string | null
  variant: string
  quantity: number
}
/** Independent, normalized FOP facts; unknown must never be inferred as pending. */
export interface FulfillmentProgress {
  shopifySync: 'pending' | 'partial' | 'synced' | 'not_required' | 'unknown'
  supplierShipment: 'pending' | 'partial' | 'shipped' | 'not_required' | 'unknown'
  stockReadiness: 'incomplete' | 'ready' | 'unknown'
  allocationReview: 'pending' | 'approved' | 'unknown'
  outbound: 'pending' | 'partial' | 'completed' | 'unknown'
}

/** Aggregated over effective linked purchases; independent of customer payment. */
export interface ProcurementProgress {
  purchaseOrder: 'not_ordered' | 'partial' | 'ordered' | 'cancelled' | 'not_required' | 'unknown'
  supplierPayment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'not_required' | 'unknown'
}

/** Effective linked dispatch documents; never inferred from customer payment or Shopify sync. */
export interface DispatchDocument {
  id: string
  number: string
  status: 'draft' | 'submitted' | 'approved' | 'unknown'
}

export interface FopOrder {
  /** null/omitted = unavailable; [] = confirmed no effective dispatch document. */
  dispatchDocuments?: DispatchDocument[] | null
  /** Optional for rolling upgrades; missing facts display as unknown. */
  procurementProgress?: ProcurementProgress
  fulfillmentProgress: FulfillmentProgress
  departmentPathIds?: string[]
  salesDepartmentCode?: 'sales1' | 'sales2' | 'sales3' | 'sales4'
  organization?: { id: string; name: string }
  department?: { id: string; name: string }
  owner?: { id: string; name: string }
  id: string
  orderNumber: string
  shopifyOrderNumber: string
  customerId?: string
  customerCode?: string
  warehouseCode?: string
  carrierCode?: string
  customerName: string
  storeName: string
  items: FopOrderItem[]
  amount: number
  currency: string
  paymentStatus: 'paid' | 'unpaid' | 'refunded'
  reviewStatus: 'pending' | 'approved'
  procurementStatus: 'pending' | 'purchased' | 'not_required'
  allocationStatus: 'pending' | 'allocated' | 'not_ready'
  dispatchStatus: 'pending' | 'dispatched' | 'not_ready'
  shippingStatus: 'pending' | 'shipped' | 'not_ready'
  warehouse: string
  carrier: string | null
  trackingNumber: string | null
  salesperson: string
  createdAt: string
  paidAt: string | null
  cancelled: boolean
  exception: { reason: 'stock' | 'address' | 'tracking'; hours: number } | null
}
export const warehouseStages = ['all', 'pending_review', 'pending_outbound'] as const
export type WarehouseStage = typeof warehouseStages[number]
export function isWarehouseStage(value: unknown): value is WarehouseStage {
  return typeof value === 'string' && (warehouseStages as readonly string[]).includes(value)
}
export const fopOrderSortFields = ['paidAt', 'dispatchDocumentStatus', 'allocationDocumentStatus', 'outboundStatus'] as const
export type FopOrderSortBy = typeof fopOrderSortFields[number]
export function isFopOrderSortBy(value: unknown): value is FopOrderSortBy {
  return typeof value === 'string' && (fopOrderSortFields as readonly string[]).includes(value)
}
export function canSortFopQueue(queue: FopOrderQueue, field: FopOrderSortBy): boolean {
  const queues: Record<Exclude<FopOrderSortBy, 'paidAt'>, readonly FopOrderQueue[]> = {
    dispatchDocumentStatus: ['dispatch', 'allocation', 'allocation_review'],
    allocationDocumentStatus: ['allocation', 'allocation_review', 'shipping'],
    outboundStatus: ['shipping'],
  }
  return field === 'paidAt' || !!queues[field]?.includes(queue)
}
export interface FopOrderQuery {
  sortBy?: FopOrderSortBy
  sortOrder?: 'asc' | 'desc'
  warehouseStage?: WarehouseStage
  queue: FopOrderQueue
  search?: string
  orderNumber?: string
  departmentId?: string
  paidAtOrder?: 'asc' | 'desc'
  page: number
  pageSize: number
}
/** Full authorized filter scope, independent of the requested page. */
export interface FopOrderTotals {
  orderCount: number
  itemQuantity: number
  amountsByCurrency: { currency: string; amount: number }[]
}
export interface FopOrderPage {
  source: 'mock' | 'fop'
  items: FopOrder[]
  total: number
  totals: FopOrderTotals
  page: number
  pageSize: number
}

export interface FopQueuePage extends FopOrderPage {
  /** BFF query completion time, not an upstream FOP synchronization watermark. */
  refreshedAt: string
  /** Departments from permitted orders, independent of queue/search/page filters. */
  departments: { id: string; name: string }[]
}

export function isFopOrderQueue(value: unknown): value is FopOrderQueue {
  return typeof value === 'string' && (fopOrderQueues as readonly string[]).includes(value)
}

function validateQuery(query: FopOrderQuery) {
  if (query.sortBy !== undefined && (!isFopOrderSortBy(query.sortBy) || !canSortFopQueue(query.queue, query.sortBy))) throw new Error('Invalid sort field')
  if (query.sortOrder !== undefined && !['asc', 'desc'].includes(query.sortOrder)) throw new Error('Invalid sort direction')
  if (query.warehouseStage !== undefined && (query.queue !== 'shipping' || !isWarehouseStage(query.warehouseStage))) throw new Error('Invalid warehouse stage')
  if (!isFopOrderQueue(query.queue)) throw new Error('Invalid fulfillment queue')
  if (query.paidAtOrder !== undefined && !['asc', 'desc'].includes(query.paidAtOrder)) throw new Error('Invalid payment sort order')
  if (query.departmentId !== undefined && (typeof query.departmentId !== 'string' || query.departmentId.length > 128)) throw new Error('Invalid department')
  if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    throw new Error('Invalid pagination')
  }
}

export function matchesFopQueue(order: FopOrder, queue: FopOrderQueue, warehouseStage?: WarehouseStage): boolean {
  if (order.cancelled) return false
  if (queue === 'unpaid') return order.paymentStatus === 'unpaid'
  if (order.paymentStatus !== 'paid') return false
  if (queue === 'review') return order.reviewStatus === 'pending'
  if (queue === 'exceptions') return order.shippingStatus !== 'shipped' && order.exception !== null
  if (order.reviewStatus !== 'approved' || !order.fulfillmentProgress) return false
  const progress = order.fulfillmentProgress
  switch (queue) {
    case 'dispatch': return progress.shopifySync === 'pending' || progress.shopifySync === 'partial'
    case 'procurement':
    case 'procurement_shipping': {
      const paidPurchase = order.procurementProgress?.purchaseOrder === 'ordered' && order.procurementProgress?.supplierPayment === 'paid'
      return (progress.supplierShipment === 'pending' || progress.supplierShipment === 'partial')
        && (queue === 'procurement_shipping' ? paidPurchase : !paidPurchase)
    }
    case 'allocation': return progress.stockReadiness === 'incomplete'
    case 'allocation_review': return progress.stockReadiness === 'ready' && progress.allocationReview === 'pending' && progress.outbound !== 'completed'
    case 'shipping': return progress.stockReadiness === 'ready' && progress.outbound !== 'completed'
      && (warehouseStage !== 'pending_review' || progress.allocationReview === 'pending')
      && (warehouseStage !== 'pending_outbound' || progress.allocationReview === 'approved')
      && (progress.allocationReview === 'pending' || progress.allocationReview === 'approved' && (progress.outbound === 'pending' || progress.outbound === 'partial'))
  }
}

/** User identity and data scope are derived exclusively by the authenticated backend. */
export async function getFopOrders(query: FopOrderQuery): Promise<FopQueuePage> {
  validateQuery(query)
  const { default: api } = await import('./index')
  const { queue, search, orderNumber, departmentId, paidAtOrder, sortBy, sortOrder, warehouseStage, page, pageSize } = query
  return api.get('/autoflow/integrations/fop/fulfillment-orders', { params: { queue, search, orderNumber, departmentId, paidAtOrder, sortBy, sortOrder, warehouseStage, page, pageSize } })
}
export const getFopOrdersFromApi = getFopOrders

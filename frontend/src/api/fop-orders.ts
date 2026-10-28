import { canFilterTaskStatus, type TaskStatus } from '@/utils/workbench-status'
import { canFilterProcurementStage, type ProcurementStage } from '@/utils/procurement-stage'
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
  /** Effective allocation document exists; missing/null cannot enter allocation or warehouse queues. */
  allocationCreated?: boolean | null
  shopifySync: 'pending' | 'synced' | 'not_required' | 'unknown'
  supplierShipment: 'pending' | 'partial' | 'shipped' | 'not_required' | 'unknown'
  stockReadiness: 'incomplete' | 'ready' | 'unknown'
  allocationReview: 'pending' | 'approved' | 'unknown'
  outbound: 'pending' | 'partial' | 'completed' | 'unknown'
}

/** Aggregated over effective linked purchases; independent of customer payment. */
export interface ProcurementProgress {
  /** Missing on older adapters means unknown; a known unfinished 1688 push remains a procurement task. */
  purchaseApplication?: 'not_created' | 'partial' | 'created' | 'not_required' | 'unknown'
  alibabaOrder?: 'not_pushed' | 'partial' | 'pushed' | 'not_required' | 'unknown'
  /** Logistics prerequisite for the actual 1688 push only, not permission/readiness to purchase. */
  logisticsGate?: 'pending_dispatch' | 'pending_logistics' | 'satisfied' | 'not_required' | 'unknown'
  purchaseOrder: 'not_ordered' | 'partial' | 'ordered' | 'cancelled' | 'not_required' | 'unknown'
  supplierPayment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'not_required' | 'unknown'
}

/** Effective linked dispatch documents; never inferred from customer payment or Shopify sync. */
export interface DispatchDocument {
  id: string
  number: string
  status: 'draft' | 'submitted' | 'approved' | 'unknown'
}

/** Shipping recipient on this fulfillment order, never the customer account profile. */
export interface ShippingRecipient {
  name: string | null
  phone: string | null
  email: string | null
  state: string | null
  city: string | null
  postalCode: string | null
  addressLine1: string | null
  addressLine2: string | null
}

export interface LogisticsChannel { name: string | null; code: string | null }

export interface LogisticsTrackingNumber { type: 'full' | 'first_mile' | 'last_mile'; number: string }
export interface LogisticsInfo {
  carrierName: string | null
  /** Explicit FOP selection for Shopify; never chosen from raw candidate numbers by this app. */
  shopifyTracking?: LogisticsTrackingNumber | null
  /** @deprecated Legacy candidates do not prove which number is selected. */
  trackingNumbers?: LogisticsTrackingNumber[]
}

export interface AllocationDocumentReference { id: string; number: string }

export interface FopOrder {
  /** Unique effective FOP allocation for this order; null/omitted = unavailable or not yet created. */
  allocationDocument?: AllocationDocumentReference | null
  /** Shopify-selected tracking grouped by shipment/carrier; raw legacy fields do not prove selection. */
  logisticsInfo?: LogisticsInfo[] | null
  /** FOP-maintained English custom channel name, independent of UI language; never actual channels or carriers. */
  customLogisticsChannelName?: string | null
  /** Actual fulfillment channels, never carrier categories or customer-facing custom channels. */
  logisticsChannels?: LogisticsChannel[] | null
  /** First Shopify consumer payment completion, distinct from FOP createdAt and paidAt; unknown = null. */
  reviewedAt?: string | null
  consumerPaidAt?: string | null
  /** Earliest actual payment among effective paid purchase obligations still awaiting supplier shipment. */
  procurementPaidAt?: string | null
  /** Current existing allocation completion time; cleared when allocation becomes incomplete. */
  allocationReadyAt?: string | null
  /** Successful delivery-notice push to WMS; distinct from order creation. Missing = null. */
  wmsCreatedAt?: string | null
  shippingRecipient?: ShippingRecipient | null
  /** Order delivery destination ISO alpha2, not customer profile country; null/omitted when unavailable. */
  shippingCountryCode?: string | null
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
export const fopOrderSortFields = ['paidAt', 'reviewedAt', 'consumerPaidAt', 'dispatchDocumentStatus', 'allocationDocumentStatus', 'stockReadiness', 'allocationReviewStatus', 'outboundStatus'] as const
export type FopOrderSortBy = typeof fopOrderSortFields[number]
export function isFopOrderSortBy(value: unknown): value is FopOrderSortBy {
  return typeof value === 'string' && (fopOrderSortFields as readonly string[]).includes(value)
}
export function canSortFopQueue(queue: FopOrderQueue, field: FopOrderSortBy): boolean {
  const queues: Record<Exclude<FopOrderSortBy, 'paidAt'>, readonly FopOrderQueue[]> = {
    reviewedAt: ['procurement'],
    consumerPaidAt: ['unpaid', 'review', 'exceptions', 'dispatch', 'allocation'],
    dispatchDocumentStatus: ['dispatch', 'allocation', 'allocation_review'],
    allocationDocumentStatus: ['allocation', 'allocation_review', 'shipping'],
    stockReadiness: ['allocation', 'allocation_review'],
    allocationReviewStatus: ['allocation', 'allocation_review'],
    outboundStatus: ['shipping'],
  }
  return field === 'paidAt' || !!queues[field]?.includes(queue)
}
export interface FopOrderQuery {
  warehouseCode?: 'HZ' | 'SZ'
  taskStatus?: TaskStatus
  procurementStage?: ProcurementStage
  sortBy?: FopOrderSortBy
  sortOrder?: 'asc' | 'desc'
  warehouseStage?: WarehouseStage
  queue: FopOrderQueue
  search?: string
  orderNumber?: string
  departmentId?: string
  ownerId?: string
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
  /** Authorized order owners in the selected department, independent of queue/search/page. */
  salespeople?: { id: string; name: string }[]
}

export function isFopOrderQueue(value: unknown): value is FopOrderQueue {
  return typeof value === 'string' && (fopOrderQueues as readonly string[]).includes(value)
}

function validateQuery(query: FopOrderQuery) {
  if (query.taskStatus !== undefined && !canFilterTaskStatus(query.queue, query.taskStatus)) throw new Error('Invalid task status')
  if (query.procurementStage !== undefined && !canFilterProcurementStage(query.queue, query.procurementStage)) throw new Error('Invalid procurement stage')
  if (query.sortBy !== undefined && (!isFopOrderSortBy(query.sortBy) || !canSortFopQueue(query.queue, query.sortBy))) throw new Error('Invalid sort field')
  if (query.sortOrder !== undefined && !['asc', 'desc'].includes(query.sortOrder)) throw new Error('Invalid sort direction')
  if (query.warehouseStage !== undefined && (query.queue !== 'shipping' || !isWarehouseStage(query.warehouseStage))) throw new Error('Invalid warehouse stage')
  if (!isFopOrderQueue(query.queue)) throw new Error('Invalid fulfillment queue')
  if (query.paidAtOrder !== undefined && !['asc', 'desc'].includes(query.paidAtOrder)) throw new Error('Invalid payment sort order')
  if (query.departmentId !== undefined && (typeof query.departmentId !== 'string' || query.departmentId.length > 128)) throw new Error('Invalid department')
  if (query.ownerId !== undefined && (typeof query.ownerId !== 'string' || query.ownerId.length > 128)) throw new Error('Invalid salesperson')
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
  const progress = order.fulfillmentProgress
  if (!progress) return false
  // Only reviewed fulfillment orders can await Shopify tracking/fulfillment sync.
  if (queue === 'dispatch') return order.reviewStatus === 'approved' && progress.shopifySync === 'pending'
  if (queue === 'procurement' || queue === 'procurement_shipping') {
    const purchase = order.procurementProgress
    if (!purchase) return false
    const pendingPush = purchase.alibabaOrder === 'not_pushed' || purchase.alibabaOrder === 'partial'
    if (queue === 'procurement_shipping') return !pendingPush && purchase.purchaseOrder === 'ordered' && purchase.supplierPayment === 'paid'
      && (progress.supplierShipment === 'pending' || progress.supplierShipment === 'partial')
    // Remaining unplaced demand is not fully paid; unknown facts are not unpaid facts.
    return purchase.purchaseOrder === 'not_ordered' || purchase.purchaseOrder === 'partial'
      || purchase.purchaseOrder === 'ordered' && (pendingPush || ['unpaid', 'partial', 'refunded'].includes(purchase.supplierPayment))
  }
  if (order.reviewStatus !== 'approved' || progress.allocationCreated !== true) return false
  switch (queue) {
    case 'allocation': return progress.stockReadiness === 'incomplete' && progress.allocationReview === 'pending' && progress.outbound !== 'completed'
    case 'allocation_review': return progress.stockReadiness === 'ready' && progress.allocationReview === 'pending' && progress.outbound !== 'completed'
    // Pending allocation approval belongs only to allocation; legacy pending_review queries stay empty.
    case 'shipping': return warehouseStage !== 'pending_review' && progress.stockReadiness === 'ready'
      && progress.allocationReview === 'approved' && (progress.outbound === 'pending' || progress.outbound === 'partial')
  }
}

/** User identity and data scope are derived exclusively by the authenticated backend. */
export async function getFopOrders(query: FopOrderQuery): Promise<FopQueuePage> {
  validateQuery(query)
  const { default: api } = await import('./index')
  const { queue, search, orderNumber, departmentId, ownerId, warehouseCode, paidAtOrder, sortBy, sortOrder, warehouseStage, procurementStage, taskStatus, page, pageSize } = query
  return api.get('/autoflow/integrations/fop/fulfillment-orders', { params: { queue, search, orderNumber, departmentId, ownerId, warehouseCode, paidAtOrder, sortBy, sortOrder, warehouseStage, procurementStage, taskStatus, page, pageSize } })
}
export const getFopOrdersFromApi = getFopOrders

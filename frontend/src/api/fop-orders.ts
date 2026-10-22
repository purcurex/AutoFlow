export const fopOrderQueues = ['review', 'procurement', 'allocation', 'dispatch', 'shipping', 'exceptions'] as const
export type FopOrderQueue = typeof fopOrderQueues[number]
export interface FopOrderItem {
  productId?: string
  sku: string
  name: string
  imageUrl: string | null
  variant: string
  quantity: number
}
export interface FopOrder {
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
export interface FopOrderQuery {
  queue: FopOrderQueue
  search?: string
  orderNumber?: string
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

export function isFopOrderQueue(value: unknown): value is FopOrderQueue {
  return typeof value === 'string' && (fopOrderQueues as readonly string[]).includes(value)
}

function validateQuery(query: FopOrderQuery) {
  if (!isFopOrderQueue(query.queue)) throw new Error('Invalid fulfillment queue')
  if (!Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    throw new Error('Invalid pagination')
  }
}

export function matchesFopQueue(order: FopOrder, queue: FopOrderQueue): boolean {
  if (order.cancelled || order.paymentStatus === 'refunded') return false
  switch (queue) {
    case 'review': return order.reviewStatus === 'pending'
    case 'procurement': return order.reviewStatus === 'approved' && order.paymentStatus === 'paid' && order.procurementStatus === 'pending'
    case 'allocation': return order.reviewStatus === 'approved' && order.paymentStatus === 'paid' && order.allocationStatus === 'pending'
    case 'dispatch': return order.paymentStatus === 'paid' && order.allocationStatus === 'allocated' && order.dispatchStatus === 'pending'
    case 'shipping': return order.paymentStatus === 'paid' && order.dispatchStatus === 'dispatched' && order.shippingStatus === 'pending'
    case 'exceptions': return order.paymentStatus === 'paid' && order.shippingStatus !== 'shipped' && order.exception !== null
  }
}

/** User identity and data scope are derived exclusively by the authenticated backend. */
export async function getFopOrders(query: FopOrderQuery): Promise<FopOrderPage> {
  validateQuery(query)
  const { default: api } = await import('./index')
  const { queue, search, orderNumber, page, pageSize } = query
  return api.get('/autoflow/integrations/fop/fulfillment-orders', { params: { queue, search, orderNumber, page, pageSize } })
}
export const getFopOrdersFromApi = getFopOrders

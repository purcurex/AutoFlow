import type { FopOrderItem, SalesDepartmentCode } from './fop-data.types'

export const STOCK_BILL_STATUS_LABELS: Record<string, string> = { A: '暂存', B: '已提交', C: '已审核' }
export const STOCK_TYPES = ['full_payment', 'deposit'] as const
export const STOCK_ORDER_STATUSES = ['cancelled', 'unpaid', 'paid'] as const
export const STOCK_SORT_FIELDS = ['createdAt', 'paidAt', 'orderStatus', 'purchaseStatus'] as const
export type StockSortField = typeof STOCK_SORT_FIELDS[number]
export type StockOrderStatus = typeof STOCK_ORDER_STATUSES[number]
export const STOCK_LIFECYCLES = ['unpaid', 'pending_procurement', 'received'] as const
export type StockLifecycle = typeof STOCK_LIFECYCLES[number]
export const STOCK_LIFECYCLE_LABELS: Record<StockLifecycle, string> = { unpaid: '已创建待支付', pending_procurement: '已支付待采购', received: '采购完成已入库' }
export const STOCK_ORDER_LABELS = { cancelled: '已取消', unpaid: '待支付', paid: '已支付' }
export const STOCK_PURCHASE_STATUSES = ['unpurchased', 'partial', 'in_progress', 'purchased', 'shipped', 'received', 'unknown'] as const
export type StockType = typeof STOCK_TYPES[number]
export type StockPurchaseStatus = typeof STOCK_PURCHASE_STATUSES[number]
export const STOCK_TYPE_LABELS = { full_payment: '全款备货', deposit: '押金备货' }
export const STOCK_PURCHASE_LABELS = { unpurchased: '未采购', partial: '部分采购', in_progress: '采购中', purchased: '已采购', shipped: '已发货', received: '已入库', unknown: '—' }

export interface StockOwnership {
  customerId: string; customerCode: string; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }
  departmentPathIds?: string[]; salesDepartmentCode?: SalesDepartmentCode
}
export interface FopStockOrder extends StockOwnership {
  exception?: { type: string | null; reason?: string | null; hours?: number | null } | null
  id: string; stockNumber: string; stockType: StockType; storeName: string | null
  items: FopOrderItem[]; amount: number; currency: string; paidAt: string | null
  /** Actual stock-order creation time; never inferred from a fulfillment order or paidAt. */
  createdAt?: string | null
  paymentStatus: 'paid' | 'unpaid' | 'unknown'; reviewStatus: 'approved' | 'pending' | 'unknown'
  orderStatus: StockOrderStatus | null
  rawOrderStatus?: string | null; rawBillStatus?: string | null
  orderStatusName?: string | null; rawPurchaseStatus?: string | null; purchaseStatusName?: string | null
  /** Actual procurement payment for outstanding supplier shipment, not customer paidAt. */
  procurementPaidAt?: string | null
  purchaseStatus: StockPurchaseStatus; warehouseCode: string; warehouse: string
}
export interface FopStockOrderCandidate extends Omit<FopStockOrder, 'paymentStatus' | 'reviewStatus' | 'orderStatus'> { tenantId: string; cancelled: boolean; paymentStatus?: FopStockOrder['paymentStatus']; reviewStatus?: FopStockOrder['reviewStatus'] }
export interface StockBalance { available: number; locked: number }
/** Owner/department MUST be the customer's current assignment, not an old stock order's owner. */
export interface FopStockInventoryCandidate extends StockOwnership {
  tenantId: string; id: string; sku: string; name: string; imageUrl: string | null
  warehouseCode: string; warehouse: string; fullPayment: StockBalance; deposit: StockBalance
}
export interface StockFilters {
  queue?: 'all' | 'procurement'
  search?: string; warehouseCode?: string; departmentId?: string; ownerId?: string
  stockType?: StockType; purchaseStatus?: StockPurchaseStatus; orderStatus?: StockOrderStatus; reviewStatus?: 'pending' | 'approved'; sortBy?: StockSortField; sortOrder?: 'asc' | 'desc'
  lifecycle?: StockLifecycle; timeRange?: 'all' | '1w' | '1m' | '3m'
}
export interface StockPageQuery extends StockFilters { page: number; pageSize: number }
export interface StockInventoryQuery { orderIds?: string[]; queue?: 'all' | 'procurement'; customerId?: string; customerSearch?: string; search?: string; warehouseCode?: string; departmentId?: string; ownerId?: string; page: number; pageSize: number }

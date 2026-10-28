import type { FopOrderItem, SalesDepartmentCode } from './fop-data.types'

export const STOCK_TYPES = ['full_payment', 'deposit'] as const
export const STOCK_PURCHASE_STATUSES = ['unpurchased', 'partial', 'purchased', 'shipped', 'received', 'unknown'] as const
export type StockType = typeof STOCK_TYPES[number]
export type StockPurchaseStatus = typeof STOCK_PURCHASE_STATUSES[number]
export const STOCK_TYPE_LABELS = { full_payment: '全款备货', deposit: '押金备货' }
export const STOCK_PURCHASE_LABELS = { unpurchased: '未采购', partial: '部分采购', purchased: '已采购', shipped: '已发货', received: '已入库', unknown: '—' }

export interface StockOwnership {
  customerId: string; customerCode: string; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }
  departmentPathIds?: string[]; salesDepartmentCode?: SalesDepartmentCode
}
export interface FopStockOrder extends StockOwnership {
  id: string; stockNumber: string; stockType: StockType; storeName: string | null
  items: FopOrderItem[]; amount: number; currency: string; paidAt: string | null
  paymentStatus: 'paid' | 'unpaid' | 'unknown'; reviewStatus: 'approved' | 'pending' | 'unknown'
  purchaseStatus: StockPurchaseStatus; warehouseCode: string; warehouse: string
}
export interface FopStockOrderCandidate extends Omit<FopStockOrder, 'paymentStatus' | 'reviewStatus'> { tenantId: string; cancelled: boolean; paymentStatus?: FopStockOrder['paymentStatus']; reviewStatus?: FopStockOrder['reviewStatus'] }
export interface StockBalance { available: number; locked: number }
/** Owner/department MUST be the customer's current assignment, not an old stock order's owner. */
export interface FopStockInventoryCandidate extends StockOwnership {
  tenantId: string; id: string; sku: string; name: string; imageUrl: string | null
  warehouseCode: string; warehouse: string; fullPayment: StockBalance; deposit: StockBalance
}
export interface StockFilters {
  queue?: 'all' | 'procurement'
  search?: string; warehouseCode?: string; departmentId?: string; ownerId?: string
  stockType?: StockType; purchaseStatus?: StockPurchaseStatus; sortOrder?: 'asc' | 'desc'
}
export interface StockPageQuery extends StockFilters { page: number; pageSize: number }
export interface StockInventoryQuery { customerId?: string; customerSearch?: string; search?: string; warehouseCode?: string; departmentId?: string; ownerId?: string; page: number; pageSize: number }

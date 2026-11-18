import type { WorkbenchDataAvailability, WorkbenchReplicaSnapshot } from './workbench-replica'
import api from './index'
import type { FopOrderItem } from './fop-orders'

export type StockType = 'full_payment' | 'deposit'
export type StockSortField = 'createdAt' | 'paidAt' | 'orderStatus' | 'purchaseStatus'
export type StockOrderStatus = 'cancelled' | 'unpaid' | 'paid'
export type StockLifecycle = 'unpaid' | 'pending_procurement' | 'received'
export const stockLifecycles: Record<StockLifecycle, [string, string]> = { unpaid: ['已创建待支付', 'Created · unpaid'], pending_procurement: ['已支付待采购', 'Paid · procurement pending'], received: ['采购完成已入库', 'Procured · received'] }
export const stockOrderStatuses: Record<StockOrderStatus, [string, string]> = { cancelled: ['已取消', 'Cancelled'], unpaid: ['待支付', 'Pending payment'], paid: ['已支付', 'Paid'] }
export type StockPurchaseStatus = 'unpurchased' | 'partial' | 'in_progress' | 'purchased' | 'shipped' | 'received' | 'unknown'
export const stockTypes: Record<StockType, [string, string]> = { full_payment: ['全款备货', 'Full payment'], deposit: ['押金备货', 'Deposit'] }
export const stockStatuses: Record<StockPurchaseStatus, [string, string]> = { unpurchased: ['未采购', 'Not purchased'], partial: ['部分采购', 'Partly purchased'], in_progress: ['采购中', 'Procurement in progress'], purchased: ['已采购', 'Purchased'], shipped: ['已发货', 'Shipped'], received: ['已入库', 'Received'], unknown: ['—', '—'] }
export interface StockOwner {
  customerId: string; customerCode: string; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }
}
export const stockBillStatusLabels: Record<string, [string, string]> = { A: ['暂存', 'Draft'], B: ['已提交', 'Submitted'], C: ['已审核', 'Approved'] }
export interface StockOrder {
  exception?: { type: string | null; reason?: string | null; hours?: number | null } | null
  customerId: string | null; customerCode: string | null; customerName: string | null
  owner: StockOwner['owner'] | null; department: StockOwner['department'] | null
  id: string; stockNumber: string; stockType: StockType | null; storeName: string | null
  items: FopOrderItem[]; amount: number | null; currency: string | null
  dataQuality?: { mode: 'collected'; readOnly: true; missingFields: string[]; reasons: string[] }
  /** Completed payment on this stock order; used by its relative time filter. */
  paidAt: string | null
  createdAt?: string | null
  orderStatus: StockOrderStatus | null
  reviewStatus?: 'pending' | 'approved' | 'unknown' | null
  rawBillStatus?: string | null
  rawOrderStatus?: string | null; orderStatusName?: string | null; rawPurchaseStatus?: string | null; purchaseStatusName?: string | null
  /** Actual supplier payment; never customer paidAt. Missing means no aging assessment. */
  procurementPaidAt?: string | null
  purchaseStatus: StockPurchaseStatus | null; warehouseCode: string | null; warehouse: string | null
}
export interface StockScope { search?: string; warehouseCode?: string; departmentId?: string; ownerId?: string }
export interface StockFilters extends StockScope { queue?: 'all' | 'procurement'; stockType?: StockType; purchaseStatus?: StockPurchaseStatus; orderStatus?: StockOrderStatus; reviewStatus?: 'pending' | 'approved'; sortBy?: StockSortField; sortOrder?: 'asc' | 'desc'; lifecycle?: StockLifecycle; timeRange?: 'all' | '1w' | '1m' | '3m' }
export interface StockQuery extends StockFilters { page: number; pageSize: number }
export interface StockPage {
  dataAvailability?: WorkbenchDataAvailability; replica?: WorkbenchReplicaSnapshot

  items: StockOrder[]; total: number; page: number; pageSize: number; source: 'mock' | 'fop'; refreshedAt: string
  departments: { id: string; name: string }[]
  totals: { orderCount: number; itemQuantity: number | null; amounts: { currency: string; amount: number }[] }
}
export interface StockCustomer { id: string; code: string; name: string }
export interface StockBalance { available: number | null; locked: number | null; onHand: number | null }
export interface StockInventory extends StockOwner {
  id: string; sku: string; name: string; imageUrl: string | null; warehouseCode: string; warehouse: string
  fullPayment: StockBalance; deposit: StockBalance; onHand: number | null
}
export interface StockInventoryPage { items: StockInventory[]; customerId: string | null; total: number; page: number; pageSize: number; source: 'mock' | 'fop'; refreshedAt: string }
const base = '/autoflow/integrations/fop'
export const getStockOrders = (params: StockQuery, signal?: AbortSignal) => api.get<StockPage, StockPage>(`${base}/stock-orders`, { params, signal })
export const getStockCustomers = (params: StockScope) => api.get<{ items: StockCustomer[]; total: number }, { items: StockCustomer[]; total: number }>(`${base}/stock-customers`, { params })
export const getStockInventory = (params: StockScope & { orderIds?: string[]; queue?: 'all' | 'procurement'; customerId?: string; customerSearch?: string; page: number; pageSize: number }) => api.get<StockInventoryPage, StockInventoryPage>(`${base}/stock-inventory`, { params, paramsSerializer: { indexes: null } })
export async function exportStockOrders(query: StockFilters & ({ mode: 'selected'; orderIds: string[] } | { mode: 'filtered' }), signal?: AbortSignal): Promise<Blob> {
  const { queue, search, warehouseCode, departmentId, ownerId, stockType, purchaseStatus, orderStatus, reviewStatus, sortBy, sortOrder, lifecycle, timeRange, mode } = query
  try {
    return await api.post<Blob, Blob>(`${base}/stock-orders/export`, { queue, search, warehouseCode, departmentId, ownerId, stockType, purchaseStatus, orderStatus, reviewStatus, sortBy, sortOrder, lifecycle, timeRange, mode, ...(mode === 'selected' ? { orderIds: query.orderIds } : {}) }, { responseType: 'blob', timeout: 30000, signal })
  } catch (error) {
    if (error instanceof Blob) { let parsed: unknown; try { parsed = JSON.parse(await error.text()) } catch { throw new Error('Export failed') }; throw parsed }
    throw error
  }
}

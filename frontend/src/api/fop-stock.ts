import api from './index'
import type { FopOrderItem } from './fop-orders'

export type StockType = 'full_payment' | 'deposit'
export type StockPurchaseStatus = 'unpurchased' | 'partial' | 'purchased' | 'shipped' | 'received' | 'unknown'
export const stockTypes: Record<StockType, [string, string]> = { full_payment: ['全款备货', 'Full payment'], deposit: ['押金备货', 'Deposit'] }
export const stockStatuses: Record<StockPurchaseStatus, [string, string]> = { unpurchased: ['未采购', 'Not purchased'], partial: ['部分采购', 'Partly purchased'], purchased: ['已采购', 'Purchased'], shipped: ['已发货', 'Shipped'], received: ['已入库', 'Received'], unknown: ['—', '—'] }
export interface StockOwner {
  customerId: string; customerCode: string; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }
}
export interface StockOrder extends StockOwner {
  id: string; stockNumber: string; stockType: StockType; storeName: string | null
  items: FopOrderItem[]; amount: number; currency: string; paidAt: string | null
  purchaseStatus: StockPurchaseStatus; warehouseCode: string; warehouse: string
}
export interface StockScope { search?: string; warehouseCode?: string; departmentId?: string; ownerId?: string }
export interface StockFilters extends StockScope { queue?: 'all' | 'procurement'; stockType?: StockType; purchaseStatus?: StockPurchaseStatus; sortOrder?: 'asc' | 'desc' }
export interface StockQuery extends StockFilters { page: number; pageSize: number }
export interface StockPage {
  items: StockOrder[]; total: number; page: number; pageSize: number; source: 'mock' | 'fop'; refreshedAt: string
  departments: { id: string; name: string }[]
  totals: { orderCount: number; itemQuantity: number; amounts: { currency: string; amount: number }[] }
}
export interface StockCustomer { id: string; code: string; name: string }
export interface StockBalance { available: number; locked: number; onHand: number }
export interface StockInventory extends StockOwner {
  id: string; sku: string; name: string; imageUrl: string | null; warehouseCode: string; warehouse: string
  fullPayment: StockBalance; deposit: StockBalance; onHand: number
}
export interface StockInventoryPage { items: StockInventory[]; customerId: string | null; total: number; page: number; pageSize: number; source: 'mock' | 'fop'; refreshedAt: string }
const base = '/autoflow/integrations/fop'
export const getStockOrders = (params: StockQuery) => api.get<StockPage, StockPage>(`${base}/stock-orders`, { params })
export const getStockCustomers = (params: StockScope) => api.get<{ items: StockCustomer[]; total: number }, { items: StockCustomer[]; total: number }>(`${base}/stock-customers`, { params })
export const getStockInventory = (params: StockScope & { customerId?: string; customerSearch?: string; page: number; pageSize: number }) => api.get<StockInventoryPage, StockInventoryPage>(`${base}/stock-inventory`, { params })
export async function exportStockOrders(query: StockFilters & ({ mode: 'selected'; orderIds: string[] } | { mode: 'filtered' }), signal?: AbortSignal): Promise<Blob> {
  const { queue, search, warehouseCode, departmentId, ownerId, stockType, purchaseStatus, sortOrder, mode } = query
  try {
    return await api.post<Blob, Blob>(`${base}/stock-orders/export`, { queue, search, warehouseCode, departmentId, ownerId, stockType, purchaseStatus, sortOrder, mode, ...(mode === 'selected' ? { orderIds: query.orderIds } : {}) }, { responseType: 'blob', timeout: 120000, signal })
  } catch (error) {
    if (error instanceof Blob) { let parsed: unknown; try { parsed = JSON.parse(await error.text()) } catch { throw new Error('Export failed') }; throw parsed }
    throw error
  }
}

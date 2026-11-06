import type { FopOrder, FopOrderTotals } from './fop-orders'
import api from './index'
export const purchaseReturnLabels = {
  pending_outbound: ['待退货出库', 'Pending return outbound'], in_transit: ['退货在途', 'Return in transit'], received: ['供应商已收货', 'Supplier received'], completed: ['退货完成', 'Return completed'], cancelled: ['已取消', 'Cancelled'], unknown: ['待确认', 'Unconfirmed'],
} as const
export type PurchaseReturnStatus = keyof typeof purchaseReturnLabels
export interface PurchaseReturnLine {
  id: string; sku: string; name: string; variant: string; imageUrl: string | null; quantity: number; returnedQuantity: number
  sourceOrder: { id: string; number: string; kind: 'fulfillment' | 'stock'; customerName: string; owner: { id: string; name: string }; department: { id: string; name: string } }
}
export interface PurchaseReturn {
  id: string; number: string | null; status: PurchaseReturnStatus; purchaseOrder: { id: string; number: string }; supplier: { id: string; name: string }; warehouseCode: string; warehouse: string; createdAt: string | null
  logistics: { carrier: string | null; trackingNumber: string | null }; lines: PurchaseReturnLine[]; quantity: number; returnedQuantity: number
}
export interface PurchaseReturnOrder extends FopOrder { purchaseReturns: PurchaseReturn[]; returnQuantity: number; returnedQuantity: number }
export interface PurchaseReturnFilters { paidAtOrder?: 'asc' | 'desc'; workbenchRole: 'procurement' | 'warehouse'; search?: string; departmentId?: string; ownerId?: string; warehouseCode?: 'HZ' | 'SZ'; status?: PurchaseReturnStatus }
export interface PurchaseReturnQuery extends PurchaseReturnFilters { page: number; pageSize: number }
export interface PurchaseReturnPage { items: PurchaseReturnOrder[]; total: number; page: number; pageSize: number; departments: { id: string; name: string }[]; source: 'mock' | 'fop'; refreshedAt: string; totals: FopOrderTotals & { returnCount: number; quantity: number; returnedQuantity: number } }
const filters = (q: PurchaseReturnFilters) => ({ paidAtOrder: q.paidAtOrder, workbenchRole: q.workbenchRole, search: q.search, departmentId: q.departmentId, ownerId: q.ownerId, warehouseCode: q.warehouseCode, status: q.status })
export function getPurchaseReturns(query: PurchaseReturnQuery, signal?: AbortSignal): Promise<PurchaseReturnPage> { return api.get('/autoflow/integrations/fop/purchase-returns', { params: { ...filters(query), page: query.page, pageSize: query.pageSize }, signal }) }
export function exportPurchaseReturns(query: PurchaseReturnFilters, mode: 'selected' | 'filtered', orderIds: string[], signal?: AbortSignal): Promise<Blob> {
  return api.post('/autoflow/integrations/fop/purchase-returns/export', { ...filters(query), mode, ...(mode === 'selected' ? { orderIds } : {}) }, { responseType: 'blob', timeout: 120000, signal })
}

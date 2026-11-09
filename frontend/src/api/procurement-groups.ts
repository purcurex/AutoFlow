import api from './index'
export interface PurchaseHeader {
  purchaseType: 'offline' | 'online' | 'unknown'; platform: '1688' | 'other' | null
  id: string; number: string; supplier: { id: string; name: string }; platformOrderNumber: string | null
  payment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'partially_refunded' | 'unknown'; placement: 'pending' | 'placed' | 'unknown'; paidAt: string | null
}
export interface PurchaseGroup {
  id: string; kind: 'purchase' | 'uncreated'; purchase: PurchaseHeader | null
  orderCount: number; skuCount: number; quantity: number | null; shippedQuantity: number | null; pendingQuantity: number | null
  shipment: 'pending' | 'partial' | 'shipped' | 'unknown'; earliestReceiptAt: string | null; completedAt?: string | null
}
export interface PurchaseGroupRow {
  orderId: string; orderNumber: string; shopifyOrderNumber: string; customerName: string; storeName: string; ownerName: string; departmentName: string; warehouse: string; paidAt: string | null; completedAt?: string | null
  lines: { fulfillmentLineId: string; purchaseLineId: string | null; sku: string; name: string; imageUrl: string | null; variant: string; quantity: number; shippedQuantity: number | null; demandStage?: 'application_pending' | 'purchase_order_pending' }[]
}
export const purchaseStageLabels = {
  uncreated: ['待创建采购单', 'Purchase not created'],
  placement_pending: ['待下单 / 推单', 'Placement pending'],
  payment_pending: ['待支付采购款', 'Purchase payment pending'],
  refund_pending: ['采购退款待跟进', 'Refund follow-up'],
} as const
export type PurchaseStage = keyof typeof purchaseStageLabels
export function isPurchaseStage(value: unknown): value is PurchaseStage {
  return typeof value === 'string' && Object.hasOwn(purchaseStageLabels, value)
}
export interface PurchaseFilters { completed?: boolean; timeRange?: '1w' | '1m' | '3m'; purchaseStage?: PurchaseStage; queue: 'procurement' | 'procurement_shipping'; search?: string; departmentId?: string; ownerId?: string; warehouseCode?: string; sortOrder?: 'asc' | 'desc' }
export interface PurchaseQuery extends PurchaseFilters { page: number; pageSize: number }
export interface PurchasePage { items: PurchaseGroup[]; total: number; page: number; pageSize: number; refreshedAt: string; source: 'mock' | 'fop'; departments: { id: string; name: string }[]; totals: { groupCount: number; purchaseCount: number; orderCount: number; uncreatedCount: number; pendingQuantity: number | null } }
export interface PurchaseDetails { group: PurchaseGroup; items: PurchaseGroupRow[]; total: number; page: number; pageSize: number }
const base = '/autoflow/integrations/fop/purchase-groups'
export const getPurchaseGroups = (params: PurchaseQuery) => api.get<PurchasePage, PurchasePage>(base, { params })
export const getPurchaseGroupDetails = (id: string, params: PurchaseQuery) => api.get<PurchaseDetails, PurchaseDetails>(`${base}/${encodeURIComponent(id)}`, { params })
export const exportPurchaseGroups = async (body: PurchaseFilters & ({ mode: 'filtered' } | { mode: 'selected'; groupIds: string[] }), signal?: AbortSignal) => {
  try { return await api.post<Blob, Blob>(`${base}/export`, body, { responseType: 'blob', timeout: 120000, signal }) }
  catch (error) {
    if (error instanceof Blob) {
      let parsed: unknown
      try { parsed = JSON.parse(await error.text()) } catch { throw new Error('Export failed') }
      throw parsed
    }
    throw error
  }
}

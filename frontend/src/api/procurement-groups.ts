import type { WorkbenchDataAvailability, WorkbenchReplicaSnapshot } from './workbench-replica'
import api from './index'
export interface PurchaseHeader {
  purchaseType: 'offline' | 'online' | 'unknown'; platform: '1688' | 'other' | null
  id: string; number: string; supplier: { id: string | null; name: string | null; wangwangAccount?: string | null; phone?: string | null }; platformOrderNumber: string | null
  payment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'cancelled' | 'partially_refunded' | 'unknown'; paymentName?: string | null; actualPaidAmount?: number | null; actualPaidFreight?: number | null; placement: 'pending' | 'placed' | 'unknown'; paidAt: string | null
}
export interface PurchaseGroup {
  id: string; stage?: string; kind: 'purchase' | 'uncreated'; purchase: PurchaseHeader | null
  detailLineCount?: number | null; previewLines?: PurchaseGroupRow['lines']
  orderCount: number | null; skuCount: number | null; quantity: number | null; shippedQuantity: number | null; pendingQuantity: number | null
  shipment: 'pending' | 'partial' | 'shipped' | 'unknown'; earliestReceiptAt: string | null; latestConsumerPaidAt?: string | null; completedAt?: string | null
}
export interface PurchaseGroupRow {
  exception?: { type: string | null; reason?: string | null } | null
  orderId: string; orderNumber: string; shopifyOrderNumber: string; customerName: string; storeName: string; ownerName: string; departmentName: string; warehouse: string; paidAt: string | null; consumerPaidAt?: string | null; completedAt?: string | null
  lines: { fulfillmentLineId: string | null; fulfillmentLineIds?: string[]; skuAggregated?: boolean; purchaseLineId: string | null; sku: string; name: string; imageUrl: string | null; variant: string; quantity: number | null; shippedQuantity: number | null; isVirtual?: boolean | null }[]
}
export const purchaseStageLabels = {
  unknown: ['待核查', 'Unconfirmed'],
  uncreated: ['待建采购订单', 'Purchase not created'],
  dispatch_preparation: ['待制作发运单', 'Dispatch preparation pending'],
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
export interface PurchasePage {
  dataAvailability?: WorkbenchDataAvailability; replica?: WorkbenchReplicaSnapshot
 items: PurchaseGroup[]; total: number; page: number; pageSize: number; refreshedAt: string; source: 'mock' | 'fop'; departments: { id: string; name: string }[]; totals: { groupCount: number | null; purchaseCount: number | null; orderCount: number; uncreatedCount: number | null; pendingQuantity: number | null } }
export interface PurchaseDetails { group: PurchaseGroup; items: PurchaseGroupRow[]; total: number; page: number; pageSize: number }
const base = '/autoflow/integrations/fop/purchase-groups'
export const getPurchaseGroups = (params: PurchaseQuery, signal?: AbortSignal) => api.get<PurchasePage, PurchasePage>(base, { params, ...(signal ? { signal } : {}) })
export const getPurchaseGroupDetails = (id: string, params: PurchaseQuery, signal?: AbortSignal) => api.get<PurchaseDetails, PurchaseDetails>(`${base}/${encodeURIComponent(id)}`, { params, ...(signal ? { signal } : {}) })
export const exportPurchaseGroups = async (body: PurchaseFilters & ({ mode: 'filtered' } | { mode: 'selected'; groupIds: string[] }), signal?: AbortSignal) => {
  try { return await api.post<Blob, Blob>(`${base}/export`, body, { responseType: 'blob', timeout: 30000, signal }) }
  catch (error) {
    if (error instanceof Blob) {
      let parsed: unknown
      try { parsed = JSON.parse(await error.text()) } catch { throw new Error('Export failed') }
      throw parsed
    }
    throw error
  }
}

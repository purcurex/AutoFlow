import type { FopIdentity } from './fop-data.types'
export type PurchaseQueue = 'procurement' | 'procurement_shipping'
export interface PurchaseHeader {
  purchaseType: 'offline' | 'online'; platform: '1688' | 'other' | null
  id: string; number: string; supplier: { id: string; name: string }; platformOrderNumber: string | null
  payment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'unknown'
  placement: 'pending' | 'placed' | 'unknown'; paidAt: string | null
}
export interface PurchaseSourceLine {
  fulfillmentLineId: string; purchaseLineId: string | null; sku: string
  /** Effective quantities in the source fulfillment SKU unit, excluding cancelled/refunded obligations. */
  quantity: number; shippedQuantity: number
}
export interface PurchaseObligation { purchase: PurchaseHeader | null; lines: PurchaseSourceLine[] }
export interface PurchaseLinkSnapshot {
  subject: FopIdentity
  /** One entry for every requested order. null=integration failure (never a business task), []=confirmed no outstanding procurement. */
  orders: { orderId: string; obligations: PurchaseObligation[] | null }[]
}
export const purchaseStages = ['uncreated', 'placement_pending', 'payment_pending', 'refund_pending'] as const
export type PurchaseStage = typeof purchaseStages[number]
export interface PurchaseGroupFilters {
  completed?: boolean; timeRange?: '1w' | '1m' | '3m'

  purchaseStage?: PurchaseStage
  queue: PurchaseQueue; search?: string; departmentId?: string; ownerId?: string; warehouseCode?: string; sortOrder?: 'asc' | 'desc'
}
export interface PurchaseGroupQuery extends PurchaseGroupFilters { page: number; pageSize: number }
export interface PurchaseGroupRow {
  orderId: string; orderNumber: string; shopifyOrderNumber: string; customerName: string; storeName: string
  ownerName: string; departmentName: string; warehouse: string; paidAt: string | null; consumerPaidAt?: string | null; completedAt?: string | null
  lines: (PurchaseSourceLine & { name: string; imageUrl: string | null; variant: string })[]
}
export interface PurchaseGroup {
  id: string; kind: 'purchase' | 'uncreated'; purchase: PurchaseHeader | null
  orderCount: number; skuCount: number; quantity: number | null; shippedQuantity: number | null; pendingQuantity: number | null
  shipment: 'pending' | 'partial' | 'shipped' | 'unknown'; earliestReceiptAt: string | null; latestConsumerPaidAt?: string | null; completedAt?: string | null
  rows: PurchaseGroupRow[]
}

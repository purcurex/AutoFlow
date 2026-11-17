import api from './index'
import type { WorkbenchDataAvailability, WorkbenchReplicaSnapshot } from './workbench-replica'
export interface ReceiptNoticeLine { id: string; sku: string; name: string; variant: string; imageUrl: string | null; quantity: number | null; inboundQuantity: number | null; isVirtual?: boolean | null }
/** All fields belong to the receipt notice: header warehouse, procurement provider supplier, and domestic inbound parcel. */
export interface ReceiptNotice {
  id: string; number: string; noticeNumbers?: string[]; amount?: number | null; currency?: string | null; supplier: string | null; warehouse: string | null; warehouseCode: string | null
  /** FOP logistics tab: hzkj_logistics_company + hzkj_waybill_number; never fulfillment shipping channels. */
  shippedAt: string | null; carrier: string | null; trackingNumber: string | null; status: 'pending' | 'partial' | 'unknown'
  quantity: number | null; inboundQuantity: number | null; pendingQuantity: number | null; lines: ReceiptNoticeLine[]
}
export interface ReceiptNoticeQuery { search?: string; departmentId?: string; ownerId?: string; warehouseCode?: string; status?: 'pending' | 'partial'; page: number; pageSize: number }
export interface ReceiptNoticePage {
  items: ReceiptNotice[]; total: number; page: number; pageSize: number; source: 'mock' | 'fop'; refreshedAt: string
  departments: { id: string; name: string }[]; warehouses: { code: string; name: string }[]
  totals: { quantity: number | null; inboundQuantity: number | null; pendingQuantity: number | null }; dataAvailability?: WorkbenchDataAvailability; replica?: WorkbenchReplicaSnapshot
}
export function getReceiptNotices(params: ReceiptNoticeQuery, signal?: AbortSignal): Promise<ReceiptNoticePage> {
  return api.get('/autoflow/integrations/fop/receipt-notices', { params, signal })
}

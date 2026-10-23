import api from './index'
import type { FopOrderItem } from './fop-orders'
import type { WorkbenchRole } from '@/utils/workbench'

export type ReceiptSource = 'fulfillment' | 'full_payment_stock' | 'deposit_stock'
/** A settled receipt line. Order values are informational, never added back to amount. */
export interface FopReceipt {
  id: string; sourceType: ReceiptSource; documentId: string; documentNumber: string
  customerId: string; customerCode: string; customerName: string
  organization?: { id: string; name: string }; department?: { id: string; name: string }; owner?: { id: string; name: string }
  salesDepartmentCode?: string; warehouseCode: string; warehouse: string
  amount: number; orderAmount: number; handlingFee: number; currency: string; paidAt: string
  reviewStatus: 'pending' | 'approved'; receiptReviewStatus: 'pending' | 'approved'
  paymentStatus: 'paid' | 'unpaid' | 'refunded'; cancelled: boolean; carrierCode: string | null
  items: FopOrderItem[]
}
export interface FopReceiptPage {
  source: 'mock' | 'fop'; timeZone: 'UTC+8'; total: number; page: number; pageSize: number
  totals: { receiptCount: number; currency: 'USD'; amount: number; fulfillmentAmount: number; fullPaymentStockAmount: number; orderAmount: number; handlingFee: number }
  items: FopReceipt[]
}
export interface FopReceiptQuery {
  from: string; to: string; department?: string; ownerId?: string; customerId?: string
  warehouse: 'ALL' | 'HZ' | 'SZ'; sourceType?: 'fulfillment' | 'full_payment_stock'
  workbenchRole: WorkbenchRole; page: number; pageSize: number
}
export const getFopReceipts = (query: FopReceiptQuery): Promise<FopReceiptPage> => api.get('/autoflow/integrations/fop/receipts', { params: query })

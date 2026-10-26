import api from '@/api'
export interface SupplierFollowUp {
  purchaseOrderId: string
  purchaseOrderNumber: string
  platformOrderNumber: string | null
  supplier: { id: string; name: string; wangwangAccount: string | null }
  shipmentStatus: 'pending' | 'partial'
  lines: { fulfillmentLineId: string; purchaseLineId: string; sku: string; name: string; pendingQuantity: number }[]
  availability: 'ready' | 'missing_account' | 'chat_unavailable'
  contactVersion: string
}
export interface SupplierFollowUpPage { source: 'mock' | 'fop'; orderId: string; orderNumber: string; refreshedAt: string; items: SupplierFollowUp[] }
export interface SupplierChatLaunch { source: 'mock' | 'fop'; mode: 'demo' | 'live'; orderId: string; purchaseOrderId: string; wangwangAccount: string; url: string | null }
const path = (orderId: string) => `/autoflow/integrations/fop/fulfillment-orders/${encodeURIComponent(orderId)}/supplier-follow-ups`
export function getSupplierFollowUps(orderId: string): Promise<SupplierFollowUpPage> { return api.get(path(orderId)) }
export function getSupplierChat(orderId: string, purchaseOrderId: string, contactVersion: string): Promise<SupplierChatLaunch> {
  return api.get(`${path(orderId)}/${encodeURIComponent(purchaseOrderId)}/launch`, { params: { contactVersion } })
}

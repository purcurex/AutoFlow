import type { PurchaseFilters } from './procurement-groups'
import api from '@/api'
export interface SupplierFollowUp {
  purchaseOrderId: string
  purchaseOrderNumber: string
  platformOrderNumber: string | null
  supplier: { id: string; name: string; wangwangAccount: string | null }
  shipmentStatus?: 'pending' | 'partial'
  lines: { fulfillmentLineId?: string; stockLineId?: string; purchaseLineId: string; sku: string; name: string; pendingQuantity: number }[]
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

const groupPath = (groupId: string) => `/autoflow/integrations/fop/purchase-groups/${encodeURIComponent(groupId)}/supplier-follow-up`
export function getPurchaseSupplier(groupId: string, params: PurchaseFilters): Promise<SupplierFollowUpPage> { return api.get(groupPath(groupId), { params }) }
export function getPurchaseSupplierChat(groupId: string, params: PurchaseFilters, contactVersion: string): Promise<SupplierChatLaunch> { return api.get(`${groupPath(groupId)}/launch`, { params: { ...params, contactVersion } }) }

const stockPath = (orderId: string) => `/autoflow/integrations/fop/stock-orders/${encodeURIComponent(orderId)}/supplier-follow-ups`
export function getStockSupplierFollowUps(orderId: string): Promise<SupplierFollowUpPage> { return api.get(stockPath(orderId)) }
export function getStockSupplierChat(orderId: string, purchaseOrderId: string, contactVersion: string): Promise<SupplierChatLaunch> {
  return api.get(`${stockPath(orderId)}/${encodeURIComponent(purchaseOrderId)}/launch`, { params: { contactVersion } })
}

export interface ReturnContactContext { returnId: string; workbenchRole: 'procurement' | 'warehouse' }
const returnPath = (id: string) => `/autoflow/integrations/fop/purchase-returns/${encodeURIComponent(id)}/supplier-follow-up`
export function getReturnSupplier(orderId: string, context: ReturnContactContext): Promise<SupplierFollowUpPage> {
  return api.get(returnPath(context.returnId), { params: { orderId, workbenchRole: context.workbenchRole } })
}
export function getReturnSupplierChat(orderId: string, context: ReturnContactContext, contactVersion: string): Promise<SupplierChatLaunch> {
  return api.get(`${returnPath(context.returnId)}/launch`, { params: { orderId, workbenchRole: context.workbenchRole, contactVersion } })
}

import type { BusinessScope } from '../users/business-scope'
import type { FopOrder, FopIdentity } from './fop-data.types'
import type { ApprovalTarget } from './fop-approval.types'

/** Built exclusively on the server from the current account and local organization. */
export interface FopRealtimeScope {
  actorAccountId: string
  actorEmployeeId?: string | null
  business: BusinessScope
  employeeFilter: { employeeIds: readonly string[] | null; version: string }
}
export interface FopRealtimeApprovalContext {
  identity: FopIdentity
  order: Pick<FopOrder, 'id' | 'orderNumber' | 'allocationDocument' | 'dispatchDocuments'>
  inQueue: boolean
  targets: ApprovalTarget[]
  currentScope: FopRealtimeScope
}
export type CurrentInventoryRow = ReturnType<typeof import('./allocation-inventory').inventorySnapshot>[number]
export type ReservedInventoryRow = ReturnType<typeof import('./fop-stock').publicStockInventory>
export interface FopRealtimePage<T = Record<string, unknown>> {
  items: T[]; total: number; page: number; pageSize: number
  asOf: string; source: 'fop'; refreshedAt?: string; customerId?: string | null
}

/** Proposed v1 extension, awaiting FOP publication. Browser input never carries a subject or scope. */
export type FopSupplierContext =
  | { context: 'fulfillment' | 'stock'; orderId: string; queue: 'procurement_shipping' }
  | { context: 'purchase_group'; groupId: string; filters: import('./procurement-groups.dto').PurchaseGroupFiltersDto }
  | { context: 'purchase_return'; returnId: string; orderId: string; workbenchRole: 'procurement' | 'warehouse' }
export interface FopSupplierContact {
  purchaseOrderId: string; purchaseOrderNumber: string; platformOrderNumber: string | null
  supplier: { id: string; name: string; wangwangAccount: string | null }
  shipmentStatus?: 'pending' | 'partial'
  lines: { fulfillmentLineId?: string; stockLineId?: string; purchaseLineId: string; sku: string; name: string; pendingQuantity: number }[]
  availability: 'ready' | 'missing_account' | 'chat_unavailable'; contactVersion: string
}
export interface FopSupplierContacts {
  source: 'fop'; orderId: string; orderNumber: string; refreshedAt: string; items: FopSupplierContact[]
}
export interface FopSupplierLaunch {
  source: 'fop'; mode: 'live'; orderId: string; purchaseOrderId: string; wangwangAccount: string; url: string | null
}
export type FopSupplierLaunchQuery = FopSupplierContext & { purchaseOrderId: string; contactVersion: string }

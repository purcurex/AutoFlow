import type { FopFreightCandidate } from './fop-freight.types'
import type { FopProfitCandidate } from './sales-performance.types'
export const SALES_DEPARTMENTS = [
  { id: 'sales1', name: '业务一部' }, { id: 'sales2', name: '业务二部' },
  { id: 'sales3', name: '业务三部' }, { id: 'sales4', name: '业务四部' },
] as const
export type SalesDepartmentCode = typeof SALES_DEPARTMENTS[number]['id']

export interface FopIdentity { tenantId: string; userId: string }

export interface FopPermissionGrant {
  subject: FopIdentity
  /** Explicit per-subject order allowlist; an empty array grants no order access. */
  allowedOrderIds: readonly string[]
  /** Independent receipt-line authorization; missing/empty grants no collections. */
  allowedReceiptIds?: readonly string[]
  /** Independent actual freight-cost resource grant; never inferred from orders. */
  allowedFreightIds?: readonly string[]
  /** Independent net-profit resource grant; never inherited from orders or receipts. */
  allowedProfitIds?: readonly string[]
  analyticsScopes?: readonly FopAnalyticsScope[]
}

export type FopAnalyticsScope = 'rates' | 'registrations' | 'receipts' | 'freight' | 'sales_profit'
export interface FopRegistrationEntry {
  departmentPathIds?: string[]
  date: string
  salesDepartmentCode: SalesDepartmentCode
  owner: { id: string; name: string }
  count: number
}
export interface FopAnalytics {
  subject: FopIdentity
  rates: { currency: string; cnyPerUnit: number }[]
  registrations: { date: string; count: number }[]
  /** Subject-authorized daily employee counts; authoritative when supplied. */
  registrationEntries?: FopRegistrationEntry[]
}

export interface FopOrderItem {
  productId?: string
  sku: string
  name: string
  imageUrl: string | null
  variant: string
  quantity: number
}

export interface FopOrder {
  departmentPathIds?: string[]
  /** Normalized reporting department supplied by the trusted FOP adapter. */
  salesDepartmentCode?: SalesDepartmentCode
  organization?: { id: string; name: string }
  department?: { id: string; name: string }
  owner?: { id: string; name: string }
  id: string
  orderNumber: string
  shopifyOrderNumber: string
  customerId?: string
  customerCode?: string
  warehouseCode?: string
  carrierCode?: string
  customerName: string
  storeName: string
  items: FopOrderItem[]
  amount: number
  currency: string
  paymentStatus: 'paid' | 'unpaid' | 'refunded'
  reviewStatus: 'pending' | 'approved'
  procurementStatus: 'pending' | 'purchased' | 'not_required'
  allocationStatus: 'pending' | 'allocated' | 'not_ready'
  dispatchStatus: 'pending' | 'dispatched' | 'not_ready'
  shippingStatus: 'pending' | 'shipped' | 'not_ready'
  warehouse: string
  carrier: string | null
  trackingNumber: string | null
  salesperson: string
  createdAt: string
  paidAt: string | null
  cancelled: boolean
  exception: { reason: 'stock' | 'address' | 'tracking'; hours: number } | null
}

/** Provider-only tenant provenance. It is validated and removed before client output. */
export interface FopOrderCandidate extends FopOrder { tenantId: string }

/** One actual settled receipt line, never a header repeated for each source order. */
export interface FopReceipt {
  id: string
  sourceType: 'fulfillment' | 'full_payment_stock' | 'deposit_stock'
  documentId: string
  documentNumber: string
  customerId: string
  customerCode: string
  customerName: string
  organization?: { id: string; name: string }
  department?: { id: string; name: string }
  owner?: { id: string; name: string }
  salesDepartmentCode?: SalesDepartmentCode
  warehouseCode: string
  warehouse: string
  carrierCode: string | null
  amount: number
  orderAmount: number
  handlingFee: number
  currency: string
  paidAt: string | null
  /** Source document approval, separate from receipt approval. */
  reviewStatus: 'pending' | 'approved'
  receiptReviewStatus: 'pending' | 'approved'
  /** paid requires BOTH source-document payment and receipt received-status gates. */
  paymentStatus: 'paid' | 'unpaid' | 'refunded'
  cancelled: boolean
  items: FopOrderItem[]
}
export interface FopReceiptCandidate extends FopReceipt { tenantId: string; departmentPathIds?: string[] }

export const FOP_DATA_PROVIDER = 'FOP_DATA_PROVIDER'

/** No employee identity, permission grant or scope is ever accepted from an HTTP client. */
export abstract class FopDataProvider {
  readonly source: 'mock' | 'fop' = 'fop'
  demoIdentity(_localUserId: string): FopIdentity | null { return null }
  async getAnalytics(identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _range: { from: string; to: string }): Promise<FopAnalytics> {
    return { subject: { ...identity }, rates: [], registrations: [] }
  }
  abstract isConfigured(): boolean
  abstract resolvePermissions(identity: Readonly<FopIdentity>): Promise<FopPermissionGrant>
  abstract listOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>): Promise<FopOrderCandidate[]>
  async listProfits(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>): Promise<FopProfitCandidate[]> {
    throw new Error('Profit contribution provider is not configured')
  }
  async listFreight(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>): Promise<FopFreightCandidate[]> {
    throw new Error('Freight data provider is not configured')
  }
  async listReceipts(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>): Promise<FopReceiptCandidate[]> {
    // Existing adapters cannot silently synthesize collections from order amounts.
    throw new Error('Receipt data provider is not configured')
  }
}

export class FopPermissionDeniedError extends Error {}

export class UnconfiguredFopDataProvider extends FopDataProvider {
  isConfigured() { return false }
  async resolvePermissions(_identity: FopIdentity): Promise<FopPermissionGrant> { throw new Error('FOP data provider is not configured') }
  async listOrders(_identity: FopIdentity, _permission: FopPermissionGrant): Promise<FopOrderCandidate[]> { throw new Error('FOP data provider is not configured') }
}

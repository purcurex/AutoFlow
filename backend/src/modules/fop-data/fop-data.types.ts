import type { ApprovalCommand, ApprovalOutcome, ApprovalQueue, ApprovalTarget } from './fop-approval.types'
import type { SupplierFollowUpResult } from './supplier-follow-up'
import type { FopFreightCandidate } from './fop-freight.types'
import type { FopProfitCandidate } from './sales-performance.types'
export const SALES_DEPARTMENTS = [
  { id: 'sales1', name: '业务一部' }, { id: 'sales2', name: '业务二部' },
  { id: 'sales3', name: '业务三部' }, { id: 'sales4', name: '业务四部' },
] as const
export type SalesDepartmentCode = typeof SALES_DEPARTMENTS[number]['id']

export type FopSummaryChartId = 'registrations' | 'department_receipts' | 'order_volume'
export interface FopOrganizationSummaryGrant {
  chartId: FopSummaryChartId
  departments: readonly { code: SalesDepartmentCode; departmentId: string; departmentPathIds?: readonly string[] }[]
}
export interface FopOrganizationSummaryQuery { chartId: FopSummaryChartId; departments: readonly SalesDepartmentCode[]; from: string; to: string }
/** Aggregates only: no employee, customer, receipt or order identity is permitted. */
export interface FopOrganizationSummaryRow {
  date: string
  salesDepartmentCode: SalesDepartmentCode
  count: number
  warehouseCode?: 'HZ' | 'SZ' | 'UNASSIGNED'
  amount?: number
  currency?: 'USD'
  sourceType?: 'fulfillment' | 'full_payment_stock'
}
export interface FopOrganizationSummary { subject: FopIdentity; chartId: FopSummaryChartId; rows: FopOrganizationSummaryRow[] }
/** Current assignment and historical document attribution are separate facts. */
export interface FopCurrentCustomerOwner { id: string; departmentId: string; departmentPathIds?: readonly string[] }

export interface FopIdentity { tenantId: string; userId: string }

export interface FopPermissionGrant {
  subject: FopIdentity
  /** Explicit per-subject order allowlist; an empty array grants no order access. */
  allowedOrderIds: readonly string[]
  /** Explicit operation grants; read or system-admin access never implies approval. */
  approvalActions?: readonly ApprovalQueue[]
  /** Independent purchase document/contact visibility; absent means no access. */
  allowedPurchaseOrderIds?: readonly string[]
  /** Independent receipt-line authorization; missing/empty grants no collections. */
  allowedReceiptIds?: readonly string[]
  /** Independent actual freight-cost resource grant; never inferred from orders. */
  allowedFreightIds?: readonly string[]
  /** Independent net-profit resource grant; never inherited from orders or receipts. */
  allowedProfitIds?: readonly string[]
  analyticsScopes?: readonly FopAnalyticsScope[]
  /** Independent aggregate grants; never inferred from record allowlists. */
  organizationSummaries?: readonly FopOrganizationSummaryGrant[]
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

/** Independent, normalized FOP facts; unknown must never be inferred as pending. */
export interface FulfillmentProgress {
  /** Effective allocation document exists. Missing/null is unknown, never inferred from order approval. */
  allocationCreated?: boolean | null
  shopifySync: 'pending' | 'partial' | 'synced' | 'not_required' | 'unknown'
  supplierShipment: 'pending' | 'partial' | 'shipped' | 'not_required' | 'unknown'
  stockReadiness: 'incomplete' | 'ready' | 'unknown'
  allocationReview: 'pending' | 'approved' | 'unknown'
  outbound: 'pending' | 'partial' | 'completed' | 'unknown'
}

/** Aggregated over effective linked purchases; independent of customer payment. */
export interface ProcurementProgress {
  purchaseOrder: 'not_ordered' | 'partial' | 'ordered' | 'cancelled' | 'not_required' | 'unknown'
  supplierPayment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'not_required' | 'unknown'
}

/** Effective linked dispatch documents; never inferred from customer payment or Shopify sync. */
export interface DispatchDocument {
  id: string
  number: string
  status: 'draft' | 'submitted' | 'approved' | 'unknown'
}

export interface FopOrder {
  /** null/omitted = unavailable; [] = confirmed no effective dispatch document. */
  dispatchDocuments?: DispatchDocument[] | null
  /** Older adapters may omit this; BFF emits explicit unknown facts, never guesses. */
  procurementProgress?: ProcurementProgress
  fulfillmentProgress: FulfillmentProgress
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
export interface FopOrderCandidate extends FopOrder { tenantId: string; currentCustomerOwner?: FopCurrentCustomerOwner }

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
export interface FopReceiptCandidate extends FopReceipt { tenantId: string; departmentPathIds?: string[]; currentCustomerOwner?: FopCurrentCustomerOwner }

export const FOP_DATA_PROVIDER = 'FOP_DATA_PROVIDER'

/** No employee identity, permission grant or scope is ever accepted from an HTTP client. */
export abstract class FopDataProvider {
  readonly source: 'mock' | 'fop' = 'fop'
  /** New adapters must provide current assignment; legacy attribution requires explicit opt-in. */
  readonly customerOwnershipMode: 'current_required' | 'legacy_historical' = 'current_required'
  demoIdentity(_localUserId: string): FopIdentity | null { return null }
  async getAnalytics(identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _range: { from: string; to: string }): Promise<FopAnalytics> {
    return { subject: { ...identity }, rates: [], registrations: [] }
  }
  async getOrganizationSummary(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _query: Readonly<FopOrganizationSummaryQuery>): Promise<FopOrganizationSummary> {
    throw new FopOrganizationSummaryNotConfiguredError('Organization summary provider is not configured')
  }
  async listSupplierFollowUps(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _orderId: string): Promise<SupplierFollowUpResult> {
    throw new Error('Supplier follow-up provider is not configured')
  }
  abstract isConfigured(): boolean
  async approvalTargets(_identity: Readonly<FopIdentity>, _queue: ApprovalQueue, _orderId: string): Promise<ApprovalTarget[]> { throw new Error('FOP approval adapter is not configured') }
  async approveDocument(_identity: Readonly<FopIdentity>, _command: ApprovalCommand): Promise<ApprovalOutcome> { throw new Error('FOP approval adapter is not configured') }
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
export class FopOrganizationSummaryNotConfiguredError extends Error {}

export class UnconfiguredFopDataProvider extends FopDataProvider {
  isConfigured() { return false }
  async resolvePermissions(_identity: FopIdentity): Promise<FopPermissionGrant> { throw new Error('FOP data provider is not configured') }
  async listOrders(_identity: FopIdentity, _permission: FopPermissionGrant): Promise<FopOrderCandidate[]> { throw new Error('FOP data provider is not configured') }
}

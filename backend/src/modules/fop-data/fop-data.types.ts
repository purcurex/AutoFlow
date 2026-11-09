import type { AllocationInventoryQueryDto } from './allocation-inventory.dto'
import type { AllocationInventoryPage } from './allocation-inventory'
import type { PurchaseLinkSnapshot } from './procurement-groups.types'
import type { AllocationInventoryScope, AllocationInventorySnapshot } from './allocation-inventory'
import type { ApprovalCommand, ApprovalOutcome, ApprovalQueue, ApprovalTarget } from './fop-approval.types'
import type { SupplierFollowUpResult } from './supplier-follow-up'
import type { FopFreightCandidate } from './fop-freight.types'
import type { BusinessScope } from '../users/business-scope'
import type { FopBindingEmployeePage, VerifiedFopEmployeeBinding } from './fop-employee-binding'
import type { FopProfitCandidate } from './sales-performance.types'
import type { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
export const FOP_EXCEPTION_TYPES = ['procurement_exception', 'dispatch_exception', 'allocation_exception', 'logistics_exception', 'delivery_exception', 'stock_exception', 'address_exception'] as const
export type FopExceptionType = typeof FOP_EXCEPTION_TYPES[number]
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

/** 管理员连接预览只返回已认证身份、当前公司和资源类别，不返回任何认证凭据。 */
export interface FopConnectionContext {
  subject: FopIdentity
  username: string | null
  currentOrganization: { id: string; name: string }
  resources: FopAnalyticsResource[]
}

export interface FopPermissionGrant {
  subject: FopIdentity
  /** Explicit per-subject order allowlist; an empty array grants no order access. */
  allowedOrderIds: readonly string[]
  /** Independent stock document and current-customer inventory grants; missing means no access. */
  allowedStockOrderIds?: readonly string[]
  allowedStockInventoryIds?: readonly string[]
  /** 独立员工备货接口的组织授权，不能由履约订单权限或空逐单白名单推导。 */
  stockQuery?: { orders: readonly string[]; inventory: readonly string[] }
  allocationInventoryScopes?: readonly AllocationInventoryScope[]
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
  /** 真实分页模式只授权声明的队列；不把空 allowlist 解释成全部数据。 */
  orderQuery?: { queues: readonly ('unpaid' | 'review' | 'dispatch')[]; organizationIds: readonly string[] }
  /** 各统计资源的独立组织授权；仅真实查询适配器使用，不扩大订单/收款/成本权限。 */
  analyticsQuery?: Partial<Record<FopAnalyticsResource, readonly string[]>>
  /** Independent aggregate grants; never inferred from record allowlists. */
  organizationSummaries?: readonly FopOrganizationSummaryGrant[]
}

export type FopAnalyticsScope = 'rates' | 'registrations' | 'receipts' | 'freight' | 'sales_profit'
export interface FopRegistrationEntry {
  /** 注册事实的直属部门，用于经理精确鉴权，不能仅凭祖先链推断归属。 */
  department?: { id: string; name: string }
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

export type FopAnalyticsResource = 'orders' | 'receipts' | 'registrations' | 'freight'
export interface FopAnalyticsRange { from: string; to: string; keyword?: string }
export interface FopRegistrationFact {
  departmentPathIds?: string[]
  id: string; registeredAt: string; organization: { id: string; name: string }
  department: { id: string; name: string }; owner: { id: string; name: string }
  salesDepartmentCode: SalesDepartmentCode
}
export interface FopAnalyticsData {
  orders: FopOrderCandidate[]; receipts: FopReceiptCandidate[]; freight: FopFreightCandidate[]; registrations: FopRegistrationFact[]
}

export interface FopOrderItem {
  id?: string
  parentId?: string
  rowType?: number
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
  shopifySync: 'pending' | 'synced' | 'not_required' | 'unknown'
  supplierShipment: 'pending' | 'partial' | 'shipped' | 'not_required' | 'unknown'
  stockReadiness: 'incomplete' | 'ready' | 'unknown'
  allocationReview: 'pending' | 'approved' | 'unknown'
  outbound: 'pending' | 'partial' | 'completed' | 'unknown'
}

/** Aggregated over effective linked purchases; independent of customer payment. */
export interface ProcurementProgress {
  /** 金蝶待采购清单按有效分录确认的当前待办，历史数据继续使用原进度字段。 */
  pendingStage?: 'application_pending' | 'purchase_order_pending' | 'alibaba_pending' | 'placement_pending' | 'refund_pending' | 'payment_pending' | 'unknown'
  /** Optional preparation facts; known unfinished pushes stay in procurement. Logistics never gates visibility. */
  purchaseApplication?: 'not_created' | 'partial' | 'created' | 'not_required' | 'unknown'
  alibabaOrder?: 'not_pushed' | 'partial' | 'pushed' | 'not_required' | 'unknown'
  /** FOP logistics-only validation for outstanding actual 1688 pushes. */
  logisticsGate?: 'pending_dispatch' | 'pending_logistics' | 'satisfied' | 'not_required' | 'unknown'
  purchaseOrder: 'not_ordered' | 'partial' | 'ordered' | 'cancelled' | 'not_required' | 'unknown'
  supplierPayment: 'unpaid' | 'partial' | 'paid' | 'refunded' | 'not_required' | 'unknown'
}

/** Effective linked dispatch documents; never inferred from customer payment or Shopify sync. */
export interface DispatchDocument {
  id: string
  number: string
  status: 'draft' | 'submitted' | 'approved' | 'unknown'
}

/** Shipping recipient on this fulfillment order, never the customer account profile. */
export interface ShippingRecipient {
  name: string | null
  phone: string | null
  email: string | null
  state: string | null
  city: string | null
  postalCode: string | null
  addressLine1: string | null
  addressLine2: string | null
}

export interface LogisticsChannel { name: string | null; code: string | null }

export interface LogisticsTrackingNumber { type: 'full' | 'first_mile' | 'last_mile'; number: string }
export interface LogisticsInfo {
  carrierName: string | null
  /** Explicit FOP selection for Shopify; never chosen from raw candidate numbers by this app. */
  shopifyTracking?: LogisticsTrackingNumber | null
  /** @deprecated Legacy candidates do not prove which number is selected. */
  trackingNumbers?: LogisticsTrackingNumber[]
}

export interface AllocationDocumentReference { id: string; number: string }

/** 配货来源只读诊断；不代表可审核、可出库的业务状态，无法确认时不猜测订单SKU。 */
export interface AllocationQueryIssue {
  code: 'ALLOCATION_SKU_MISMATCH' | 'ALLOCATION_SOURCE_UNRESOLVED'
  allocationId: string
  allocationNumber: string
  /** SKU差异时为已解析行内码；来源无法确认时保留配货单原引用（可能为空或旧序号）。 */
  sourceEntryId: string
  allocationSku: string
  orderSku: string | null
}

export interface FopOrder {
  /** 仅适配器和BFF内部使用；异常订单从正常清单与合计剔除，另行输出提示。 */
  allocationIssues?: AllocationQueryIssue[]
  /** 服务端按未完成期望包裹聚合，避免缺包裹被已有发运单掩盖。 */
  dispatchTaskStatus?: 'dispatch_missing' | 'dispatch_draft' | 'dispatch_submitted' | 'dispatch_approved' | 'dispatch_synced' | 'unknown'
  /** Unique effective FOP allocation for this order; null/omitted = unavailable or not yet created. */
  allocationDocument?: AllocationDocumentReference | null
  allocationDocuments?: (AllocationDocumentReference & { packageNo: string; readyAt: string | null; wmsCreatedAt: string | null; dispatchComplete: boolean; outboundCompletedAt?: string | null })[]
  dispatchDocumentsComplete?: boolean
  /** Shopify-selected tracking grouped by shipment/carrier; raw legacy fields do not prove selection. */
  logisticsInfo?: LogisticsInfo[] | null
  /** FOP-maintained English custom channel name, independent of UI language; never actual channels or carriers. */
  customLogisticsChannelName?: string | null
  /** Actual fulfillment channels, never carrier categories or customer-facing custom channels. */
  logisticsChannels?: LogisticsChannel[] | null
  /** 待支付清单取履约订单源单付款时间，区别于FOP创建时间和收款日期；未知为null。 */
  /** Actual phase completion timestamps supplied by the trusted gateway; no fallbacks. */
  shopifySyncedAt?: string | null
  /** 已履约清单取当前有效发运单的最大审核时间，不代表Shopify同步完成时间。 */
  dispatchApprovedAt?: string | null
  procurementCompletedAt?: string | null
  allocationApprovedAt?: string | null
  outboundCompletedAt?: string | null
  reviewedAt?: string | null
  consumerPaidAt?: string | null
  /** Earliest actual payment among effective paid purchase obligations still awaiting supplier shipment. */
  procurementPaidAt?: string | null
  /** Current existing allocation completion time; cleared when allocation becomes incomplete. */
  allocationReadyAt?: string | null
  /** Successful delivery-notice push to WMS; distinct from order creation. Missing = null. */
  wmsCreatedAt?: string | null
  shippingRecipient?: ShippingRecipient | null
  /** Order delivery destination ISO alpha2, not customer profile country; null/omitted when unavailable. */
  shippingCountryCode?: string | null
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
  /** Independent stored FOP amounts; never reconstruct the authoritative total. */
  amountBreakdown?: FopOrderAmountBreakdown | null
  currency: string
  paymentStatus: 'paid' | 'unpaid' | 'refunded'
  reviewStatus: 'pending' | 'approved'
  procurementStatus: 'pending' | 'purchased' | 'not_required' | 'unknown'
  allocationStatus: 'pending' | 'allocated' | 'not_ready' | 'unknown'
  dispatchStatus: 'pending' | 'dispatched' | 'not_ready' | 'unknown'
  shippingStatus: 'pending' | 'shipped' | 'not_ready' | 'unknown'
  warehouse: string
  carrier: string | null
  trackingNumber: string | null
  salesperson: string
  createdAt: string
  paidAt: string | null
  cancelled: boolean
  exception: { type: FopExceptionType | null; types?: FopExceptionType[]; affectedSkus?: string[]; reason: string | null; hours: number | null } | null
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

export interface FopOrderPageQuery {
  queue: string; search?: string; orderNumber?: string; page: number; pageSize: number
  /** 仅 dispatch 支持完成清单；省略时保留原待履约语义。 */
  completed?: boolean
  timeRange?: 'all' | '1w' | '1m' | '3m'; departmentId?: string; ownerId?: string; warehouseCode?: 'HZ' | 'SZ'
  sortBy?: string; sortOrder?: 'asc' | 'desc'; paidAtOrder?: 'asc' | 'desc'
  taskStatus?: string; orderIds?: readonly string[]; exportManifest?: boolean
}
export interface FopOrderPage {
  departments?: { id: string; name: string }[]
  salespeople?: { id: string; name: string }[]
  orderIds?: string[]
  source: 'fop'
  items: FopOrder[]
  total: number
  page: number
  pageSize: number
  totals: { orderCount: number; itemQuantity: number; amountsByCurrency: { currency: string; amount: number }[] }
}

export interface FopWorkbenchOrders {
  orders: FopOrder[]
  links: PurchaseLinkSnapshot['orders']
  purchaseIds: string[]
  departments: { id: string; name: string }[]
}

/** No employee identity, permission grant or scope is ever accepted from an HTTP client. */
export abstract class FopDataProvider {
  readonly source: 'mock' | 'fop' = 'fop'
  readonly pagedOrders: boolean = false
  /** 新Java原始事实模式由后端显式启用，工作台最终计算在AutoFlow执行。 */
  readonly workbenchFacts: boolean = false
  async readWorkbenchOrders(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope: Readonly<BusinessScope>, _query: FopOrderPageQuery): Promise<FopWorkbenchOrders> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  readonly queriedStock: boolean = false
  readonly supportsEmployeeBinding: boolean = false
  /** 管理员专用目录及验证入口；未接通的适配器不能伪造真实员工绑定。 */
  async listBindingEmployees(_cursor?: string, _scopeVersion?: string): Promise<FopBindingEmployeePage> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  async verifyEmployeeBinding(_employeeId: string, _membershipId: string): Promise<VerifiedFopEmployeeBinding> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  async getConnectionContext(): Promise<FopConnectionContext> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  /** 真实统计按资源/日期分页读取，仅在Nest服务端汇总，不向浏览器暴露全量事实。 */
  async readAnalytics(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope: Readonly<BusinessScope>, _resource: FopAnalyticsResource, _range: FopAnalyticsRange): Promise<FopAnalyticsData> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
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
  /** 已在金蝶验证租户、组织、订单及关联单据权限的待采购授权快照。 */
  async readPendingProcurement(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope: Readonly<BusinessScope>, _warehouseCode?: string, _queue: 'procurement' | 'procurement_shipping' = 'procurement'): Promise<{ orders: FopOrder[]; snapshot: PurchaseLinkSnapshot; purchaseIds: string[] }> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  /** 配货/仓库按包裹阶段读取完整授权快照，供列表、导出和库存选择复用。 */
  async readAllocationOrders(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope: Readonly<BusinessScope>, _queue: 'allocation' | 'allocation_review' | 'shipping', _completed = false, _timeRange?: '1w' | '1m' | '3m'): Promise<FopOrder[]> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  async getPurchaseLinks(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _orderIds: readonly string[]): Promise<PurchaseLinkSnapshot> { throw new Error('Purchase linkage provider is not configured') }
  abstract isConfigured(): boolean
  async approvalTargets(_identity: Readonly<FopIdentity>, _queue: ApprovalQueue, _orderId: string, _scope?: Readonly<BusinessScope>): Promise<ApprovalTarget[]> { throw new Error('FOP approval adapter is not configured') }
  async approveDocument(_identity: Readonly<FopIdentity>, _command: ApprovalCommand, _scope?: Readonly<BusinessScope>): Promise<ApprovalOutcome> { throw new Error('FOP approval adapter is not configured') }
  abstract resolvePermissions(identity: Readonly<FopIdentity>, scope?: Readonly<BusinessScope>): Promise<FopPermissionGrant>
  /** 备货授权独立解析，配置或发布失败仅影响备货入口。 */
  async resolveStockPermissions(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    return this.resolvePermissions(identity, scope)
  }
  /** 默认适配器继续走完整数组契约；真实查询明确使用有权限的服务端分页能力。 */
  async queryOrders(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope: Readonly<BusinessScope>, _query: FopOrderPageQuery, _summaryOnly = false): Promise<FopOrderPage> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  async queryAllocationInventory(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope: Readonly<BusinessScope>, _query: AllocationInventoryQueryDto): Promise<AllocationInventoryPage> {
    throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }
  async getAllocationInventory(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scopes: readonly AllocationInventoryScope[]): Promise<AllocationInventorySnapshot & { subject: FopIdentity }> { throw new Error('Allocation inventory provider is not configured') }
  abstract listOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>): Promise<FopOrderCandidate[]>
  async listStockOrders(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope?: Readonly<BusinessScope>): Promise<FopStockOrderCandidate[]> { throw new Error('Stock orders provider is not configured') }
  async listStockInventory(_identity: Readonly<FopIdentity>, _permission: Readonly<FopPermissionGrant>, _scope?: Readonly<BusinessScope>): Promise<FopStockInventoryCandidate[]> { throw new Error('Stock inventory provider is not configured') }
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

export class FopPermissionDeniedError extends Error {
  constructor(message = 'FOP access denied', readonly code: 'fop_permission_denied' | 'fop_authentication_expired' | 'fop_binding_required' | 'fop_employee_unavailable' | 'fop_proxy_user_required' | 'fop_api_not_authorized' = 'fop_permission_denied') { super(message) }
}
export class FopIntegrationUnavailableError extends Error {
  constructor(readonly code: 'fop_feature_not_configured' | 'fop_endpoint_not_published' | 'fop_mapping_required' | 'fop_fx_missing' | 'fop_result_too_large') { super(code) }
}
export class FopOrganizationSummaryNotConfiguredError extends Error {}

export class UnconfiguredFopDataProvider extends FopDataProvider {
  isConfigured() { return false }
  async resolvePermissions(_identity: FopIdentity): Promise<FopPermissionGrant> { throw new Error('FOP data provider is not configured') }
  async listOrders(_identity: FopIdentity, _permission: FopPermissionGrant): Promise<FopOrderCandidate[]> { throw new Error('FOP data provider is not configured') }
}

export interface FopOrderAmountBreakdown {
  productAmount: number | null
  shippingFee: number | null
  /** FOP hzkj_fixed_tax_fee; optional for older gateways. */
  taxAmount?: number | null
  discountAmount: number | null
}

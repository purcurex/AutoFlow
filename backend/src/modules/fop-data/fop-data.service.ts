import { inventoryTargets, inventorySnapshot } from './allocation-inventory'
import { AllocationInventoryQueryDto } from './allocation-inventory.dto'
import { normalizeLogisticsInfo } from './logistics-info'
import { publicStockOrder, publicStockInventory, stockScopeMatches, stockDepartments, filterStockOrders, stockTotals } from './fop-stock'
import { StockFilters, StockPageQuery, StockInventoryQuery } from './fop-stock.types'
import { ExportStockOrdersDto, StockScopeDto } from './fop-stock.dto'
import { buildStockWorkbook } from './fop-stock-export'
import { normalizeConsumerPaidAt } from './consumer-payment-time'
import { normalizeBusinessTimestamp } from './fop-business-time'
import { normalizeCustomLogisticsChannelName, normalizeLogisticsChannels } from './logistics-channels'
import { normalizeShippingCountry } from './shipping-country'
import { canFilterTaskStatus, getTaskStatus } from './workbench-status'
import { canFilterProcurementStage, getProcurementStage } from './procurement-stage'
import type { ApprovalQueue } from './fop-approval.types'
import { supplierFollowUps } from './supplier-follow-up'
import { CHART_IDS, ChartId, ChartSummaryPolicy, EffectiveChartAccess, resolveChartAccess, resolveChartSummaryPolicy } from '../users/chart-permissions'
import { summaryOrderVolume, summaryReceipts, summaryRegistrations } from './fop-organization-summary'
import { FopCurrentCustomerOwner, FopOrganizationSummaryGrant, FopOrganizationSummaryNotConfiguredError, FopOrganizationSummaryQuery, FopOrganizationSummaryRow, SALES_DEPARTMENTS } from './fop-data.types'
import { orderVolumePeriods } from './order-volume'
import { aggregateSalesPerformance, performanceDetails, performancePeriods, effectiveProfits } from './sales-performance'
import type { FopProfit, PerformanceData, PerformanceDetailsQuery, PerformanceOwner, PerformancePage, PerformanceQuery } from './sales-performance.types'
import { aggregateFreight, freightDetails, freightPeriods, publicFreight } from './fop-freight'
import type { FopFreight, FreightQuery, FreightDetailsQuery } from './fop-freight.types'
import { BadRequestException, ConflictException, NotFoundException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { isWorkbenchRole, WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { FULFILLMENT_QUEUE_ROLES, ExportFulfillmentOrdersDto, FulfillmentOrderFiltersDto, ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'
import { buildFulfillmentWorkbook } from './fop-order-export'
import { FopDashboardQueryDto } from './fop-data.dto'
import { FOP_DATA_PROVIDER, FopDataProvider, FopIdentity, FopOrder, FopOrderCandidate, FopPermissionDeniedError, FopPermissionGrant, FopReceipt } from './fop-data.types'

import { businessScope, matchesBusinessScope, BusinessScope } from '../users/business-scope'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from './order-volume.dto'
import { aggregateOrderVolume, orderVolumeDetails, orderVolumeReceiptDetails, searchOrderCustomers } from './order-volume'
import { aggregateRegistrations } from './fop-registration'
import { summarizeFopOrders } from './fop-order-totals'
import { canSortFulfillmentQueue, compareFulfillmentOrders, comparePaymentTime, paymentTime } from './fop-order-sort'

import { eligibleReceipts, monthlyReceipts, publicReceipt, summarizeReceipts } from './fop-receipts'
import { businessDate, BUSINESS_TIME_ZONE, validBusinessDay } from './fop-business-time'
import { ReceiptQueryDto } from './fop-receipts.dto'

type Queue = keyof typeof FULFILLMENT_QUEUE_ROLES
type Scope = { binding: FopIdentity | null; roles: WorkbenchRole[]; business: BusinessScope; charts: EffectiveChartAccess[]; summaryPolicies: Record<ChartId, ChartSummaryPolicy>; customerAttribution?: { current: number; historical: number; assignments: Map<string, string> } }
type ChartContext = { initial: Scope; permission: FopPermissionGrant; access: EffectiveChartAccess; chartId: ChartId }

function matchesQueue(order: FopOrder, queue: Queue, warehouseStage?: ListFulfillmentOrdersDto['warehouseStage']): boolean {
  if (order.cancelled) return false
  if (queue === 'unpaid') return order.paymentStatus === 'unpaid'
  if (order.paymentStatus !== 'paid') return false
  if (queue === 'review') return order.reviewStatus === 'pending'
  if (queue === 'exceptions') return order.shippingStatus !== 'shipped' && order.exception !== null
  const progress = order.fulfillmentProgress
  if (!progress) return false
  // Only reviewed fulfillment orders can await Shopify tracking/fulfillment sync.
  if (queue === 'dispatch') return order.reviewStatus === 'approved' && progress.shopifySync === 'pending'
  if (queue === 'procurement' || queue === 'procurement_shipping') {
    const purchase = order.procurementProgress
    if (!purchase) return false
    const pendingPush = purchase.alibabaOrder === 'not_pushed' || purchase.alibabaOrder === 'partial'
    if (queue === 'procurement_shipping') return !pendingPush && purchase.purchaseOrder === 'ordered' && purchase.supplierPayment === 'paid'
      && (progress.supplierShipment === 'pending' || progress.supplierShipment === 'partial')
    // Remaining unplaced demand is not fully paid; unknown facts are not unpaid facts.
    return purchase.purchaseOrder === 'not_ordered' || purchase.purchaseOrder === 'partial'
      || purchase.purchaseOrder === 'ordered' && (pendingPush || ['unpaid', 'partial', 'refunded'].includes(purchase.supplierPayment))
  }
  if (order.reviewStatus !== 'approved' || progress.allocationCreated !== true) return false
  switch (queue) {
    case 'allocation': return progress.stockReadiness === 'incomplete' && progress.allocationReview === 'pending' && progress.outbound !== 'completed'
    case 'allocation_review': return progress.stockReadiness === 'ready' && progress.allocationReview === 'pending' && progress.outbound !== 'completed'
    // Pending allocation approval belongs only to allocation; legacy pending_review queries stay empty.
    case 'shipping': return warehouseStage !== 'pending_review' && progress.stockReadiness === 'ready'
      && progress.allocationReview === 'approved' && (progress.outbound === 'pending' || progress.outbound === 'partial')
  }
}

function sameIdentity(left: FopIdentity | null | undefined, right: FopIdentity | null | undefined): boolean {
  return !!left && !!right && left.tenantId === right.tenantId && left.userId === right.userId
}

function orderDepartments(orders: FopOrder[]): { id: string; name: string }[] {
  const options = new Map<string, { id: string; name: string; rank: number }>()
  for (const order of orders) {
    if (!order.department?.id) continue
    const rank = SALES_DEPARTMENTS.findIndex(d => d.id === order.salesDepartmentCode)
    // The trusted adapter maps these codes only to Marketing Center's direct sales departments.
    if (rank < 0 || order.department.name !== SALES_DEPARTMENTS[rank].name) continue
    options.set(order.department.id, { ...order.department, rank })
  }
  return [...options.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
    .map(({ id, name }) => ({ id, name }))
}

// Only the reviewed client contract is serialized, never arbitrary provider metadata.
/** Allowlist order-level recipient details only after order scope has been checked. */
function publicRecipient(value: FopOrderCandidate['shippingRecipient']): FopOrderCandidate['shippingRecipient'] {
  if (!value || typeof value !== 'object') return null
  const clean = (field: unknown) => typeof field === 'string' ? field.trim() || null : null
  const recipient = { name: clean(value.name), phone: clean(value.phone), email: clean(value.email),
    state: clean(value.state), city: clean(value.city), postalCode: clean(value.postalCode),
    addressLine1: clean(value.addressLine1), addressLine2: clean(value.addressLine2) }
  return Object.values(recipient).some(Boolean) ? recipient : null
}

function publicOrder(order: FopOrderCandidate): FopOrder {
  if (order.reviewStatus === 'approved' && (!['HZ', 'SZ'].includes(order.warehouseCode ?? '') || !['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER'].includes(order.carrierCode ?? ''))) {
    throw new Error('Approved fulfillment requires mapped warehouse and logistics channel')
  }
  const progress = order.fulfillmentProgress
  const values = {
    shopifySync: ['pending', 'synced', 'not_required', 'unknown'],
    supplierShipment: ['pending', 'partial', 'shipped', 'not_required', 'unknown'],
    stockReadiness: ['incomplete', 'ready', 'unknown'],
    allocationReview: ['pending', 'approved', 'unknown'],
    outbound: ['pending', 'partial', 'completed', 'unknown'],
  }
  if (!progress || Object.entries(values).some(([key, allowed]) => !allowed.includes(progress[key as keyof typeof values]))) {
    throw new Error('Missing or invalid fulfillment progress')
  }
  if (progress.allocationCreated != null && typeof progress.allocationCreated !== 'boolean') throw new Error('Invalid allocation document fact')
  const procurement = order.procurementProgress
  const procurementFacts = {
    purchaseApplication: ['not_created', 'partial', 'created', 'not_required', 'unknown'],
    alibabaOrder: ['not_pushed', 'partial', 'pushed', 'not_required', 'unknown'],
    logisticsGate: ['pending_dispatch', 'pending_logistics', 'satisfied', 'not_required', 'unknown'],
  }
  if (procurement && Object.entries(procurementFacts).some(([key, allowed]) => {
    const value = procurement[key as keyof typeof procurementFacts]
    return value !== undefined && !allowed.includes(value)
  })) throw new Error('Invalid procurement preparation fact')
  if (procurement !== undefined && (!procurement
    || !['not_ordered', 'partial', 'ordered', 'cancelled', 'not_required', 'unknown'].includes(procurement.purchaseOrder)
    || !['unpaid', 'partial', 'paid', 'refunded', 'not_required', 'unknown'].includes(procurement.supplierPayment))) {
    throw new Error('Invalid procurement progress')
  }
  const documents = order.dispatchDocuments
  const allocation = order.allocationDocument
  if (allocation != null && (typeof allocation !== 'object' || Array.isArray(allocation)
    || typeof allocation.id !== 'string' || !allocation.id.trim() || allocation.id.length > 500
    || typeof allocation.number !== 'string' || !allocation.number.trim() || allocation.number.length > 500)) throw new Error('Invalid allocation document')
  if (documents != null && (!Array.isArray(documents) || documents.some(document => !document
    || typeof document.id !== 'string' || !document.id.trim()
    || typeof document.number !== 'string' || !document.number.trim()
    || !['draft', 'submitted', 'approved', 'unknown'].includes(document.status))
    || new Set(documents.map(document => document.id)).size !== documents.length)) {
    throw new Error('Invalid dispatch documents')
  }
  return {
    allocationDocument: allocation ? { id: allocation.id, number: allocation.number } : null,
    dispatchDocuments: documents?.map(({ id, number, status }) => ({ id, number, status })) ?? null,
    procurementProgress: { purchaseOrder: procurement?.purchaseOrder ?? 'unknown', supplierPayment: procurement?.supplierPayment ?? 'unknown',
      purchaseApplication: procurement?.purchaseApplication ?? 'unknown', alibabaOrder: procurement?.alibabaOrder ?? 'unknown', logisticsGate: procurement?.logisticsGate ?? 'unknown' },
    ...(order.salesDepartmentCode ? { salesDepartmentCode: order.salesDepartmentCode } : {}),
    fulfillmentProgress: { allocationCreated: progress.allocationCreated ?? null, shopifySync: progress.shopifySync, supplierShipment: progress.supplierShipment, stockReadiness: progress.stockReadiness, allocationReview: progress.allocationReview, outbound: progress.outbound },
    id: order.id, orderNumber: order.orderNumber, shopifyOrderNumber: order.shopifyOrderNumber,
    customerId: order.customerId, customerCode: order.customerCode, warehouseCode: order.warehouseCode, carrierCode: order.carrierCode,
    reviewedAt: order.reviewStatus === 'approved' ? normalizeBusinessTimestamp(order.reviewedAt) : null,
    consumerPaidAt: normalizeConsumerPaidAt(order.consumerPaidAt),
    procurementPaidAt: normalizeBusinessTimestamp(order.procurementPaidAt),
    wmsCreatedAt: normalizeBusinessTimestamp(order.wmsCreatedAt),
    allocationReadyAt: progress.allocationCreated === true && progress.stockReadiness === 'ready' ? normalizeBusinessTimestamp(order.allocationReadyAt) : null,
    logisticsChannels: normalizeLogisticsChannels(order.logisticsChannels),
    logisticsInfo: normalizeLogisticsInfo(order.logisticsInfo),
    customLogisticsChannelName: normalizeCustomLogisticsChannelName(order.customLogisticsChannelName),
    shippingCountryCode: normalizeShippingCountry(order.shippingCountryCode),
    shippingRecipient: publicRecipient(order.shippingRecipient),
    customerName: order.customerName, storeName: order.storeName,
    items: order.items.map(({ sku, name, imageUrl, variant, quantity, productId }) => ({ sku, name, imageUrl, variant, quantity, ...(productId ? { productId } : {}) })),
    ...(order.organization ? { organization: { id: order.organization.id, name: order.organization.name } } : {}),
    ...(order.department ? { department: { id: order.department.id, name: order.department.name } } : {}),
    ...(order.owner ? { owner: { id: order.owner.id, name: order.owner.name } } : {}),
    amount: order.amount, currency: order.currency?.trim().toUpperCase() || 'USD', paymentStatus: order.paymentStatus,
    reviewStatus: order.reviewStatus, procurementStatus: order.procurementStatus,
    allocationStatus: order.allocationStatus, dispatchStatus: order.dispatchStatus, shippingStatus: order.shippingStatus,
    warehouse: order.warehouse, carrier: order.carrier, trackingNumber: order.trackingNumber,
    salesperson: order.salesperson, createdAt: order.createdAt, paidAt: order.paidAt && Number.isFinite(Date.parse(order.paidAt)) ? order.paidAt : null, cancelled: order.cancelled,
    exception: order.exception ? { reason: order.exception.reason, hours: order.exception.hours } : null,
  }
}

@Injectable()
export class FopDataService {
  constructor(
    private readonly users: UsersService,
    @Inject(FOP_DATA_PROVIDER) private readonly provider: FopDataProvider,
  ) {}

  private async scope(userId: string): Promise<Scope> {
    const user = await this.users.findById(userId)
    if (!user) throw new UnauthorizedException('Account no longer exists')
    return {
      business: businessScope(user),
      charts: resolveChartAccess(user),
      summaryPolicies: Object.fromEntries(CHART_IDS.map(chartId => [chartId, resolveChartSummaryPolicy(user, chartId)])) as Record<ChartId, ChartSummaryPolicy>,
      binding: this.provider.demoIdentity?.(userId) ?? (user.fopTenantId && user.fopUserId ? { tenantId: user.fopTenantId, userId: user.fopUserId } : null),
      roles: businessScope(user).role === 'none' ? [] : businessScope(user).role === 'admin' ? [...WORKBENCH_ROLES] : (user.workbenchRoles ?? []).filter(isWorkbenchRole),
    }
  }

  private async assertUnchanged(userId: string, initial: Scope): Promise<void> {
    const current = await this.scope(userId)
    if (JSON.stringify(current.charts) !== JSON.stringify(initial.charts) || JSON.stringify(current.summaryPolicies) !== JSON.stringify(initial.summaryPolicies)
      || JSON.stringify(current.business) !== JSON.stringify(initial.business)
      || !sameIdentity(current.binding, initial.binding)
      || [...current.roles].sort().join(',') !== [...initial.roles].sort().join(',')) {
      throw new ForbiddenException({ code: 'fop_binding_changed', message: 'FOP binding or workbench access changed; reload before continuing' })
    }
  }

  private async permissions(userId: string, initial: Scope): Promise<FopPermissionGrant> {
    if (initial.business.role === 'none') throw new ForbiddenException({ code: 'business_access_disabled', message: 'Business data access is disabled for this account' })
    if (!initial.binding) throw new ForbiddenException({ code: 'fop_binding_required', message: 'Bind this employee account to an FOP user first' })
    if (!await this.providerCall(async () => this.provider.isConfigured())) throw new ServiceUnavailableException({ code: 'fop_not_configured', message: 'FOP data integration is not configured' })
    if ((initial.business.role === 'department_manager' && !initial.business.departmentId) || (initial.business.role === 'salesperson' && !initial.business.employeeId)) throw new ForbiddenException({ code: 'business_scope_required', message: 'Configure this account department or employee data scope first' })
    const identity = Object.freeze({ ...initial.binding })
    const grant = await this.providerCall(() => this.provider.resolvePermissions(identity))
    await this.assertUnchanged(userId, initial)
    if (!sameIdentity(grant?.subject, identity) || !Array.isArray(grant?.allowedOrderIds)
      || grant.allowedOrderIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP permissions do not authorize this account identity' })
    }
    if (grant.allowedPurchaseOrderIds !== undefined && (!Array.isArray(grant.allowedPurchaseOrderIds) || grant.allowedPurchaseOrderIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException('Invalid FOP purchase permissions')
    }
    for (const ids of [grant.allowedStockOrderIds, grant.allowedStockInventoryIds]) {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()))) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP stock permissions' })
    }
    if (grant.allowedReceiptIds !== undefined && (!Array.isArray(grant.allowedReceiptIds) || grant.allowedReceiptIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP receipt permissions' })
    }
    if (grant.allowedFreightIds !== undefined && (!Array.isArray(grant.allowedFreightIds) || grant.allowedFreightIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP freight permissions' })
    }
    if (grant.allowedProfitIds !== undefined && (!Array.isArray(grant.allowedProfitIds) || grant.allowedProfitIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP profit permissions' })
    }
    if (grant.analyticsScopes !== undefined && (!Array.isArray(grant.analyticsScopes) || grant.analyticsScopes.some(scope => !['rates', 'registrations', 'receipts', 'freight', 'sales_profit'].includes(scope)))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP analytics permissions' })
    }
    if (grant.approvalActions !== undefined && (!Array.isArray(grant.approvalActions) || grant.approvalActions.some(action => !['review', 'allocation_review'].includes(action)))) throw new ForbiddenException('Invalid FOP operation permissions')
    const summaries = grant.organizationSummaries ?? []
    if (!Array.isArray(summaries) || new Set(summaries.map((s: FopOrganizationSummaryGrant) => s?.chartId)).size !== summaries.length || summaries.some((s: FopOrganizationSummaryGrant) => !s || !['registrations', 'department_receipts', 'order_volume'].includes(s.chartId) || !Array.isArray(s.departments) || new Set(s.departments.map((d: FopOrganizationSummaryGrant['departments'][number]) => d?.code)).size !== s.departments.length || s.departments.some((d: FopOrganizationSummaryGrant['departments'][number]) => !d || !SALES_DEPARTMENTS.some(item => item.id === d.code) || typeof d.departmentId !== 'string' || !d.departmentId.trim() || d.departmentPathIds !== undefined && (!Array.isArray(d.departmentPathIds) || d.departmentPathIds.some((id: unknown) => typeof id !== 'string' || !id.trim()) || new Set(d.departmentPathIds).size !== d.departmentPathIds.length)))) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid organization summary grant' })
    return { allocationInventoryScopes: grant.allocationInventoryScopes === undefined ? undefined : structuredClone(grant.allocationInventoryScopes), allowedStockOrderIds: [...new Set(grant.allowedStockOrderIds ?? [])], allowedStockInventoryIds: [...new Set(grant.allowedStockInventoryIds ?? [])], approvalActions: [...new Set(grant.approvalActions ?? [])], organizationSummaries: summaries.map((s: FopOrganizationSummaryGrant) => ({ chartId: s.chartId, departments: s.departments.map((d: FopOrganizationSummaryGrant['departments'][number]) => ({ code: d.code, departmentId: d.departmentId, ...(d.departmentPathIds ? { departmentPathIds: [...d.departmentPathIds] } : {}) })) })), subject: { ...identity }, allowedOrderIds: [...new Set(grant.allowedOrderIds)], allowedPurchaseOrderIds: [...new Set(grant.allowedPurchaseOrderIds ?? [])], allowedReceiptIds: [...new Set(grant.allowedReceiptIds ?? [])], allowedFreightIds: [...new Set(grant.allowedFreightIds ?? [])], allowedProfitIds: [...new Set(grant.allowedProfitIds ?? [])], analyticsScopes: [...new Set(grant.analyticsScopes ?? [])] }
  }

  private effectiveCharts(initial: Scope, permission: FopPermissionGrant): EffectiveChartAccess[] {
    return initial.charts.map(local => {
      if (!initial.roles.length || local.chartId === 'sales_performance' && !initial.roles.includes('sales')) return { ...local, visible: false, dataScope: 'none', scopeLabel: '尚未分配工作台岗位', summaryDepartments: [], summaryOnly: false, canViewDetails: false, canExport: false }
      const policy = initial.summaryPolicies[local.chartId]
      const granted = permission.organizationSummaries?.find(g => g.chartId === local.chartId)?.departments ?? []
      const summaryDepartments = !local.visible ? [] : granted.filter(d => policy.mode === 'marketing'
        || policy.mode === 'selected' && policy.departments.includes(d.code)
        || policy.mode === 'department' && !!initial.business.departmentId && (d.departmentId === initial.business.departmentId || d.departmentPathIds?.includes(initial.business.departmentId))).map(d => d.code)
      const resourceEnabled = local.chartId === 'registrations' ? permission.analyticsScopes?.includes('registrations')
        : local.chartId === 'salesperson_receipts' ? permission.analyticsScopes?.includes('receipts')
          : local.chartId === 'freight' ? permission.analyticsScopes?.includes('freight')
            : local.chartId === 'sales_performance' ? permission.analyticsScopes?.includes('receipts') && permission.analyticsScopes?.includes('sales_profit')
              : local.chartId !== 'department_receipts'
      const dataScope = local.visible && resourceEnabled ? local.dataScope : 'none'
      const visible = local.visible && (dataScope !== 'none' || summaryDepartments.length > 0)
      const summaryOnly = visible && dataScope === 'none'
      return { ...local, visible, dataScope, summaryDepartments, summaryOnly,
        scopeLabel: !visible ? '暂不可查看' : summaryOnly ? `${summaryDepartments.map(code => SALES_DEPARTMENTS.find(d => d.id === code)!.name).join('、')}汇总` : summaryDepartments.length ? `业务范围：${local.scopeLabel}；汇总部门：${summaryDepartments.map(code => SALES_DEPARTMENTS.find(d => d.id === code)!.name).join('、')}` : local.scopeLabel,
        canViewDetails: visible && !summaryOnly && local.canViewDetails,
        canExport: visible && local.canExport }
    })
  }

  async getChartAccess(userId: string) {
    const initial = await this.scope(userId)
    if (initial.business.role === 'none') return { source: this.provider.source ?? 'fop', businessScope: initial.business, charts: initial.charts }
    const permission = await this.permissions(userId, initial)
    return { source: this.provider.source ?? 'fop', businessScope: initial.business, charts: this.effectiveCharts(initial, permission) }
  }

  private async chartContext(userId: string, chartId: ChartId, details = false, requiredRole?: WorkbenchRole): Promise<ChartContext> {
    const initial = await this.scope(userId)
    if (!initial.charts.find(c => c.chartId === chartId)?.visible || (requiredRole && !initial.roles.includes(requiredRole))) throw new ForbiddenException({ code: 'chart_access_denied', message: 'Chart access denied' })
    const permission = await this.permissions(userId, initial)
    const access = this.effectiveCharts(initial, permission).find(c => c.chartId === chartId)!
    if (!access.visible || details && !access.canViewDetails) throw new ForbiddenException({ code: 'chart_access_denied', message: 'Chart or detail access denied' })
    if (chartId === 'customer_orders') initial.customerAttribution = { current: 0, historical: 0, assignments: new Map() }
    return { initial, permission, access, chartId }
  }

  private matchesChart(context: ChartContext, record: { owner?: { id: string }; department?: { id: string }; departmentPathIds?: readonly string[] }): boolean {
    if (!matchesBusinessScope(context.initial.business, record)) return false
    switch (context.access.dataScope) {
      case 'all': return true
      case 'self': return !!context.initial.business.employeeId && record.owner?.id === context.initial.business.employeeId
      case 'department': return !!context.initial.business.departmentId && (record.department?.id === context.initial.business.departmentId || !!record.departmentPathIds?.includes(context.initial.business.departmentId))
      default: return false
    }
  }

  private matchesCustomer(context: ChartContext | undefined, row: { customerId?: string; currentCustomerOwner?: FopCurrentCustomerOwner }): boolean {
    if (context?.chartId !== 'customer_orders') return true
    const state = context.initial.customerAttribution!
    const owner = row.currentCustomerOwner
    if (!owner) {
      if (this.provider.customerOwnershipMode === 'current_required') throw new Error('Current customer assignment is required by this adapter')
      state.historical++; return true
    }
    if (typeof owner.id !== 'string' || !owner.id.trim() || typeof owner.departmentId !== 'string' || !owner.departmentId.trim()) throw new Error('Invalid current customer assignment')
    this.validateAncestry(owner.departmentPathIds)
    const key = JSON.stringify([owner.id, owner.departmentId, [...(owner.departmentPathIds ?? [])].sort()])
    if (row.customerId && state.assignments.has(row.customerId) && state.assignments.get(row.customerId) !== key) throw new Error('Conflicting current customer assignments')
    if (row.customerId) state.assignments.set(row.customerId, key)
    if (!this.matchesChart(context, { owner, department: { id: owner.departmentId }, departmentPathIds: owner.departmentPathIds })) return false
    state.current++
    return true
  }

  private customerBasis(context: ChartContext): 'current_assignment' | 'historical_attribution' | 'mixed' {
    const state = context.initial.customerAttribution!
    return state.historical ? state.current ? 'mixed' : 'historical_attribution' : 'current_assignment'
  }

  private async organizationSummary(userId: string, context: ChartContext, query: FopOrganizationSummaryQuery): Promise<FopOrganizationSummaryRow[]> {
    const departments = context.access.summaryDepartments.filter(code => query.departments.includes(code))
    if (!departments.length) throw new ForbiddenException({ code: 'chart_summary_denied', message: 'Organization summary access denied' })
    const identity = Object.freeze({ ...context.permission.subject })
    // The provider receives aggregate grants only, with no detail allowlist to expand.
    const permission = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([] as string[]), organizationSummaries: Object.freeze((context.permission.organizationSummaries ?? []).filter(g => g.chartId === context.chartId).map(g => Object.freeze({ chartId: g.chartId, departments: Object.freeze(g.departments.filter(d => departments.includes(d.code)).map(d => Object.freeze({ ...d, departmentPathIds: Object.freeze([...(d.departmentPathIds ?? [])]) }))) }))) })
    const result = await this.providerCall(() => this.provider.getOrganizationSummary(identity, permission, Object.freeze({ ...query, departments: Object.freeze([...departments]) })))
    await this.assertUnchanged(userId, context.initial)
    if (!sameIdentity(result?.subject, identity) || result?.chartId !== query.chartId) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Organization summary subject mismatch' })
    return this.providerCall(async () => {
      if (!Array.isArray(result.rows)) throw new Error('Invalid organization summary response')
      const seen = new Set<string>()
      return result.rows.filter(row => row && departments.includes(row.salesDepartmentCode)).map(row => {
        if (!validBusinessDay(row.date) || row.date < query.from || row.date > query.to || !Number.isSafeInteger(row.count) || row.count < 0
          || query.chartId === 'department_receipts' && (row.currency !== 'USD' || !Number.isFinite(row.amount) || row.amount! < 0 || !['fulfillment', 'full_payment_stock'].includes(row.sourceType ?? ''))
          || query.chartId === 'order_volume' && !['HZ', 'SZ', 'UNASSIGNED'].includes(row.warehouseCode ?? '')) throw new Error('Invalid summary metric')
        const key = JSON.stringify([row.date, row.salesDepartmentCode, query.chartId === 'order_volume' ? row.warehouseCode : undefined, query.chartId === 'department_receipts' ? row.sourceType : undefined])
        if (seen.has(key)) throw new Error('Duplicate summary metric')
        seen.add(key)
        return { date: row.date, salesDepartmentCode: row.salesDepartmentCode, count: row.count,
          ...(query.chartId === 'order_volume' ? { warehouseCode: row.warehouseCode } : {}),
          ...(query.chartId === 'department_receipts' ? { amount: row.amount, currency: 'USD' as const, sourceType: row.sourceType } : {}) }
      })
    })
  }

  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof FopOrganizationSummaryNotConfiguredError) throw new ServiceUnavailableException({ code: 'fop_summary_not_configured', message: 'FOP organization summary integration is not configured' })
      if (error instanceof FopPermissionDeniedError) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP denied access to this employee account' })
      // Even framework exceptions from adapters may contain private upstream diagnostics.
      throw new ServiceUnavailableException({ code: 'fop_unavailable', message: 'FOP data access is unavailable' })
    }
  }

  async requireResourcePermission(userId: string): Promise<never> {
    const current = await this.scope(userId)
    if (!current.binding) throw new ForbiddenException({ code: 'fop_binding_required', message: 'Bind this employee account to an FOP user first' })
    if (!await this.providerCall(async () => this.provider.isConfigured())) throw new ServiceUnavailableException({ code: 'fop_not_configured', message: 'FOP data integration is not configured' })
    // Product-cost and catalog permissions need their own upstream resource contract.
    // An order allowlist (including an administrator's) cannot grant these capabilities.
    throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP resource permissions are not configured for this operation' })
  }

  async getDataAccess(userId: string) {
    const initial = await this.scope(userId)
    if (initial.business.role === 'none') return { binding: initial.binding, businessScope: initial.business, status: 'denied' }
    if (!initial.binding) return { binding: null, status: 'unbound' }
    try {
      await this.permissions(userId, initial)
      return { binding: initial.binding, businessScope: initial.business, status: 'ready', source: this.provider.source ?? 'fop', mode: this.provider.source === 'mock' ? 'demo' : 'live' }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      const current = await this.scope(userId)
      if (!current.binding) return { binding: null, status: 'unbound' }
      const response = error instanceof ServiceUnavailableException ? error.getResponse() : null
      const code = response && typeof response === 'object' && 'code' in response ? response.code : undefined
      return {
        binding: current.binding, businessScope: current.business,
        status: error instanceof ForbiddenException ? 'denied' : code === 'fop_not_configured' ? 'not_configured' : 'unavailable',
      }
    }
  }

  private async scopedOrders(userId: string, requiredRole?: WorkbenchRole, context?: ChartContext): Promise<{ orders: FopOrder[]; departmentPaths: Map<string, readonly string[]>; roles: WorkbenchRole[]; permission: FopPermissionGrant; initial: Scope }> {
    const initial = context?.initial ?? await this.scope(userId)
    if (requiredRole ? !initial.roles.includes(requiredRole) : initial.roles.length === 0) {
      throw new ForbiddenException('Workbench access denied')
    }
    const permission = context?.permission ?? await this.permissions(userId, initial)
    const allowedIds = new Set(permission.allowedOrderIds)
    const departmentPaths = new Map<string, readonly string[]>()
    if (!allowedIds.size) return { orders: [], departmentPaths, roles: initial.roles, permission, initial }
    const identity = Object.freeze({ ...permission.subject })
    const grant = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([...permission.allowedOrderIds]) })
    const candidates = await this.providerCall(() => this.provider.listOrders(identity, grant))
    await this.assertUnchanged(userId, initial)
    return this.providerCall(async () => {
      if (!Array.isArray(candidates)) throw new Error('Invalid FOP order response')
      const seen = new Set<string>()
      const orders = candidates.filter((candidate) => {
        if (!candidate || candidate.tenantId !== identity.tenantId || !allowedIds.has(candidate.id) || seen.has(candidate.id) || !matchesBusinessScope(initial.business, candidate)) return false
        this.validateAncestry(candidate.departmentPathIds)
        if (context && !this.matchesChart(context, candidate) || !this.matchesCustomer(context, candidate)) return false
        seen.add(candidate.id)
        departmentPaths.set(candidate.id, [...(candidate.departmentPathIds ?? [])])
        return true
      }).map(publicOrder)
      const allocationOwners = new Set<string>()
      for (const order of orders) {
        if (!order.allocationDocument) continue
        if (allocationOwners.has(order.allocationDocument.id)) throw new Error('Allocation document belongs to multiple orders')
        allocationOwners.add(order.allocationDocument.id)
      }
      return { orders, departmentPaths, roles: initial.roles, permission, initial }
    })
  }

  async approvalContext(userId: string, queue: ApprovalQueue, orderId: string, sessionVersion = 0) {
    const scoped = await this.scopedOrders(userId, queue === 'review' ? 'sales' : 'allocation')
    const account = await this.users.findById(userId)
    if (!account || account.accountDisabled || (account.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Account disabled or session expired')
    if (!scoped.permission.approvalActions?.includes(queue)) throw new ForbiddenException('当前 FOP 账号无此审核操作权限')
    const order = scoped.orders.find(row => row.id === orderId)
    if (!order) throw new NotFoundException('订单不存在或无权访问')
    return { identity: { ...scoped.permission.subject }, order, inQueue: matchesQueue(order, queue) }
  }

  private async scopedReceipts(userId: string, scoped: { permission: FopPermissionGrant; initial: Scope }, context?: ChartContext): Promise<FopReceipt[]> {
    if (!scoped.permission.analyticsScopes?.includes('receipts')) return []
    const allowed = new Set(scoped.permission.allowedReceiptIds ?? [])
    if (!allowed.size) return []
    const identity = Object.freeze({ ...scoped.permission.subject })
    const grant = Object.freeze({ ...scoped.permission, subject: identity, allowedOrderIds: Object.freeze([...scoped.permission.allowedOrderIds]), allowedReceiptIds: Object.freeze([...allowed]), allowedProfitIds: Object.freeze([...(scoped.permission.allowedProfitIds ?? [])]), allowedFreightIds: Object.freeze([...(scoped.permission.allowedFreightIds ?? [])]), analyticsScopes: Object.freeze([...(scoped.permission.analyticsScopes ?? [])]) })
    const candidates = await this.providerCall(() => this.provider.listReceipts(identity, grant))
    await this.assertUnchanged(userId, scoped.initial)
    return this.providerCall(async () => {
      if (!Array.isArray(candidates)) throw new Error('Invalid FOP receipt response')
      const seen = new Set<string>()
      return candidates.filter(candidate => {
        if (!candidate || candidate.tenantId !== identity.tenantId || !allowed.has(candidate.id)) return false
        this.validateAncestry(candidate.departmentPathIds)
        if (!matchesBusinessScope(scoped.initial.business, candidate) || context && !this.matchesChart(context, candidate) || !this.matchesCustomer(context, candidate)) return false
        if (seen.has(candidate.id)) throw new Error('Duplicate authorized receipt ID')
        seen.add(candidate.id)
        return true
      }).map(publicReceipt)
    })
  }

  private async scopedFreight(userId: string, requiredRole?: WorkbenchRole, details = false): Promise<{ records: FopFreight[]; initial: Scope; access: EffectiveChartAccess }> {
    const context = await this.chartContext(userId, 'freight', details, requiredRole)
    const { initial, permission } = context
    if (requiredRole ? !initial.roles.includes(requiredRole) : !initial.roles.length) throw new ForbiddenException('Workbench access denied')
    if (!permission.analyticsScopes?.includes('freight')) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Freight cost access denied' })
    const allowed = new Set(permission.allowedFreightIds ?? [])
    if (!allowed.size) return { records: [], initial, access: context.access }
    const identity = Object.freeze({ ...permission.subject })
    const grant = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([...permission.allowedOrderIds]), allowedFreightIds: Object.freeze([...allowed]), analyticsScopes: Object.freeze([...(permission.analyticsScopes ?? [])]) })
    const candidates = await this.providerCall(() => this.provider.listFreight(identity, grant))
    await this.assertUnchanged(userId, initial)
    const records = await this.providerCall(async () => {
      if (!Array.isArray(candidates)) throw new Error('Invalid FOP freight response')
      const seen = new Set<string>()
      return candidates.filter(candidate => {
        if (!candidate || candidate.tenantId !== identity.tenantId || !allowed.has(candidate.id)) return false
        if (candidate.departmentPathIds !== undefined && (!Array.isArray(candidate.departmentPathIds) || candidate.departmentPathIds.some(id => typeof id !== 'string' || !id.trim()))) throw new Error('Invalid freight department ancestry')
        if (!this.matchesChart(context, candidate)) return false
        if (seen.has(candidate.id)) throw new Error('Duplicate authorized freight ID')
        seen.add(candidate.id)
        return true
      }).map(publicFreight)
    })
    return { records, initial, access: context.access }
  }

  private validateAncestry(path: unknown): void {
    if (path !== undefined && (!Array.isArray(path) || path.some(id => typeof id !== 'string' || !id.trim()) || new Set(path).size !== path.length)) throw new Error('Invalid resource department ancestry')
  }

  private async scopedPerformance(userId: string, now: Date, details = false) {
    const context = await this.chartContext(userId, 'sales_performance', details, 'sales')
    const { initial, permission } = context
    if (!initial.roles.includes('sales')) throw new ForbiddenException('Sales workbench access denied')
    if (!permission.analyticsScopes?.includes('receipts') || !permission.analyticsScopes.includes('sales_profit')) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Independent receipt and sales profit access is required' })
    // Receipt authorization is independent of order enumeration and order access.
    const receipts = await this.scopedReceipts(userId, { permission, initial }, context)
    const allowed = new Set(permission.allowedProfitIds ?? [])
    let profits: FopProfit[] = []
    if (allowed.size) {
      const identity = Object.freeze({ ...permission.subject })
      const grant = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([...permission.allowedOrderIds]), allowedProfitIds: Object.freeze([...allowed]), analyticsScopes: Object.freeze([...(permission.analyticsScopes ?? [])]) })
      const candidates = await this.providerCall(() => this.provider.listProfits(identity, grant))
      await this.assertUnchanged(userId, initial)
      profits = await this.providerCall(async () => {
        if (!Array.isArray(candidates)) throw new Error('Invalid profit response')
        const seen = new Set<string>()
        return effectiveProfits(candidates.filter(candidate => {
          if (!candidate || candidate.tenantId !== identity.tenantId || !allowed.has(candidate.id)) return false
          this.validateAncestry(candidate.departmentPathIds)
          if (!this.matchesChart(context, candidate)) return false
          if (seen.has(candidate.id)) throw new Error('Duplicate authorized profit ID')
          seen.add(candidate.id)
          return true
        }), now)
      })
    }
    await this.assertUnchanged(userId, initial)
    return { receipts, profits, initial, access: context.access }
  }

  private performanceOwner(scoped: { receipts: FopReceipt[]; profits: FopProfit[]; initial: Scope }, query: PerformanceQuery, now: Date) {
    const canSelectOwner = ['admin', 'department_manager'].includes(scoped.initial.business.role) && scoped.initial.charts.find(c => c.chartId === 'sales_performance')?.dataScope !== 'self'
    const byId = new Map<string, PerformanceOwner>()
    const knownProfits = scoped.profits.filter(row => Date.parse(row.knownAt) <= now.getTime() && (!row.approvedAt || Date.parse(row.approvedAt) <= now.getTime())
      && (row.recognitionDate ? row.recognitionDate <= businessDate(now) : row.recognitionMonth <= businessDate(now).slice(0, 7)))
    for (const row of [...eligibleReceipts(scoped.receipts, now), ...knownProfits]) {
      if (row.owner && row.department) byId.set(row.owner.id, { id: row.owner.id, name: row.owner.name, department: { id: row.department.id, name: row.department.name } })
    }
    const owners = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
    const boundId = scoped.initial.business.employeeId
    if (query.ownerId !== undefined && (canSelectOwner ? !byId.has(query.ownerId) : query.ownerId !== boundId)) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Salesperson is outside the authorized scope' })
    const ownerId = canSelectOwner ? query.ownerId ?? (boundId && byId.has(boundId) ? boundId : undefined) : boundId ?? undefined
    return { canSelectOwner, owners, selectedOwner: ownerId ? byId.get(ownerId) ?? null : null, ownerId,
      receipts: scoped.receipts.filter(row => row.owner?.id === ownerId), profits: scoped.profits.filter(row => row.owner.id === ownerId) }
  }

  async getSalesPerformance(userId: string, query: PerformanceQuery): Promise<PerformanceData> {
    const now = new Date()
    performancePeriods(query, now)
    const scoped = await this.scopedPerformance(userId, now)
    const selected = this.performanceOwner(scoped, query, now)
    const result = await this.providerCall(async () => aggregateSalesPerformance(selected.receipts, selected.profits, { ...query, ...(selected.ownerId ? { ownerId: selected.ownerId } : {}) }, now))
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: scoped.access, ...result, owners: selected.owners, selectedOwner: selected.selectedOwner, canSelectOwner: selected.canSelectOwner }
  }

  async getSalesPerformanceDetails(userId: string, query: PerformanceDetailsQuery): Promise<PerformancePage> {
    const now = new Date()
    performanceDetails([], [], query, now)
    const scoped = await this.scopedPerformance(userId, now, true)
    const selected = this.performanceOwner(scoped, query, now)
    const result = await this.providerCall(async () => performanceDetails(selected.receipts, selected.profits, query, now))
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: scoped.access, ...result }
  }

  async getFreight(userId: string, query: FreightQuery) {
    const now = new Date()
    freightPeriods(query, now)
    const { records, initial, access } = await this.scopedFreight(userId)
    const result = await this.providerCall(async () => aggregateFreight(records, query, now))
    await this.assertUnchanged(userId, initial)
    return { source: this.provider.source ?? 'fop', chartAccess: access, ...result }
  }

  async getFreightDetails(userId: string, query: FreightDetailsQuery) {
    const now = new Date()
    // Validate period IDs before data fetch; malformed user filters are HTTP 400.
    freightDetails([], query, now)
    const { records, initial, access } = await this.scopedFreight(userId, query.workbenchRole, true)
    const result = await this.providerCall(async () => freightDetails(records, query, now))
    await this.assertUnchanged(userId, initial)
    return { source: this.provider.source ?? 'fop', chartAccess: access, ...result }
  }

  private receiptPage(rows: FopReceipt[], query: { page: number; pageSize: number }) {
    const usd = rows.filter(row => row.currency === 'USD').sort((a, b) => Date.parse(b.paidAt!) - Date.parse(a.paidAt!) || a.id.localeCompare(b.id))
    return { source: this.provider.source ?? 'fop', timeZone: BUSINESS_TIME_ZONE, total: usd.length, totals: summarizeReceipts(usd), page: query.page, pageSize: query.pageSize, items: usd.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
  }

  async getReceipts(userId: string, query: ReceiptQueryDto) {
    if (query.chartId && query.chartId !== 'salesperson_receipts') throw new ForbiddenException({ code: 'chart_access_denied', message: 'Organization summaries do not grant receipt details' })
    if (!validBusinessDay(query.from) || !validBusinessDay(query.to) || query.from < '2020-01-01' || query.from > query.to || query.to > businessDate(new Date())) throw new BadRequestException('Invalid receipt date range')
    const context = await this.chartContext(userId, 'salesperson_receipts', true, query.workbenchRole)
    const records = await this.scopedReceipts(userId, context, context)
    const rows = eligibleReceipts(records).filter(r => businessDate(r.paidAt!) >= query.from && businessDate(r.paidAt!) <= query.to
      && (!query.department || r.salesDepartmentCode === query.department) && (!query.ownerId || r.owner?.id === query.ownerId)
      && (!query.customerId || r.customerId === query.customerId) && (query.warehouse === 'ALL' || r.warehouseCode === query.warehouse)
      && (!query.sourceType || r.sourceType === query.sourceType))
    await this.assertUnchanged(userId, context.initial)
    return { ...this.receiptPage(rows, query), chartAccess: context.access }
  }

  async getOrderVolumeReceipts(userId: string, query: OrderVolumeDetailsDto) {
    if (query.category !== 'customer') throw new BadRequestException('Receipt cohort requires customer category')
    if (query.view === 'summary') throw new ForbiddenException({ code: 'chart_access_denied', message: 'Organization summaries do not grant receipt details' })
    const context = await this.chartContext(userId, 'customer_orders', true, query.workbenchRole)
    const scoped = await this.scopedOrders(userId, query.workbenchRole, context)
    if (!scoped.permission.analyticsScopes?.includes('receipts')) throw new ForbiddenException('Receipt access denied')
    const receipts = await this.scopedReceipts(userId, scoped, context)
    const rows = orderVolumeReceiptDetails(scoped.orders, receipts, query)
    await this.assertUnchanged(userId, scoped.initial)
    return { ...this.receiptPage(rows, query), chartAccess: context.access, customerOwnershipBasis: this.customerBasis(context) }
  }

  private async supplierContacts(userId: string, orderId: string) {
    const scoped = await this.scopedOrders(userId, 'procurement')
    const order = scoped.orders.find(row => row.id === orderId)
    if (!order) throw new NotFoundException('Order not found')
    if (!matchesQueue(order, 'procurement_shipping')) throw new ConflictException({ code: 'purchase_queue_changed', message: '该订单已不在已采购待发货清单，请刷新列表。' })
    const identity = Object.freeze({ ...scoped.permission.subject })
    const permission = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([orderId]), allowedPurchaseOrderIds: Object.freeze([...(scoped.permission.allowedPurchaseOrderIds ?? [])]) })
    const result = permission.allowedPurchaseOrderIds.length
      ? await this.providerCall(() => this.provider.listSupplierFollowUps(identity, permission, orderId))
      : { subject: identity, orderId, items: [] }
    const contacts = await this.providerCall(async () => supplierFollowUps(result, identity, permission, orderId))
    // Re-read scope and grants after the upstream request: revocation must not leak contacts.
    const current = await this.scopedOrders(userId, 'procurement')
    await this.assertUnchanged(userId, scoped.initial)
    if (!current.orders.some(row => row.id === orderId && matchesQueue(row, 'procurement_shipping'))) throw new ConflictException({ code: 'purchase_queue_changed', message: '订单状态或可见范围已变化，请刷新列表。' })
    const permitted = new Set(current.permission.allowedPurchaseOrderIds ?? [])
    return { order, contacts: contacts.filter(row => permitted.has(row.purchaseOrderId)) }
  }

  async getSupplierFollowUps(userId: string, orderId: string) {
    const { order, contacts } = await this.supplierContacts(userId, orderId)
    return { source: this.provider.source ?? 'fop', orderId, orderNumber: order.orderNumber, refreshedAt: new Date().toISOString(), items: contacts.map(({ url: _url, ...item }) => item) }
  }

  async getSupplierChat(userId: string, orderId: string, purchaseOrderId: string, contactVersion: string) {
    const { contacts } = await this.supplierContacts(userId, orderId)
    const contact = contacts.find(row => row.purchaseOrderId === purchaseOrderId)
    if (!contact) throw new NotFoundException('Purchase not found')
    if (contact.contactVersion !== contactVersion) throw new ConflictException({ code: 'supplier_contact_changed', message: '采购单或供应商信息已变化，请刷新后重新选择。' })
    if (!contact.url || contact.availability !== 'ready') throw new ConflictException({ code: 'supplier_chat_unavailable', message: '供应商旺旺信息不完整，请在 FOP 核对。' })
    return { source: this.provider.source ?? 'fop', mode: this.provider.source === 'mock' ? 'demo' : 'live', orderId, purchaseOrderId, wangwangAccount: contact.supplier.wangwangAccount, url: this.provider.source === 'mock' ? null : contact.url }
  }

  private async filteredOrders(userId: string, query: FulfillmentOrderFiltersDto) {
    if (!Object.prototype.hasOwnProperty.call(FULFILLMENT_QUEUE_ROLES, query.queue)) throw new BadRequestException('Invalid fulfillment queue')
    if (query.sortBy && !canSortFulfillmentQueue(query.queue, query.sortBy)) throw new BadRequestException('sortBy does not match the requested queue')
    if (query.warehouseStage !== undefined && query.queue !== 'shipping') throw new BadRequestException('warehouseStage requires the shipping queue')
    if (query.taskStatus !== undefined && !canFilterTaskStatus(query.queue, query.taskStatus)) throw new BadRequestException('taskStatus does not match the requested queue')
    if (query.procurementStage !== undefined && !canFilterProcurementStage(query.queue, query.procurementStage)) throw new BadRequestException('procurementStage does not match the requested queue')
    const role = FULFILLMENT_QUEUE_ROLES[query.queue]
    if (query.workbenchRole && query.workbenchRole !== role) throw new BadRequestException('workbenchRole does not match the requested queue')
    const scoped = await this.scopedOrders(userId, role)
    const { orders, departmentPaths } = scoped
    // Derive filter options from the same permitted records, never the administrator's organization directory.
    const departments = orderDepartments(orders)
    const departmentOrders = orders.filter(order => !query.departmentId || order.department?.id === query.departmentId || departmentPaths.get(order.id)?.includes(query.departmentId))
    // Owner IDs are filters, never identity or permission grants. Options share the
    // authorized department scope and stay stable across queue/search/page changes.
    const salespeople = [...new Map(departmentOrders.filter(order => order.owner?.id).map(order => [order.owner!.id, order.owner!])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
    const search = query.search?.trim().toLowerCase()
    const filtered = departmentOrders.filter((order) => matchesQueue(order, query.queue, query.warehouseStage)
      && (!query.taskStatus || getTaskStatus(order, query.queue) === query.taskStatus)
      && (!query.procurementStage || getProcurementStage(order.procurementProgress, order.fulfillmentProgress.supplierShipment) === query.procurementStage)
      && (!query.warehouseCode || order.warehouseCode === query.warehouseCode)
      && (!query.ownerId || order.owner?.id === query.ownerId)
      && (!query.orderNumber || order.orderNumber === query.orderNumber)
      && (!search || [order.orderNumber, order.shopifyOrderNumber, order.customerName, order.storeName, order.owner?.name || order.salesperson,
        ...(query.queue === 'unpaid' ? [order.customLogisticsChannelName ?? ''] : [order.carrier ?? '', order.carrierCode ?? '']), ...order.items.map((item) => item.sku)]
        .some((value) => value.toLowerCase().includes(search))))
      .sort((left, right) => compareFulfillmentOrders(left, right, query))
    return { filtered, departments, salespeople, authorizedOrderIds: new Set(orders.map(order => order.id)), initial: scoped.initial }
  }

  async getOrders(userId: string, query: ListFulfillmentOrdersDto) {
    const { filtered, departments, salespeople } = await this.filteredOrders(userId, query)
    const start = (query.page - 1) * query.pageSize
    return { source: this.provider.source ?? 'fop', refreshedAt: new Date().toISOString(), departments, salespeople, items: filtered.slice(start, start + query.pageSize), total: filtered.length, totals: summarizeFopOrders(filtered), page: query.page, pageSize: query.pageSize }
  }

  private async stockContext(userId: string, role: 'sales' | 'procurement' | 'inventory' = 'sales') {
    const initial = await this.scope(userId)
    if (!(role === 'inventory' ? initial.roles.some(r => r === 'sales' || r === 'procurement') : initial.roles.includes(role))) throw new ForbiddenException('Stock workbench access required')
    return { initial, permission: await this.permissions(userId, initial) }
  }

  private async scopedStockOrders(userId: string, role: 'sales' | 'procurement' | 'inventory' = 'sales') {
    const context = await this.stockContext(userId, role)
    const allowed = new Set(context.permission.allowedStockOrderIds ?? [])
    const rows = allowed.size ? await this.providerCall(() => this.provider.listStockOrders(context.permission.subject, context.permission)) : []
    await this.assertUnchanged(userId, context.initial)
    const orders = await this.providerCall(async () => {
      if (!Array.isArray(rows)) throw new Error('Invalid stock response')
      const seen = new Set<string>()
      return rows.filter(row => {
        if (!row || row.tenantId !== context.permission.subject.tenantId || !allowed.has(row.id) || !matchesBusinessScope(context.initial.business, row)) return false
        publicStockOrder(row)
        if (seen.has(row.id)) throw new Error('Duplicate stock document')
        seen.add(row.id)
        return !row.cancelled
      })
    })
    return { ...context, orders }
  }

  private async scopedStockInventory(userId: string) {
    const context = await this.stockContext(userId, 'inventory')
    const allowed = new Set(context.permission.allowedStockInventoryIds ?? [])
    const rows = allowed.size ? await this.providerCall(() => this.provider.listStockInventory(context.permission.subject, context.permission)) : []
    await this.assertUnchanged(userId, context.initial)
    const inventory = await this.providerCall(async () => {
      if (!Array.isArray(rows)) throw new Error('Invalid inventory response')
      const ids = new Set<string>(), groups = new Set<string>()
      return rows.filter(row => {
        if (!row || row.tenantId !== context.permission.subject.tenantId || !allowed.has(row.id) || !matchesBusinessScope(context.initial.business, row)) return false
        publicStockInventory(row)
        const group = JSON.stringify([row.customerId, row.sku, row.warehouseCode])
        if (ids.has(row.id) || groups.has(group)) throw new Error('Duplicate inventory snapshot')
        ids.add(row.id); groups.add(group)
        return true
      })
    })
    return { ...context, inventory }
  }

  async getAllocationInventory(userId: string, query: AllocationInventoryQueryDto) {
    if (query.mode === 'selected' ? !query.orderIds?.length || !!query.search : query.mode !== 'search' || !query.search?.trim() || query.orderIds !== undefined) throw new BadRequestException('Select orders or enter a SKU search')
    const initial = await this.scope(userId)
    if (!initial.roles.includes('allocation')) throw new ForbiddenException('Allocation workbench access required')
    let permission = await this.permissions(userId, initial)
    let selected: { sku: string; warehouseCode: string; customerId: string }[] | undefined
    if (query.mode === 'selected') {
      const current = await this.scopedOrders(userId, 'allocation', undefined)
      await this.assertUnchanged(userId, initial)
      // Use the newest independent inventory grant together with the current order snapshot.
      const orders = current.orders.filter(o => query.orderIds!.includes(o.id) && matchesQueue(o, 'allocation'))
      if (new Set(orders.map(o => o.id)).size !== new Set(query.orderIds).size) throw new ConflictException({ code: 'inventory_orders_changed', message: 'Selected orders changed; refresh the list and select again' })
      selected = orders.flatMap(o => {
        if (!o.customerId || !['HZ', 'SZ'].includes(o.warehouseCode ?? '') || !o.items.length || o.items.some(i => !i.sku?.trim())) throw new ServiceUnavailableException('Order inventory dimensions are incomplete')
        return o.items.map(i => ({ sku: i.sku, warehouseCode: o.warehouseCode!, customerId: o.customerId! }))
      })
      permission = current.permission
    }
    const targets = await this.providerCall(async () => inventoryTargets(permission.allocationInventoryScopes, initial.business, selected, query.search, query.warehouseCode))
    targets.sort((a, b) => a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode) || (a.customer?.id ?? '').localeCompare(b.customer?.id ?? ''))
    const page = targets.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
    let asOf = new Date().toISOString(), items: ReturnType<typeof inventorySnapshot> = []
    if (page.length) {
      const snapshot = await this.providerCall(() => this.provider.getAllocationInventory(permission.subject, permission, page))
      await this.assertUnchanged(userId, initial)
      if (!sameIdentity(snapshot?.subject, permission.subject)) throw new ForbiddenException('Inventory subject mismatch')
      items = await this.providerCall(async () => inventorySnapshot(page, snapshot))
      asOf = snapshot.asOf
    }
    await this.assertUnchanged(userId, initial)
    return { items, total: targets.length, page: query.page, pageSize: query.pageSize, asOf, source: this.provider.source }
  }

  async getStockOrders(userId: string, query: StockPageQuery) {
    const { orders } = await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales')
    const filtered = filterStockOrders(orders, query)
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), departments: stockDepartments(orders), items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, totals: stockTotals(filtered), page: query.page, pageSize: query.pageSize }
  }

  async getStockCustomers(userId: string, query: StockScopeDto) {
    const { inventory, initial } = await this.scopedStockInventory(userId)
    const { orders } = await this.scopedStockOrders(userId, 'inventory')
    await this.assertUnchanged(userId, initial)
    const search = query.search?.trim().toLowerCase()
    const customers = new Map<string, { id: string; code: string; name: string }>()
    for (const row of [...orders, ...inventory]) if (stockScopeMatches(row, query) && (!search || [row.customerCode, row.customerName].some(v => v.toLowerCase().includes(search)))) customers.set(row.customerId, { id: row.customerId, code: row.customerCode, name: row.customerName })
    const items = [...customers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return { items: items.slice(0, 100), total: items.length }
  }

  async getStockInventory(userId: string, query: StockInventoryQuery) {
    const { inventory } = await this.scopedStockInventory(userId)
    const search = query.search?.trim().toLowerCase()
    const customerSearch = query.customerSearch?.trim().toLowerCase()
    const filtered = inventory.filter(row => (!query.customerId || row.customerId === query.customerId) && (!customerSearch || [row.customerCode, row.customerName].some(v => v.toLowerCase().includes(customerSearch))) && stockScopeMatches(row, query) && (!search || [row.sku, row.name].some(v => v.toLowerCase().includes(search))))
      .map(publicStockInventory).sort((a, b) => a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId) || a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode) || a.id.localeCompare(b.id))
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), customerId: query.customerId ?? null, items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize }
  }

  async exportStockOrders(userId: string, query: ExportStockOrdersDto, sessionVersion = 0): Promise<Buffer> {
    if (query.mode === 'selected' ? !query.orderIds?.length || query.orderIds.length > 100 || new Set(query.orderIds).size !== query.orderIds.length : query.mode !== 'filtered' || query.orderIds !== undefined) throw new BadRequestException('Invalid stock export selection')
    const assertSession = async () => {
      const user = await this.users.findById(userId)
      if (!user || user.accountDisabled || (user.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Session expired')
    }
    await assertSession()
    const initial = await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales')
    const filtered = filterStockOrders(initial.orders, query as StockFilters)
    const selected = new Set(query.orderIds)
    const rows = query.mode === 'selected' ? filtered.filter(row => selected.has(row.id)) : filtered
    if (query.mode === 'selected' && rows.length !== selected.size) throw new ConflictException({ code: 'export_selection_changed', message: '所选备货单已变化，请刷新。' })
    if (!rows.length) throw new ConflictException({ code: 'export_empty', message: '没有可导出的备货单。' })
    const buffer = await buildStockWorkbook(rows, this.provider.source)
    const latest = await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales')
    await this.assertUnchanged(userId, initial.initial)
    const current = new Set(filterStockOrders(latest.orders, query).map(row => row.id))
    if (rows.some(row => !current.has(row.id))) throw new ForbiddenException({ code: 'export_access_changed', message: '备货单查看范围已变化，请刷新。' })
    await assertSession()
    return buffer
  }

  async exportOrders(userId: string, query: ExportFulfillmentOrdersDto, sessionVersion = 0): Promise<Buffer> {
    if (query.mode === 'selected' ? !query.orderIds?.length || query.orderIds.length > 100 || new Set(query.orderIds).size !== query.orderIds.length : query.mode !== 'filtered' || query.orderIds !== undefined) throw new BadRequestException('Invalid export selection')
    const assertSession = async () => {
      const account = await this.users.findById(userId)
      if (!account || account.accountDisabled || (account.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Account disabled or session expired')
    }
    await assertSession()
    const { filtered, initial } = await this.filteredOrders(userId, query)
    const ids = new Set(query.orderIds)
    const orders = query.mode === 'selected' ? filtered.filter(order => ids.has(order.id)) : filtered
    if (query.mode === 'selected' && orders.length !== ids.size) throw new ConflictException({ code: 'export_selection_changed', message: '所选订单状态或查看范围已变化，请刷新后重新选择。' })
    if (!orders.length) throw new ConflictException({ code: 'export_empty', message: '当前筛选下没有可导出的订单，请刷新或调整筛选。' })
    const buffer = await buildFulfillmentWorkbook(orders, query, this.provider.source ?? 'fop')
    await this.assertUnchanged(userId, initial)
    // Upstream grants may be broader than local employee/department scope. Re-read
    // ownership as well as permissions before releasing the earlier data snapshot.
    const current = await this.filteredOrders(userId, query)
    await this.assertUnchanged(userId, initial)
    if (orders.some(order => !current.authorizedOrderIds.has(order.id))) throw new ForbiddenException({ code: 'export_access_changed', message: '订单查看范围已变化，请刷新后重试。' })
    const matchingIds = new Set(current.filtered.map(order => order.id))
    if (orders.some(order => !matchingIds.has(order.id))) throw new ConflictException({ code: 'export_selection_changed', message: '订单状态或筛选结果已变化，请刷新后重新导出。' })
    await assertSession()
    return buffer
  }

  async getOrderVolume(userId: string, query: OrderVolumeQueryDto) {
    const now = new Date()
    const periods = orderVolumePeriods(query, now)
    const chartId = query.category === 'customer' ? 'customer_orders' : 'order_volume'
    const context = await this.chartContext(userId, chartId)
    if (query.view === 'summary') {
      if (query.category !== 'organization') throw new BadRequestException('Summary view requires organization category')
      const rows = await this.organizationSummary(userId, context, { chartId: 'order_volume', departments: context.access.summaryDepartments, from: periods[0].from, to: periods[periods.length - 1].to })
      const result = await this.providerCall(async () => summaryOrderVolume(rows, context.access.summaryDepartments, query, now))
      await this.assertUnchanged(userId, context.initial)
      return { source: this.provider.source ?? 'fop', chartAccess: { ...context.access, summaryOnly: true, canViewDetails: false }, ...result }
    }
    if (context.access.dataScope === 'none') throw new ForbiddenException({ code: 'chart_access_denied', message: 'Record chart scope denied' })
    const scoped = await this.scopedOrders(userId, undefined, context)
    const receipts = query.category === 'customer' && scoped.permission.analyticsScopes?.includes('receipts') ? await this.scopedReceipts(userId, scoped, context) : undefined
    const result = aggregateOrderVolume(scoped.orders, query, now, receipts)
    if (query.category === 'organization' && result.series[0]) result.series[0].label = context.access.dataScope === 'self' ? '本人订单合计' : '当前成员订单合计'
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: context.access, summaryOnly: false, ...(chartId === 'customer_orders' ? { customerOwnershipBasis: this.customerBasis(context) } : {}), ...result }
  }

  async searchOrderCustomers(userId: string, query: OrderCustomerSearchDto) {
    const context = await this.chartContext(userId, 'customer_orders')
    const scoped = await this.scopedOrders(userId, undefined, context)
    const receipts = await this.scopedReceipts(userId, scoped, context)
    const result = searchOrderCustomers(scoped.orders, query, receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: context.access, customerOwnershipBasis: this.customerBasis(context), ...result }
  }

  async getOrderVolumeDetails(userId: string, query: OrderVolumeDetailsDto) {
    if (query.view === 'summary') throw new ForbiddenException({ code: 'chart_access_denied', message: 'Organization summaries do not grant order details' })
    const chartId = query.category === 'customer' ? 'customer_orders' : 'order_volume'
    const context = await this.chartContext(userId, chartId, true, query.workbenchRole)
    const scoped = await this.scopedOrders(userId, query.workbenchRole, context)
    const receipts = query.category === 'customer' ? await this.scopedReceipts(userId, scoped, context) : []
    const rows = orderVolumeDetails(scoped.orders, query, new Date(), receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: context.access, ...(chartId === 'customer_orders' ? { customerOwnershipBasis: this.customerBasis(context) } : {}), total: rows.length, totals: summarizeFopOrders(rows), page: query.page, pageSize: query.pageSize, items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
  }

  async getDashboard(userId: string, query: FopDashboardQueryDto) {
    const start = Date.parse(`${query.from}T00:00:00Z`)
    const end = Date.parse(`${query.to}T00:00:00Z`)
    const now = new Date()
    const day = 86_400_000
    if (!Number.isFinite(start) || !Number.isFinite(end)
      || new Date(start).toISOString().slice(0, 10) !== query.from || new Date(end).toISOString().slice(0, 10) !== query.to
      || start > end || end - start > 365 * day || query.to > businessDate(now) || query.year > Number(businessDate(now).slice(0, 4))) {
      throw new BadRequestException('Invalid dashboard date range or year')
    }
    const scoped = await this.scopedOrders(userId)
    // Date controls belong to registrations/receipts, not the current pending queues.
    const orders = scoped.orders
    const allowed = (queue: Queue) => scoped.roles.includes(FULFILLMENT_QUEUE_ROLES[queue])
    // Procurement and allocation cards cover both tabs; scopedOrders already deduplicates IDs.
    const pendingOrders = (queue: Queue) => orders.filter(order => matchesQueue(order, queue)
      || queue === 'procurement' && matchesQueue(order, 'procurement_shipping')
      || queue === 'allocation' && matchesQueue(order, 'allocation_review'))
    const count = (queue: Queue) => allowed(queue) ? pendingOrders(queue).length : 0
    const queues = { review: count('review'), dispatch: count('dispatch'), procurement: count('procurement'), allocation: count('allocation'), shipping: count('shipping') }
    const tasks = (['review', 'dispatch', 'procurement', 'allocation', 'shipping'] as const).filter((queue) => allowed(queue) && queues[queue] > 0)
      .map((queue) => {
        const oldest = pendingOrders(queue).map(paymentTime).filter(Number.isFinite).sort((a, b) => a - b)[0]
        const time = oldest === undefined ? '' : new Date(oldest + 8 * 3_600_000).toISOString().slice(11, 16)
        return { id: queue, kind: queue, count: queues[queue], time, priority: queue === 'allocation' ? 'normal' : 'high' }
      })
    const chartAccess = this.effectiveCharts(scoped.initial, scoped.permission)
    const context = (chartId: ChartId): ChartContext => ({ chartId, initial: scoped.initial, permission: scoped.permission, access: chartAccess.find(c => c.chartId === chartId)! })
    const registrationContext = context('registrations')
    const receiptContext = context('salesperson_receipts')
    const departmentContext = context('department_receipts')
    const analyticsScopes = (scoped.permission.analyticsScopes ?? []).filter(scope => scope === 'rates' || scope === 'registrations' && registrationContext.access.visible && registrationContext.access.dataScope !== 'none')
    const analytics = analyticsScopes.length
      ? await this.providerCall(() => this.provider.getAnalytics(Object.freeze({ ...scoped.permission.subject }), Object.freeze({ ...scoped.permission, allowedOrderIds: Object.freeze([...scoped.permission.allowedOrderIds]), analyticsScopes: Object.freeze([...analyticsScopes]) }), query))
      : { subject: scoped.permission.subject, rates: [], registrations: [] }
    await this.assertUnchanged(userId, scoped.initial)
    if (!sameIdentity(analytics?.subject, scoped.permission.subject)) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP analytics identity does not match this account' })
    await this.providerCall(async () => {
      if (!Array.isArray(analytics.rates) || !Array.isArray(analytics.registrations)
        || analytics.rates.some(rate => !rate || !/^[A-Z]{3}$/.test(rate.currency) || !Number.isFinite(rate.cnyPerUnit) || rate.cnyPerUnit <= 0)
        || analytics.registrations.some(item => !item || !/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !Number.isFinite(Date.parse(item.date)) || new Date(item.date).toISOString().slice(0, 10) !== item.date || !Number.isSafeInteger(item.count) || item.count < 0)) throw new Error('Invalid FOP analytics response')
    })
    const rates = analyticsScopes.includes('rates') ? analytics.rates.map(({ currency, cnyPerUnit }) => ({ currency, cnyPerUnit })) : []
    const dailyRegistrations = analyticsScopes.includes('registrations') ? analytics.registrations.filter(item => item.date >= query.from && item.date <= query.to).map(({ date, count }) => ({ date, count })) : []
    let registrationData = analyticsScopes.includes('registrations') && analytics.registrationEntries !== undefined
      ? await this.providerCall(async () => aggregateRegistrations(analytics.registrationEntries!.filter(entry => { this.validateAncestry(entry?.departmentPathIds); return !!entry && this.matchesChart(registrationContext, entry) }), query.from, query.to))
      : { registrations: registrationContext.access.visible && registrationContext.access.dataScope === 'all' ? dailyRegistrations : [], registrationDepartments: [] }
    if (registrationContext.access.visible && registrationContext.access.summaryDepartments.length) {
      const summaryRows = await this.organizationSummary(userId, registrationContext, { chartId: 'registrations', departments: registrationContext.access.summaryDepartments, from: query.from, to: query.to })
      const summary = await this.providerCall(async () => summaryRegistrations(summaryRows, registrationContext.access.summaryDepartments, query.from, query.to))
      // Only already-authorized record series can accompany aggregate department totals.
      // Cross-department summary permission never materializes another member.
      for (const department of summary.registrationDepartments) department.salespeople = registrationData.registrationDepartments.find(d => d.id === department.id)?.salespeople ?? []
      registrationData = summary
    }
    const receiptRecords = receiptContext.access.visible && receiptContext.access.dataScope !== 'none' ? await this.scopedReceipts(userId, scoped, receiptContext) : []
    const receipts = await this.providerCall(async () => monthlyReceipts(receiptRecords, query.year, receiptContext.access.visible, now))
    if (receipts.marketingCenter) receipts.marketingCenter.name = receiptContext.access.dataScope === 'self' ? '本人回款合计' : '当前成员回款合计'
    let departmentReceipts = monthlyReceipts([], query.year, false, now)
    if (departmentContext.access.visible) {
      const summaryRows = await this.organizationSummary(userId, departmentContext, { chartId: 'department_receipts', departments: departmentContext.access.summaryDepartments, from: `${query.year - 1}-12-01`, to: query.year === Number(businessDate(now).slice(0, 4)) ? businessDate(now) : `${query.year}-12-31` })
      departmentReceipts = await this.providerCall(async () => summaryReceipts(summaryRows, departmentContext.access.summaryDepartments, query.year, now))
    }
    await this.assertUnchanged(userId, scoped.initial)
    return {
      businessScope: scoped.initial.business, source: this.provider.source ?? 'fop', updatedAt: now.toISOString(), queues, rates, ...registrationData, tasks,
      exceptions: allowed('exceptions') ? orders.filter((order) => matchesQueue(order, 'exceptions'))
        .sort(comparePaymentTime)
        .map((order) => ({ id: order.orderNumber, customer: order.customerName, reason: order.exception!.reason, hours: order.exception!.hours })) : [],
      receipts, departmentReceipts, chartAccess,
    }
  }
}

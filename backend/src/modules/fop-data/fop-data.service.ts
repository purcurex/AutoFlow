import { matchesQueue, type Queue } from './workbench-queue-rules'
import { DASHBOARD_QUEUES, dashboardQueues } from './dashboard-queues'
import { localEmployeeFilter, localOwnership, localDepartments, localSalespeople } from './local-workbench-scope'
import type { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import type { FopOrderPageQuery, FopOrderPage } from './fop-data.types'
import type { FopSupplierContext } from './fop-realtime.types'
import { stockSupplierFollowUps } from './stock-supplier-follow-up'
import { buildRmaOrders, summarizeRmaOrders, RmaTypeConflictError, type RmaOrder } from './rma-orders'
import { RmaFiltersDto, RmaQueryDto, RmaExportDto } from './rma-orders.dto'
import { buildRmaWorkbook } from './rma-orders-export'
import { buildPurchaseReturns, groupPurchaseReturnOrders, summarizePurchaseReturnOrders, type PurchaseReturnOrder, type PurchaseReturnSource } from './purchase-returns'
import { PurchaseReturnContactQueryDto, PurchaseReturnChatQueryDto, PurchaseReturnQueryDto, PurchaseReturnExportDto, PurchaseReturnFiltersDto } from './purchase-returns.dto'
import { buildPurchaseReturnWorkbook } from './purchase-returns-export'
import { isCompletionQueue, isStageCompleted } from './completed-orders'
import { normalizeOrderAmountBreakdown } from './order-amount-breakdown'
import { createHash } from 'crypto'
import { buildPurchaseGroups, purchaseGroupSummary, purchaseGroupTotals } from './procurement-groups'
import { PurchaseGroupQueryDto, PurchaseGroupExportDto, PurchaseGroupFiltersDto, PurchaseGroupChatQueryDto } from './procurement-groups.dto'
import { buildPurchaseGroupWorkbook } from './procurement-groups-export'
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
import { consumerPaymentRange } from './consumer-payment-range'
import { canFilterTaskStatus, matchesTaskStatus } from './workbench-status'
import { canFilterProcurementStage, getProcurementStage } from './procurement-stage'
import type { ApprovalQueue } from './fop-approval.types'
import { supplierFollowUps } from './supplier-follow-up'
import { CHART_IDS, ChartId, ChartSummaryPolicy, EffectiveChartAccess, resolveChartAccess, resolveChartSummaryPolicy } from '../users/chart-permissions'
import { summaryOrderVolume, summaryReceipts, summaryRegistrations } from './fop-organization-summary'
import { FopCurrentCustomerOwner, FopOrganizationSummaryGrant, FopOrganizationSummaryNotConfiguredError, FopOrganizationSummaryQuery, FopOrganizationSummaryRow, SALES_DEPARTMENTS } from './fop-data.types'
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
import { FOP_ADMIN_CONTEXT, FOP_EXCEPTION_TYPES, FOP_DATA_PROVIDER, FopDataProvider, FopIdentity, FopIntegrationUnavailableError, FopOrder, FopOrderCandidate, FopPermissionDeniedError, FopPermissionGrant, FopReceipt, FopAnalyticsRange, FopAnalyticsResource } from './fop-data.types'

import { businessScope, effectiveBusinessScope, matchesBusinessScope, BusinessScope } from '../users/business-scope'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from './order-volume.dto'
import { aggregateOrderVolume, orderVolumeDetails, orderVolumeReceiptDetails, searchOrderCustomers, orderVolumePeriods } from './order-volume'
import { aggregateRegistrations } from './fop-registration'
import { summarizeFopOrders } from './fop-order-totals'
import { canSortFulfillmentQueue, compareFulfillmentOrders, comparePaymentTime, paymentTime } from './fop-order-sort'

import { eligibleReceipts, monthlyReceipts, publicReceipt, summarizeReceipts } from './fop-receipts'
import { businessDate, BUSINESS_TIME_ZONE, validBusinessDay } from './fop-business-time'
import { ReceiptQueryDto } from './fop-receipts.dto'
import { emptyAnalyticsData } from './fop-kingdee.analytics'
import { ConfirmFopConnectionDto } from './fop-connection.dto'
import type { FopRealtimeScope, FopRealtimeApprovalContext } from './fop-realtime.types'
import type { LocalWorkbenchService } from '../workbench-replica/local-workbench.service'

type Scope = { localOrganization?: LocalWorkbenchOrganization; binding: FopIdentity | null; bindingVersion?: string; employeeMasterId?: string; roles: WorkbenchRole[]; business: BusinessScope; charts: EffectiveChartAccess[]; summaryPolicies: Record<ChartId, ChartSummaryPolicy>; customerAttribution?: { current: number; historical: number; assignments: Map<string, string> } }
type ChartContext = { initial: Scope; permission: FopPermissionGrant; access: EffectiveChartAccess; chartId: ChartId }

function sameIdentity(left: Pick<FopIdentity, 'tenantId' | 'userId'> | null | undefined, right: Pick<FopIdentity, 'tenantId' | 'userId'> | null | undefined): boolean {
  return !!left && !!right && left.tenantId === right.tenantId && left.userId === right.userId
}

function publicBusinessScope(scope: BusinessScope): BusinessScope {
  return { role: scope.role, departmentId: scope.departmentId, employeeId: scope.employeeId }
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
    shipmentInterceptStatus: order.shipmentInterceptStatus === 'intercepted' || order.shipmentInterceptStatus === 'released' ? order.shipmentInterceptStatus : null,
    dispatchDocuments: documents?.map(({ id, number, status }) => ({ id, number, status })) ?? null,
    dispatchTaskStatus: order.dispatchTaskStatus,
    procurementProgress: { purchaseOrder: procurement?.purchaseOrder ?? 'unknown', supplierPayment: procurement?.supplierPayment ?? 'unknown',
      purchaseApplication: procurement?.purchaseApplication ?? 'unknown', alibabaOrder: procurement?.alibabaOrder ?? 'unknown', logisticsGate: procurement?.logisticsGate ?? 'unknown' },
    ...(order.salesDepartmentCode ? { salesDepartmentCode: order.salesDepartmentCode } : {}),
    fulfillmentProgress: { allocationCreated: progress.allocationCreated ?? null, shopifySync: progress.shopifySync, supplierShipment: progress.supplierShipment, stockReadiness: progress.stockReadiness, allocationReview: progress.allocationReview, outbound: progress.outbound },
    id: order.id, orderNumber: order.orderNumber, shopifyOrderNumber: order.shopifyOrderNumber,
    customerId: order.customerId, customerCode: order.customerCode, warehouseCode: order.warehouseCode, carrierCode: order.carrierCode,
    shopifySyncedAt: isStageCompleted(order, 'dispatch') ? normalizeBusinessTimestamp(order.shopifySyncedAt) : null,
    dispatchApprovedAt: isStageCompleted(order, 'dispatch') ? normalizeBusinessTimestamp(order.dispatchApprovedAt) : null,
    procurementCompletedAt: isStageCompleted(order, 'procurement') ? normalizeBusinessTimestamp(order.procurementCompletedAt) : null,
    allocationApprovedAt: isStageCompleted(order, 'allocation_review') ? normalizeBusinessTimestamp(order.allocationApprovedAt) : null,
    outboundCompletedAt: isStageCompleted(order, 'shipping') ? normalizeBusinessTimestamp(order.outboundCompletedAt) : null,
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
    amount: order.amount, amountBreakdown: normalizeOrderAmountBreakdown(order.amountBreakdown), currency: order.currency?.trim().toUpperCase() || 'USD', paymentStatus: order.paymentStatus,
    reviewStatus: order.reviewStatus, procurementStatus: order.procurementStatus,
    allocationStatus: order.allocationStatus, dispatchStatus: order.dispatchStatus, shippingStatus: order.shippingStatus,
    warehouse: order.warehouse, carrier: order.carrier, trackingNumber: order.trackingNumber,
    salesperson: order.salesperson, createdAt: order.createdAt, paidAt: order.paidAt && Number.isFinite(Date.parse(order.paidAt)) ? order.paidAt : null, cancelled: order.cancelled,
    exception: order.exception ? { type: order.exception.type !== null && FOP_EXCEPTION_TYPES.includes(order.exception.type) ? order.exception.type : null, reason: typeof order.exception.reason === 'string' ? order.exception.reason.trim() || null : null, hours: order.exception.hours } : null,
  }
}

@Injectable()
export class FopDataService {
  constructor(
    private readonly users: UsersService,
    @Inject(FOP_DATA_PROVIDER) private readonly provider: FopDataProvider,
  ) {}

  /** 仅当前系统管理员且具有全部业务数据角色时提供连接入口，不让其他账号继承代理用户身份。 */
  private async requireConnectionAdmin(userId: string) {
    const user = await this.users.findById(userId)
    if (!user) throw new UnauthorizedException()
    if (user.role !== 'admin') throw new ForbiddenException('Company administrator access required')
    return user
  }

  /** 测试连接不写账号数据；返回平台认证身份和当前公司，确认期间继续复核管理员身份及原绑定。 */
  async testConnection(userId: string) {
    await this.requireConnectionAdmin(userId)
    const initial = await this.scope(userId)
    if (!await this.providerCall(async () => this.provider.isConfigured())) throw new ServiceUnavailableException({ code: 'fop_not_configured', message: 'FOP data integration is not configured' })
    const connection = await this.providerCall(() => this.provider.getConnectionContext())
    await this.requireConnectionAdmin(userId)
    await this.assertUnchanged(userId, initial)
    if (initial.binding && !sameIdentity(initial.binding, connection.subject)) throw new ForbiddenException({ code: 'fop_binding_changed', message: 'Existing binding differs from the authenticated Kingdee user' })
    return connection
  }

  /** 确认时重读平台身份，不接受前端指定目标账号；复用现有绑定字段及唯一约束，不扩大业务权限。 */
  async connectCurrentAdmin(userId: string, expected: ConfirmFopConnectionDto) {
    if (this.provider.supportsEmployeeBinding) throw new BadRequestException('请在组织架构的账号资料中选择并验证对应金蝶员工')
    const initial = await this.requireConnectionAdmin(userId)
    const connection = await this.testConnection(userId)
    if (!sameIdentity(connection.subject, expected) || connection.currentOrganization.id !== expected.organizationId) {
      throw new ForbiddenException({ code: 'fop_binding_changed', message: 'Kingdee identity or company changed; test the connection again' })
    }
    const binding = initial.fopTenantId && initial.fopUserId ? { tenantId: initial.fopTenantId, userId: initial.fopUserId } : null
    return this.users.connectCurrentAdminFop(userId, binding, connection.subject)
  }

  private async scope(userId: string, workbench = false): Promise<Scope> {
    const user = await this.users.findById(userId)
    if (!user || user.accountDisabled) throw new UnauthorizedException('Account no longer exists')
    const business = effectiveBusinessScope(user), details = user.fopBindingDetails
    // A system administrator uses an explicitly enabled company service context.
    // Employee bindings remain unique and are never copied from another account.
    const administrator = user.role === 'admin' ? await this.providerCall(() => this.provider.administratorIdentity?.() ?? Promise.resolve(null)) : null
    // 本地UUID保留给组织管理；金蝶查询只使用本次绑定验证过的masterId及任职部门ID。
    if (this.provider.supportsEmployeeBinding && details) {
      if (details.localEmployeeId && business.employeeId === details.localEmployeeId) business.employeeId = details.employeeMasterId
      if (details.localDepartmentId && business.departmentId === details.localDepartmentId) business.departmentId = details.departmentId
    }
    // Personal display always means this account's verified employee, even if an old
    // manager scope retained another configurable employee assignment.
    if (user.role !== 'admin' && user.businessRole === 'department_manager' && user.dataDisplayScope !== 'department'
      && this.provider.supportsEmployeeBinding && details) business.employeeId = details.employeeMasterId
    const chartUser = user.businessRole === 'department_manager' && user.dataDisplayScope !== 'department'
      ? { ...user, businessEmployeeId: business.employeeId } : user
    const verified = !!administrator || !this.provider.supportsEmployeeBinding || !!details
    const localOrganization = workbench && this.provider.usesLocalWorkbenchOrganization && business.role !== 'none' && verified && (administrator || user.fopTenantId && user.fopUserId)
      ? await this.users.localWorkbenchOrganization(user, administrator?.[FOP_ADMIN_CONTEXT]
        ? { tenantId: administrator.tenantId, organizationId: administrator[FOP_ADMIN_CONTEXT]!.organizationId } : undefined) : undefined
    if (localOrganization) {
      business.departmentId = localOrganization.departmentId
      business.employeeId = business.role === 'admin' ? null : localOrganization.employeeId ?? details?.employeeMasterId ?? null
      business.localOrganization = { employeeIds: localOrganization.employeeIds, version: localOrganization.version }
    }
    return {
      localOrganization,
      business,
      employeeMasterId: details?.employeeMasterId,
      bindingVersion: this.provider.supportsEmployeeBinding ? JSON.stringify(details ?? null) : undefined,
      charts: resolveChartAccess(chartUser),
      summaryPolicies: Object.fromEntries(CHART_IDS.map(chartId => [chartId, resolveChartSummaryPolicy(chartUser, chartId)])) as Record<ChartId, ChartSummaryPolicy>,
      binding: administrator ?? this.provider.demoIdentity?.(userId) ?? (verified && user.fopTenantId && user.fopUserId ? { tenantId: user.fopTenantId, userId: user.fopUserId } : null),
      roles: businessScope(user).role === 'none' ? [] : businessScope(user).role === 'admin' ? [...WORKBENCH_ROLES] : (user.workbenchRoles ?? []).filter(isWorkbenchRole),
    }
  }

  private async assertUnchanged(userId: string, initial: Scope): Promise<void> {
    const current = await this.scope(userId, !!initial.localOrganization)
    if (JSON.stringify(current.charts) !== JSON.stringify(initial.charts) || JSON.stringify(current.summaryPolicies) !== JSON.stringify(initial.summaryPolicies)
      || current.bindingVersion !== initial.bindingVersion || current.localOrganization?.version !== initial.localOrganization?.version
      || JSON.stringify(current.business) !== JSON.stringify(initial.business)
      || ((current.binding !== null || initial.binding !== null) && !sameIdentity(current.binding, initial.binding))
      || [...current.roles].sort().join(',') !== [...initial.roles].sort().join(',')) {
      throw new ForbiddenException({ code: 'fop_binding_changed', message: 'FOP binding or workbench access changed; reload before continuing' })
    }
  }

  /** No legacy list/analytics permissions are resolved for realtime operations. */
  private async realtimeContext(userId: string, required: readonly WorkbenchRole[], query: { departmentId?: string; ownerId?: string } = {}) {
    const initial = await this.scope(userId, true)
    if (!required.some(role => initial.roles.includes(role)) || initial.business.role === 'none') throw new ForbiddenException('Realtime workbench access denied')
    if (!initial.binding) throw new ForbiddenException({ code: 'fop_binding_required', message: 'FOP integration identity is required' })
    if (initial.business.role === 'salesperson' && !initial.business.employeeId || initial.business.role === 'department_manager' && !initial.business.departmentId) throw new ForbiddenException('Current business scope is required')
    const employeeFilter = initial.localOrganization ? localEmployeeFilter(initial.localOrganization, query) : {
      employeeIds: initial.business.role === 'salesperson' ? [initial.business.employeeId!] : null,
      version: createHash('sha256').update(JSON.stringify([initial.business, initial.bindingVersion])).digest('hex'),
    }
    const currentScope: FopRealtimeScope = { actorAccountId: userId, actorEmployeeId: initial.employeeMasterId ?? initial.business.employeeId, business: { ...initial.business }, employeeFilter }
    return { initial, identity: { ...initial.binding }, currentScope }
  }

  private async permissions(userId: string, initial: Scope, stock = false): Promise<FopPermissionGrant> {
    if (initial.business.role === 'none') throw new ForbiddenException({ code: 'business_access_disabled', message: 'Business data access is disabled for this account' })
    if (!initial.binding) throw new ForbiddenException({ code: 'fop_binding_required', message: 'Bind this employee account to an FOP user first' })
    if (!await this.providerCall(async () => this.provider.isConfigured())) throw new ServiceUnavailableException({ code: 'fop_not_configured', message: 'FOP data integration is not configured' })
    if ((initial.business.role === 'department_manager' && !initial.business.departmentId) || (initial.business.role === 'salesperson' && !initial.business.employeeId)) throw new ForbiddenException({ code: 'business_scope_required', message: 'Configure this account department or employee data scope first' })
    const identity = Object.freeze({ ...initial.binding })
    const grant = await this.providerCall(() => stock && this.provider.queriedStock ? this.provider.resolveStockPermissions(identity, initial.business) : this.provider.resolvePermissions(identity, initial.business))
    await this.assertUnchanged(userId, initial)
    if (!sameIdentity(grant?.subject, identity) || !Array.isArray(grant?.allowedOrderIds)
      || grant.allowedOrderIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP permissions do not authorize this account identity' })
    }
    if (grant.allowedPurchaseOrderIds !== undefined && (!Array.isArray(grant.allowedPurchaseOrderIds) || grant.allowedPurchaseOrderIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException('Invalid FOP purchase permissions')
    }
    for (const ids of [grant.allowedStockOrderIds, grant.allowedStockInventoryIds, grant.allowedPurchaseReturnIds, grant.allowedRmaCaseIds]) {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()))) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP stock permissions' })
    }
    if (grant.stockQuery !== undefined && (!this.provider.queriedStock || !grant.stockQuery || typeof grant.stockQuery !== 'object'
      || Object.keys(grant.stockQuery).some(key => !['orders', 'inventory'].includes(key))
      || [grant.stockQuery.orders, grant.stockQuery.inventory].some(ids => !Array.isArray(ids) || ids.length > 200 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id))))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP stock query grant' })
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
    if (grant.orderQuery && (!Array.isArray(grant.orderQuery.queues) || !grant.orderQuery.queues.length
      || grant.orderQuery.queues.some(queue => !Object.prototype.hasOwnProperty.call(FULFILLMENT_QUEUE_ROLES, queue))
      || new Set(grant.orderQuery.queues).size !== grant.orderQuery.queues.length
      || !Array.isArray(grant.orderQuery.organizationIds) || !grant.orderQuery.organizationIds.length
      || grant.orderQuery.organizationIds.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id)))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP query grant' })
    }
    if (grant.orderQuery?.employeeFilterVersion !== undefined && grant.orderQuery.employeeFilterVersion !== 1 || grant.stockEmployeeFilterVersion !== undefined && grant.stockEmployeeFilterVersion !== 1) throw new ForbiddenException('Unsupported employee filter contract')
    if (grant.analyticsQuery && (typeof grant.analyticsQuery !== 'object' || Array.isArray(grant.analyticsQuery)
      || Object.entries(grant.analyticsQuery).some(([resource, ids]) => !['orders', 'receipts', 'registrations', 'freight'].includes(resource)
        || !Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id))))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP analytics query grant' })
    }
    if (grant.approvalActions !== undefined && (!Array.isArray(grant.approvalActions) || grant.approvalActions.some(action => !['review', 'allocation_review'].includes(action)))) throw new ForbiddenException('Invalid FOP operation permissions')
    const summaries = grant.organizationSummaries ?? []
    if (!Array.isArray(summaries) || new Set(summaries.map((s: FopOrganizationSummaryGrant) => s?.chartId)).size !== summaries.length || summaries.some((s: FopOrganizationSummaryGrant) => !s || !['registrations', 'department_receipts', 'order_volume'].includes(s.chartId) || !Array.isArray(s.departments) || new Set(s.departments.map((d: FopOrganizationSummaryGrant['departments'][number]) => d?.code)).size !== s.departments.length || s.departments.some((d: FopOrganizationSummaryGrant['departments'][number]) => !d || !SALES_DEPARTMENTS.some(item => item.id === d.code) || typeof d.departmentId !== 'string' || !d.departmentId.trim() || d.departmentPathIds !== undefined && (!Array.isArray(d.departmentPathIds) || d.departmentPathIds.some((id: unknown) => typeof id !== 'string' || !id.trim()) || new Set(d.departmentPathIds).size !== d.departmentPathIds.length)))) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid organization summary grant' })
    return { allocationInventoryScopes: grant.allocationInventoryScopes === undefined ? undefined : structuredClone(grant.allocationInventoryScopes), allowedStockOrderIds: [...new Set(grant.allowedStockOrderIds ?? [])], allowedStockInventoryIds: [...new Set(grant.allowedStockInventoryIds ?? [])], approvalActions: [...new Set(grant.approvalActions ?? [])], organizationSummaries: summaries.map((s: FopOrganizationSummaryGrant) => ({ chartId: s.chartId, departments: s.departments.map((d: FopOrganizationSummaryGrant['departments'][number]) => ({ code: d.code, departmentId: d.departmentId, ...(d.departmentPathIds ? { departmentPathIds: [...d.departmentPathIds] } : {}) })) })), subject: { ...identity }, allowedOrderIds: [...new Set(grant.allowedOrderIds)], allowedPurchaseOrderIds: [...new Set(grant.allowedPurchaseOrderIds ?? [])], allowedPurchaseReturnIds: [...new Set(grant.allowedPurchaseReturnIds ?? [])], allowedRmaCaseIds: grant.allowedRmaCaseIds === undefined ? undefined : [...new Set(grant.allowedRmaCaseIds)], allowedReceiptIds: [...new Set(grant.allowedReceiptIds ?? [])], allowedFreightIds: [...new Set(grant.allowedFreightIds ?? [])], allowedProfitIds: [...new Set(grant.allowedProfitIds ?? [])], analyticsScopes: [...new Set(grant.analyticsScopes ?? [])],
      ...(grant.stockEmployeeFilterVersion ? { stockEmployeeFilterVersion: grant.stockEmployeeFilterVersion } : {}),
      ...(grant.stockQuery ? { stockQuery: { orders: [...grant.stockQuery.orders], inventory: [...grant.stockQuery.inventory] } } : {}),
      ...(grant.analyticsQuery ? { analyticsQuery: Object.fromEntries(Object.entries(grant.analyticsQuery).map(([resource, ids]) => [resource, [...ids]])) } : {}),
      ...(grant.orderQuery ? { orderQuery: { queues: [...grant.orderQuery.queues], organizationIds: [...grant.orderQuery.organizationIds], ...(grant.orderQuery.employeeFilterVersion ? { employeeFilterVersion: grant.orderQuery.employeeFilterVersion } : {}) } } : {}) }
  }

  private effectiveCharts(initial: Scope, permission: FopPermissionGrant): EffectiveChartAccess[] {
    return initial.charts.map(local => {
      if (!initial.roles.length || local.chartId === 'sales_performance' && !initial.roles.includes('sales')) return { ...local, visible: false, dataScope: 'none', scopeLabel: '尚未分配工作台岗位', summaryDepartments: [], summaryOnly: false, canViewDetails: false, canExport: false }
      const policy = initial.summaryPolicies[local.chartId]
      const granted = permission.organizationSummaries?.find(g => g.chartId === local.chartId)?.departments ?? []
      const summaryDepartments = !local.visible ? [] : granted.filter(d => policy.mode === 'marketing'
        || policy.mode === 'selected' && policy.departments.includes(d.code)
        || policy.mode === 'department' && !!initial.business.departmentId && d.departmentId === initial.business.departmentId).map(d => d.code)
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
      case 'department': return !!context.initial.business.departmentId && record.department?.id === context.initial.business.departmentId
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
      if (error instanceof RmaTypeConflictError) throw new ServiceUnavailableException({ code: 'rma_type_conflict', message: 'Conflicting RMA after-sales types; verify the source records' })
      if (error instanceof FopOrganizationSummaryNotConfiguredError) throw new ServiceUnavailableException({ code: 'fop_summary_not_configured', message: 'FOP organization summary integration is not configured' })
      if (error instanceof FopPermissionDeniedError) throw new ForbiddenException({ code: error.code, message: 'FOP denied access to this employee account' })
      if (error instanceof FopIntegrationUnavailableError) {
        const realtimeMessages: Partial<Record<typeof error.code, string>> = {
          fop_queries_paused: 'FOP 测试环境数据访问已暂停，待集成方案调整后恢复。',
          fop_approval_not_configured: 'FOP 专用审核 API 尚未配置。',
          fop_current_inventory_not_configured: 'FOP 即时库存 API 尚未配置。',
          fop_reserved_inventory_not_configured: 'FOP 客户备货库存 API 尚未配置。',
          fop_supplier_contacts_not_configured: 'FOP 供应商联系专用 API 或正式实物退货来源尚未配置，请在 FOP 联系供应商。',
          fop_reserved_customers_search_required: '匹配客户过多或候选不完整，请输入更完整的客户名称或编码缩小查询范围。',
        }
        throw new ServiceUnavailableException({ code: error.code, message: realtimeMessages[error.code] ?? 'FOP query endpoint is not available' })
      }
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

  private async rmaOrders(userId: string, query: RmaFiltersDto) {
    const initial = await this.scope(userId, true)
    if (!initial.roles.includes('sales')) throw new ForbiddenException('Sales workbench access required')
    const permission = await this.permissions(userId, initial)
    if (this.provider.queriedRma) {
      // The native RMA response independently authorizes cases; exact employee facts authorize source orders.
      const data = await this.providerCall(() => this.provider.queryRmaOrders(permission.subject, permission, initial.business, query.flowStatus ?? 'active'))
      const latest = await this.permissions(userId, initial)
      if (JSON.stringify(latest.orderQuery) !== JSON.stringify(permission.orderQuery)) throw new ForbiddenException('RMA source permissions changed')
      if (data.orders.some(order => !matchesBusinessScope(initial.business, order) || !order.organization || !latest.orderQuery?.organizationIds.includes(order.organization.id))) throw new ForbiddenException('RMA source outside current account scope')
      const orders = initial.localOrganization ? data.orders.map(order => localOwnership(order, initial.localOrganization!)) : data.orders
      const paths = new Map(orders.map(order => [order.id, order.departmentPathIds ?? []]))
      const all = await this.providerCall(async () => buildRmaOrders(data.snapshot, data.permission, orders, { flowStatus: 'all' }, paths))
      const rows = await this.providerCall(async () => buildRmaOrders(data.snapshot, data.permission, orders, query, paths))
      await this.assertUnchanged(userId, initial)
      return { initial, rows, departments: initial.localOrganization ? localDepartments(initial.localOrganization) : [...new Map(all.flatMap(row => row.department ? [[row.department.id, row.department] as const] : [])).values()] }
    }
    // Missing contract differs from an explicitly authorized empty after-sales scope.
    if (permission.allowedRmaCaseIds === undefined) throw new ServiceUnavailableException({ code: 'fop_rma_not_configured', message: 'RMA read integration is not configured' })
    const snapshot = permission.allowedRmaCaseIds?.length ? await this.providerCall(() => this.provider.listRmaCases(permission.subject, permission)) : { subject: permission.subject, cases: [] }
    // Current source ownership is authoritative, including cancelled / unpaid orders.
    const current = permission.allowedRmaCaseIds?.length ? await this.scopedOrders(userId, 'sales') : { orders: [], departmentPaths: new Map<string, readonly string[]>() }
    const latest = await this.permissions(userId, initial)
    if (latest.allowedRmaCaseIds === undefined) throw new ServiceUnavailableException({ code: 'fop_rma_not_configured', message: 'RMA read integration is not configured' })
    const all = await this.providerCall(async () => buildRmaOrders(snapshot, latest, current.orders, { flowStatus: 'all' }, current.departmentPaths))
    const rows = await this.providerCall(async () => buildRmaOrders(snapshot, latest, current.orders, query, current.departmentPaths))
    await this.assertUnchanged(userId, initial)
    return { initial, rows, departments: [...new Map(all.flatMap(row => row.department ? [[row.department.id, row.department] as const] : [])).values()] }
  }

  async getRmaOrders(userId: string, query: RmaQueryDto) {
    const data = await this.rmaOrders(userId, query)
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), items: data.rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: data.rows.length, page: query.page, pageSize: query.pageSize, departments: data.departments, totals: { ...summarizeRmaOrders(data.rows), caseCount: data.rows.reduce((sum, row) => sum + row.rmaCases.length, 0) } }
  }

  async exportRmaOrders(userId: string, query: RmaExportDto, sessionVersion = 0) {
    if (query.mode === 'selected' ? !query.caseIds?.length || new Set(query.caseIds).size !== query.caseIds.length : query.mode !== 'filtered' || query.caseIds !== undefined) throw new BadRequestException('Invalid RMA selection')
    const session = async () => { const user = await this.users.findById(userId); if (!user || user.accountDisabled || (user.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Session expired') }
    await session()
    const first = await this.rmaOrders(userId, query), ids = new Set(query.caseIds)
    const choose = (rows: RmaOrder[]) => rows.filter(row => query.mode === 'filtered' || ids.has(row.id))
    const chosen = choose(first.rows)
    if (!chosen.length || query.mode === 'selected' && chosen.length !== ids.size) throw new ConflictException({ code: 'export_selection_changed' })
    const buffer = await buildRmaWorkbook(chosen, query, this.provider.source)
    await session(); await this.assertUnchanged(userId, first.initial)
    const latest = await this.rmaOrders(userId, query)
    if (JSON.stringify(choose(latest.rows)) !== JSON.stringify(chosen)) throw new ConflictException({ code: 'export_access_changed' })
    await session(); return buffer
  }

  private async purchaseReturns(userId: string, query: PurchaseReturnFiltersDto) {
    const initial = await this.scope(userId, true)
    if (!['procurement', 'warehouse'].includes(query.workbenchRole) || !initial.roles.includes(query.workbenchRole)) throw new ForbiddenException('Purchase return workbench access required')
    const permission = await this.permissions(userId, initial)
    const candidates = permission.allowedPurchaseReturnIds?.length ? await this.providerCall(() => this.provider.listPurchaseReturns(permission.subject, permission)) : { subject: permission.subject, returns: [] }
    const sources: PurchaseReturnSource[] = []
    let orders: FopOrder[] = []
    if (permission.allowedPurchaseReturnIds?.length) {
      const current = await this.scopedOrders(userId, query.workbenchRole)
      orders = current.orders
      for (const order of orders) if (order.owner && order.department) sources.push({ id: order.id, number: order.orderNumber, kind: 'fulfillment', customerName: order.customerName, owner: order.owner, department: order.department, departmentPathIds: [...(current.departmentPaths.get(order.id) ?? [])] })
    }
    const latestPermission = await this.permissions(userId, initial)
    const all = await this.providerCall(async () => buildPurchaseReturns(candidates, latestPermission, initial.business, sources))
    await this.assertUnchanged(userId, initial)
    return { initial, rows: groupPurchaseReturnOrders(all, orders, query), departments: [...new Map(all.flatMap(row => row.lines.map(line => [line.sourceOrder.department.id, line.sourceOrder.department] as const))).values()] }
  }

  /** Return contacts use the authorized return snapshot, without a pending-shipment prerequisite or another document read. */
  private async returnSupplierContact(userId: string, returnId: string, query: PurchaseReturnContactQueryDto) {
    const { rows } = await this.purchaseReturns(userId, { workbenchRole: query.workbenchRole, paidAtOrder: 'desc' })
    const order = rows.find(row => row.id === query.orderId)
    const document = order?.purchaseReturns.find(row => row.id === returnId)
    if (!order || !document) throw new NotFoundException('Purchase return not found')
    const account = document.supplier.wangwangAccount || null
    const url = document.supplierChatUrl || null
    const supplier = { ...document.supplier, wangwangAccount: account }
    const availability = !account ? 'missing_account' : url ? 'ready' : 'chat_unavailable'
    const contactVersion = createHash('sha256').update(JSON.stringify([order.id, document.id, document.purchaseOrder, document.status, supplier, url])).digest('hex')
    return { order, url, item: { purchaseOrderId: document.purchaseOrder.id, purchaseOrderNumber: document.purchaseOrder.number,
      platformOrderNumber: null, supplier, availability, contactVersion, lines: [] } }
  }

  async getReturnSupplier(userId: string, returnId: string, query: PurchaseReturnContactQueryDto) {
    const { order, item } = await this.returnSupplierContact(userId, returnId, query)
    return { source: this.provider.source ?? 'fop', orderId: order.id, orderNumber: order.orderNumber, refreshedAt: new Date().toISOString(), items: [item] }
  }

  async getReturnSupplierChat(userId: string, returnId: string, query: PurchaseReturnChatQueryDto) {
    // Re-run return/source/purchase permissions at launch, never trust the browser's cached contact.
    const { order, item, url } = await this.returnSupplierContact(userId, returnId, query)
    if (item.contactVersion !== query.contactVersion) throw new ConflictException({ code: 'supplier_contact_changed', message: '退货单或供应商信息已变化，请刷新后重新选择。' })
    if (item.availability !== 'ready' || !url) throw new ConflictException({ code: 'supplier_chat_unavailable', message: '供应商旺旺信息不完整，请在 FOP 核对。' })
    return { source: this.provider.source ?? 'fop', mode: this.provider.source === 'mock' ? 'demo' : 'live', orderId: order.id,
      purchaseOrderId: item.purchaseOrderId, wangwangAccount: item.supplier.wangwangAccount, url: this.provider.source === 'mock' ? null : url }
  }

  async getPurchaseReturns(userId: string, query: PurchaseReturnQueryDto) {
    const { rows, departments } = await this.purchaseReturns(userId, query)
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize, departments,
      totals: summarizePurchaseReturnOrders(rows) }
  }

  async exportPurchaseReturns(userId: string, query: PurchaseReturnExportDto, sessionVersion = 0) {
    if (query.mode === 'selected' ? !query.orderIds?.length || new Set(query.orderIds).size !== query.orderIds.length : query.mode !== 'filtered' || query.orderIds !== undefined) throw new BadRequestException('Invalid return selection')
    const session = async () => { const user = await this.users.findById(userId); if (!user || user.accountDisabled || (user.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Session expired') }
    await session()
    const first = await this.purchaseReturns(userId, query), ids = new Set(query.orderIds)
    const choose = (rows: PurchaseReturnOrder[]) => rows.filter(row => query.mode === 'filtered' || ids.has(row.id))
    const chosen = choose(first.rows)
    if (!chosen.length || query.mode === 'selected' && chosen.length !== ids.size) throw new ConflictException({ code: 'export_selection_changed', message: 'Return selection changed' })
    const buffer = await buildPurchaseReturnWorkbook(chosen, query, this.provider.source)
    await session(); await this.assertUnchanged(userId, first.initial)
    const current = await this.purchaseReturns(userId, query)
    if (JSON.stringify(choose(current.rows)) !== JSON.stringify(chosen)) throw new ConflictException({ code: 'export_access_changed', message: 'Return data or access changed' })
    await session()
    return buffer
  }

  async getDataAccess(userId: string) {
    const initial = await this.scope(userId, true)
    if (initial.business.role === 'none') return { binding: initial.binding, businessScope: publicBusinessScope(initial.business), status: 'denied' }
    if (!initial.binding) return { binding: null, status: 'unbound' }
    try {
      await this.permissions(userId, initial)
      return { binding: initial.binding, businessScope: publicBusinessScope(initial.business), status: 'ready', source: this.provider.source ?? 'fop', mode: this.provider.source === 'mock' ? 'demo' : 'live' }
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error
      const current = await this.scope(userId, true)
      if (!current.binding) return { binding: null, status: 'unbound' }
      const response = error instanceof ServiceUnavailableException ? error.getResponse() : null
      const code = response && typeof response === 'object' && 'code' in response ? response.code : undefined
      return {
        binding: current.binding, businessScope: publicBusinessScope(current.business),
        status: error instanceof ForbiddenException ? 'denied' : code === 'fop_not_configured' ? 'not_configured' : 'unavailable',
      }
    }
  }

  /** 请求范围覆盖图表及环比基期，详情继续用相同范围计算TopN，避免点开后人群变化。 */
  private reportRange(periods: { from: string; to: string; previousFrom?: string; previousTo?: string }[]): FopAnalyticsRange {
    const from = periods.flatMap(period => [period.from, ...(period.previousFrom ? [period.previousFrom] : [])]).sort()[0]
    const ends = periods.flatMap(period => [period.to, ...(period.previousTo ? [period.previousTo] : [])]).sort()
    const to = ends[ends.length - 1]
    return { from, to: to > businessDate(new Date()) ? businessDate(new Date()) : to }
  }

  private async analytics(userId: string, scoped: { permission: FopPermissionGrant; initial: Scope }, resource: FopAnalyticsResource, range: FopAnalyticsRange) {
    if (!scoped.permission.analyticsQuery?.[resource]?.length) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Analytics resource access denied' })
    if (range.from > businessDate(new Date())) return emptyAnalyticsData()
    const result = await this.providerCall(() => this.provider.readAnalytics(scoped.permission.subject, scoped.permission, scoped.initial.business, resource, range))
    await this.assertUnchanged(userId, scoped.initial)
    return result
  }

  private async scopedOrders(userId: string, requiredRole?: WorkbenchRole, context?: ChartContext, range?: FopAnalyticsRange, includeManagedDepartments = false): Promise<{ orders: FopOrder[]; departmentPaths: Map<string, readonly string[]>; roles: WorkbenchRole[]; permission: FopPermissionGrant; initial: Scope; range?: FopAnalyticsRange }> {
    const initial = context?.initial ?? await this.scope(userId, !context && !range)
    if (requiredRole ? !initial.roles.includes(requiredRole) : initial.roles.length === 0) {
      throw new ForbiddenException('Workbench access denied')
    }
    const permission = context?.permission ?? await this.permissions(userId, initial)
    if (this.provider.pagedOrders) {
      if (!range || !permission.analyticsQuery) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'This report is not integrated' })
      const data = await this.analytics(userId, { permission, initial }, 'orders', range)
      const orders = await this.providerCall(async () => data.orders.filter(candidate => !context || this.matchesChart(context, candidate) && this.matchesCustomer(context, candidate)).map(publicOrder))
      return { orders, departmentPaths: new Map<string, readonly string[]>(), roles: initial.roles, permission, initial, range }
    }
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
        if (!candidate || candidate.tenantId !== identity.tenantId || !allowedIds.has(candidate.id) || seen.has(candidate.id) || !matchesBusinessScope(initial.business, candidate, includeManagedDepartments)) return false
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

  async approvalContext(userId: string, queue: ApprovalQueue, orderId: string, sessionVersion = 0): Promise<Omit<FopRealtimeApprovalContext, 'targets' | 'currentScope'> & Partial<Pick<FopRealtimeApprovalContext, 'targets' | 'currentScope'>>> {
    if (!['review', 'allocation_review'].includes(queue)) throw new BadRequestException('Invalid approval queue')
    if (this.provider.source === 'fop') {
      const context = await this.realtimeContext(userId, [queue === 'review' ? 'sales' : 'allocation'])
      const assertSession = async () => { const account = await this.users.findById(userId); if (!account || account.accountDisabled || (account.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Account disabled or session expired') }
      await assertSession()
      const result = await this.providerCall(() => this.provider.readApprovalContext(context.identity, context.currentScope, queue, orderId))
      await this.assertUnchanged(userId, context.initial); await assertSession()
      if (!sameIdentity(result?.identity, context.identity) || result.order?.id !== orderId || JSON.stringify(result.currentScope) !== JSON.stringify(context.currentScope)) throw new ForbiddenException('Current approval identity or scope mismatch')
      return result
    }
    const scoped = await this.scopedOrders(userId, queue === 'review' ? 'sales' : 'allocation')
    const account = await this.users.findById(userId)
    if (!account || account.accountDisabled || (account.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Account disabled or session expired')
    if (!scoped.permission.approvalActions?.includes(queue)) throw new ForbiddenException('当前 FOP 账号无此审核操作权限')
    const order = scoped.orders.find(row => row.id === orderId)
    if (!order) throw new NotFoundException('订单不存在或无权访问')
    return { identity: { ...scoped.permission.subject }, order, inQueue: matchesQueue(order, queue) }
  }

  private async scopedReceipts(userId: string, scoped: { permission: FopPermissionGrant; initial: Scope; range?: FopAnalyticsRange }, context?: ChartContext): Promise<FopReceipt[]> {
    if (!scoped.permission.analyticsScopes?.includes('receipts')) return []
    if (this.provider.pagedOrders && scoped.range) {
      const data = await this.analytics(userId, scoped, 'receipts', scoped.range)
      return this.providerCall(async () => data.receipts.filter(candidate => !context || this.matchesChart(context, candidate) && this.matchesCustomer(context, candidate)).map(publicReceipt))
    }
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

  private async scopedFreight(userId: string, requiredRole?: WorkbenchRole, details = false, range?: FopAnalyticsRange): Promise<{ records: FopFreight[]; initial: Scope; access: EffectiveChartAccess }> {
    const context = await this.chartContext(userId, 'freight', details, requiredRole)
    const { initial, permission } = context
    if (requiredRole ? !initial.roles.includes(requiredRole) : !initial.roles.length) throw new ForbiddenException('Workbench access denied')
    if (!permission.analyticsScopes?.includes('freight')) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Freight cost access denied' })
    if (this.provider.pagedOrders && range) {
      const data = await this.analytics(userId, { permission, initial }, 'freight', range)
      return { records: await this.providerCall(async () => data.freight.filter(candidate => this.matchesChart(context, candidate)).map(publicFreight)), initial, access: context.access }
    }
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
    const allOwners = query.ownerScope === 'all'
    if (allOwners && !canSelectOwner) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Multiple salesperson access is not enabled for this account' })
    const byId = new Map<string, PerformanceOwner>()
    const knownProfits = scoped.profits.filter(row => Date.parse(row.knownAt) <= now.getTime() && (!row.approvedAt || Date.parse(row.approvedAt) <= now.getTime())
      && (row.recognitionDate ? row.recognitionDate <= businessDate(now) : row.recognitionMonth <= businessDate(now).slice(0, 7)))
    for (const row of [...eligibleReceipts(scoped.receipts, now), ...knownProfits]) {
      if (row.owner && row.department) byId.set(row.owner.id, { id: row.owner.id, name: row.owner.name, department: { id: row.department.id, name: row.department.name } })
    }
    const owners = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
    const boundId = scoped.initial.business.employeeId
    if (query.ownerId !== undefined && (canSelectOwner ? !byId.has(query.ownerId) : query.ownerId !== boundId)) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Salesperson is outside the authorized scope' })
    const ownerId = allOwners ? undefined : canSelectOwner ? query.ownerId ?? (boundId && byId.has(boundId) ? boundId : undefined) : boundId ?? undefined
    return { canSelectOwner, owners, selectedOwner: ownerId ? byId.get(ownerId) ?? null : null, ownerId,
      receipts: scoped.receipts.filter(row => allOwners || row.owner?.id === ownerId), profits: scoped.profits.filter(row => allOwners || row.owner.id === ownerId) }
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
    const { periods } = freightPeriods(query, now)
    const { records, initial, access } = await this.scopedFreight(userId, undefined, false, this.reportRange(periods))
    const result = await this.providerCall(async () => aggregateFreight(records, query, now))
    await this.assertUnchanged(userId, initial)
    return { source: this.provider.source ?? 'fop', chartAccess: access, ...result }
  }

  async getFreightDetails(userId: string, query: FreightDetailsQuery) {
    const now = new Date()
    // Validate period IDs before data fetch; malformed user filters are HTTP 400.
    freightDetails([], query, now)
    const { records, initial, access } = await this.scopedFreight(userId, query.workbenchRole, true, this.reportRange(freightPeriods(query, now).periods))
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
    const records = await this.scopedReceipts(userId, { ...context, range: { from: query.from, to: query.to } }, context)
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
    const scoped = await this.scopedOrders(userId, query.workbenchRole, context, this.reportRange(orderVolumePeriods(query)))
    if (!scoped.permission.analyticsScopes?.includes('receipts')) throw new ForbiddenException('Receipt access denied')
    const receipts = await this.scopedReceipts(userId, scoped, context)
    const rows = orderVolumeReceiptDetails(scoped.orders, receipts, query)
    await this.assertUnchanged(userId, scoped.initial)
    return { ...this.receiptPage(rows, query), chartAccess: context.access, customerOwnershipBasis: this.customerBasis(context) }
  }

  private async supplierRealtimeContext(userId: string, context: FopSupplierContext) {
    const role = context.context === 'purchase_return' ? context.workbenchRole : 'procurement'
    const filters = context.context === 'purchase_group' ? context.filters : {}
    return this.realtimeContext(userId, [role], filters)
  }

  /** Dedicated realtime contacts; never resolve historical list permissions or query a replica mirror. */
  async getRealtimeSupplierContacts(userId: string, query: FopSupplierContext) {
    const context = await this.supplierRealtimeContext(userId, query)
    const result = await this.providerCall(() => this.provider.querySupplierContacts(context.identity, context.currentScope, query))
    await this.assertUnchanged(userId, context.initial)
    return result
  }

  async getRealtimeSupplierChat(userId: string, query: FopSupplierContext, contactVersion: string, purchaseOrderId?: string) {
    const context = await this.supplierRealtimeContext(userId, query)
    const contacts = await this.providerCall(() => this.provider.querySupplierContacts(context.identity, context.currentScope, query))
    await this.assertUnchanged(userId, context.initial)
    const contact = purchaseOrderId ? contacts.items.find(row => row.purchaseOrderId === purchaseOrderId) : contacts.items.length === 1 ? contacts.items[0] : undefined
    if (!contact) throw new NotFoundException('Supplier purchase not found')
    if (contact.contactVersion !== contactVersion) throw new ConflictException({ code: 'supplier_contact_changed', message: '采购单或供应商信息已变化，请刷新后重新选择。' })
    if (contact.availability !== 'ready' || !contact.supplier.wangwangAccount) throw new ConflictException({ code: 'supplier_chat_unavailable', message: '供应商旺旺信息不完整，请在 FOP 核对。' })
    const result = await this.providerCall(() => this.provider.launchSupplierChat(context.identity, context.currentScope, { ...query, purchaseOrderId: contact.purchaseOrderId, contactVersion }))
    await this.assertUnchanged(userId, context.initial)
    if (result.wangwangAccount !== contact.supplier.wangwangAccount) throw new ConflictException({ code: 'supplier_contact_changed', message: '供应商账号已变化，请刷新后重新选择。' })
    return result
  }

  private async supplierContacts(userId: string, orderId: string) {
    const scoped = await this.scopedOrders(userId, 'procurement')
    const order = scoped.orders.find(row => row.id === orderId)
    if (!order) throw new NotFoundException('Order not found')
    const eligible = async (context: typeof scoped) => {
      const source = context.orders.find(o => o.id === orderId)
      if (!source || source.cancelled || source.paymentStatus !== 'paid') return false
      if (matchesQueue(source, 'procurement_shipping')) return true
      const links = await this.providerCall(() => this.provider.getPurchaseLinks(context.permission.subject, context.permission, [orderId]))
      return (await this.providerCall(async () => buildPurchaseGroups([source], context.departmentPaths, context.permission, links, { queue: 'procurement_shipping' }))).length > 0
    }
    if (!await eligible(scoped)) throw new ConflictException({ code: 'purchase_queue_changed', message: '该订单已不在已采购待发货清单，请刷新列表。' })
    const identity = Object.freeze({ ...scoped.permission.subject })
    const permission = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([orderId]), allowedPurchaseOrderIds: Object.freeze([...(scoped.permission.allowedPurchaseOrderIds ?? [])]) })
    const result = permission.allowedPurchaseOrderIds.length
      ? await this.providerCall(() => this.provider.listSupplierFollowUps(identity, permission, orderId))
      : { subject: identity, orderId, items: [] }
    const contacts = await this.providerCall(async () => supplierFollowUps(result, identity, permission, orderId))
    // Re-read scope and grants after the upstream request: revocation must not leak contacts.
    const current = await this.scopedOrders(userId, 'procurement')
    await this.assertUnchanged(userId, scoped.initial)
    if (!await eligible(current)) throw new ConflictException({ code: 'purchase_queue_changed', message: '订单状态或可见范围已变化，请刷新列表。' })
    const final = await this.scopedOrders(userId, 'procurement')
    await this.assertUnchanged(userId, scoped.initial)
    if (!final.orders.some(row => row.id === orderId)) throw new NotFoundException('Order not found')
    const permitted = new Set(final.permission.allowedPurchaseOrderIds ?? [])
    return { order, contacts: contacts.filter(row => permitted.has(row.purchaseOrderId)) }
  }

  private async stockSupplierContacts(userId: string, orderId: string) {
    const scoped = await this.scopedStockOrders(userId, 'procurement')
    const eligible = (context: typeof scoped) => {
      const order = context.orders.find(row => row.id === orderId)
      if (!order) throw new NotFoundException('Stock order not found')
      if (order.paymentStatus !== 'paid' || order.reviewStatus !== 'approved' || order.purchaseStatus !== 'purchased') {
        throw new ConflictException({ code: 'purchase_queue_changed', message: '该备货单已不在供应商待发货阶段，请刷新列表。' })
      }
      return order
    }
    const order = eligible(scoped)
    if (!this.provider.supportsStockSupplierFollowUp) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: '备货采购催办接口尚未配置，请在 FOP 联系供应商。' })
    const identity = Object.freeze({ ...scoped.permission.subject })
    const permission = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([] as string[]), allowedStockOrderIds: Object.freeze([orderId]), allowedPurchaseOrderIds: Object.freeze([...(scoped.permission.allowedPurchaseOrderIds ?? [])]) })
    const result = permission.allowedPurchaseOrderIds.length
      ? await this.providerCall(() => this.provider.listStockSupplierFollowUps(identity, permission, orderId))
      : { subject: identity, orderId, items: [] }
    const contacts = await this.providerCall(async () => stockSupplierFollowUps(result, identity, permission, orderId))
    const current = await this.scopedStockOrders(userId, 'procurement')
    await this.assertUnchanged(userId, scoped.initial)
    eligible(current)
    const allowed = new Set(current.permission.allowedPurchaseOrderIds ?? [])
    return { order, contacts: contacts.filter(row => allowed.has(row.purchaseOrderId)) }
  }

  async getStockSupplierFollowUps(userId: string, orderId: string) {
    const { order, contacts } = await this.stockSupplierContacts(userId, orderId)
    return { source: this.provider.source ?? 'fop', orderId, orderNumber: order.stockNumber, refreshedAt: new Date().toISOString(), items: contacts.map(({ url: _url, ...item }) => item) }
  }

  async getStockSupplierChat(userId: string, orderId: string, purchaseOrderId: string, contactVersion: string) {
    const { contacts } = await this.stockSupplierContacts(userId, orderId)
    const contact = contacts.find(row => row.purchaseOrderId === purchaseOrderId)
    if (!contact) throw new NotFoundException('Purchase not found')
    if (contact.contactVersion !== contactVersion) throw new ConflictException({ code: 'supplier_contact_changed', message: '采购单或供应商信息已变化，请刷新后重新选择。' })
    if (!contact.url || contact.availability !== 'ready') throw new ConflictException({ code: 'supplier_chat_unavailable', message: '供应商旺旺信息不完整，请在 FOP 核对。' })
    return { source: this.provider.source ?? 'fop', mode: this.provider.source === 'mock' ? 'demo' : 'live', orderId, purchaseOrderId, wangwangAccount: contact.supplier.wangwangAccount, url: this.provider.source === 'mock' ? null : contact.url }
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
    if (query.completed && (!isCompletionQueue(query.queue) || query.timeRange === 'all' || query.taskStatus || query.procurementStage || query.warehouseStage)) throw new BadRequestException('Invalid completed-list filters')
    if (query.sortBy === 'completedAt' && !query.completed) throw new BadRequestException('completedAt requires a completed list')
    if (query.sortBy && !canSortFulfillmentQueue(query.queue, query.sortBy)) throw new BadRequestException('sortBy does not match the requested queue')
    if (query.warehouseStage !== undefined && query.queue !== 'shipping') throw new BadRequestException('warehouseStage requires the shipping queue')
    if (query.taskStatus !== undefined && !canFilterTaskStatus(query.queue, query.taskStatus)) throw new BadRequestException('taskStatus does not match the requested queue')
    if (query.procurementStage !== undefined && !canFilterProcurementStage(query.queue, query.procurementStage)) throw new BadRequestException('procurementStage does not match the requested queue')
    if (query.timeRange !== undefined && (!query.completed && query.queue !== 'unpaid' || !['all', '1w', '1m', '3m'].includes(query.timeRange))) throw new BadRequestException('timeRange requires the unpaid queue')
    if (query.shippingCountryCode !== undefined && (query.queue !== 'review' || !normalizeShippingCountry(query.shippingCountryCode) || normalizeShippingCountry(query.shippingCountryCode) !== query.shippingCountryCode)) throw new BadRequestException('Invalid review destination country')
    const inTimeRange = consumerPaymentRange(query.completed ? query.timeRange ?? '1w' : query.timeRange)
    const role = FULFILLMENT_QUEUE_ROLES[query.queue]
    if (query.workbenchRole && query.workbenchRole !== role) throw new BadRequestException('workbenchRole does not match the requested queue')
    const scoped = await this.scopedOrders(userId, role, undefined, undefined, query.queue === 'dispatch')
    const { departmentPaths } = scoped
    // 待支付与其他清单复用已验权订单：管理员/总经办全部部门，经理本部门，业务员本人。
    const orders = scoped.orders
    // Derive filter options from the same permitted records, never the administrator's organization directory.
    const departments = orderDepartments(orders)
    const departmentOrders = orders.filter(order => !query.departmentId || order.department?.id === query.departmentId || departmentPaths.get(order.id)?.includes(query.departmentId))
    // Owner IDs are filters, never identity or permission grants. Options share the
    // authorized department scope and stay stable across queue/search/page changes.
    const salespeople = [...new Map(departmentOrders.filter(order => order.owner?.id).map(order => [order.owner!.id, order.owner!])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id))
    const search = query.search?.trim().toLowerCase()
    const candidates = departmentOrders.filter((order) => (query.completed ? isStageCompleted(order, query.queue) : matchesQueue(order, query.queue, query.warehouseStage))
      && inTimeRange(order.consumerPaidAt)
      && (!query.taskStatus || matchesTaskStatus(order, query.queue, query.taskStatus))
      && (!query.procurementStage || getProcurementStage(order.procurementProgress, order.fulfillmentProgress.supplierShipment) === query.procurementStage)
      && (!query.warehouseCode || order.warehouseCode === query.warehouseCode)
      && (!query.ownerId || order.owner?.id === query.ownerId)
      && (!query.orderNumber || order.orderNumber === query.orderNumber)
      && (!search || [order.orderNumber, order.shopifyOrderNumber, order.customerName, order.storeName, order.owner?.name || order.salesperson,
        ...(query.queue === 'unpaid' ? [order.customLogisticsChannelName ?? ''] : [order.carrier ?? '', order.carrierCode ?? '']), ...order.items.map((item) => item.sku)]
        .some((value) => value.toLowerCase().includes(search))))
    const shippingCountries = query.queue === 'review' ? [...new Set(candidates.map(o => normalizeShippingCountry(o.shippingCountryCode)).filter((code): code is string => code !== null))].sort() : undefined
    const filtered = candidates.filter(order => !query.shippingCountryCode || order.shippingCountryCode === query.shippingCountryCode)
      .sort((left, right) => compareFulfillmentOrders(left, right, query))
    return { filtered, departments, salespeople, shippingCountries, authorizedOrderIds: new Set(orders.map(order => order.id)), initial: scoped.initial }
  }

  private async queryWorkbenchPage(initial: Scope, permission: FopPermissionGrant, query: FopOrderPageQuery, summaryOnly = false): Promise<FopOrderPage> {
    if (this.provider.supportedOrderQueues && !this.provider.supportedOrderQueues.includes(query.queue)) {
      throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'This queue is not integrated with the Kingdee adapter' })
    }
    const org = initial.localOrganization
    if (!org) return this.providerCall(() => this.provider.queryOrders(permission.subject, permission, initial.business, query, summaryOnly))
    if (!permission.orderQuery?.queues.some(queue => queue === query.queue)) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP queue permission is required' })
    const employeeFilter = localEmployeeFilter(org, query)
    if (employeeFilter.employeeIds?.length === 0) return { source: 'fop', items: [], total: 0, page: query.page, pageSize: query.pageSize,
      totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] }, ...(query.exportManifest ? { orderIds: [] } : {}) }
    const result = await this.providerCall(() => this.provider.queryOrders(permission.subject, permission, initial.business,
      { ...query, departmentId: undefined, ownerId: undefined, employeeFilter }, summaryOnly))
    if (result.items.some(row => !matchesBusinessScope(initial.business, row)
      || employeeFilter.employeeIds !== null && (!row.owner || !employeeFilter.employeeIds.includes(row.owner.id)))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP returned orders outside the requested employee range' })
    }
    return { ...result, items: result.items.map(row => localOwnership(row, org)) }
  }

  async getOrders(userId: string, query: ListFulfillmentOrdersDto) {
    // 金蝶原有分页入口继续由上游先验权再分页，不转成仅当前页的本地汇总。
    if (this.provider.pagedOrders) {
      const role = FULFILLMENT_QUEUE_ROLES[query.queue]
      if (!role || query.workbenchRole && query.workbenchRole !== role) throw new BadRequestException('Invalid fulfillment queue or workbench role')
      // 旧金蝶分页契约尚无这些筛选/排序参数，禁止静默忽略后返回错误的清单范围。
      const unpaid = query.queue === 'unpaid'
      const dispatch = query.queue === 'dispatch'
      const salesCompleted = query.queue === 'review' && query.completed === true
      const sourcePaymentSort = query.queue === 'review' && query.sortBy === 'consumerPaidAt'
      if (query.warehouseStage || query.completed && !dispatch && !salesCompleted || query.shippingCountryCode !== undefined && (query.queue !== 'review' || !this.provider.supportsReviewCountryFilters)
        || salesCompleted && (query.taskStatus || query.procurementStage || query.timeRange && !['1w', '1m', '3m'].includes(query.timeRange)
          || query.sortBy && !['completedAt', 'paidAt', 'consumerPaidAt'].includes(query.sortBy))
        || unpaid && (query.taskStatus || query.procurementStage || query.sortBy !== undefined && !['paidAt', 'consumerPaidAt'].includes(query.sortBy))
        || dispatch && (query.procurementStage || (query.completed
          ? query.taskStatus !== undefined || query.timeRange !== undefined && !['1w', '1m', '3m'].includes(query.timeRange)
          : query.timeRange !== undefined || query.taskStatus && !canFilterTaskStatus('dispatch', query.taskStatus))
          || query.sortBy && !(query.completed ? ['completedAt', 'paidAt', 'consumerPaidAt'] : ['paidAt', 'consumerPaidAt', 'dispatchDocumentStatus']).includes(query.sortBy))
        || !unpaid && !dispatch && !salesCompleted && (!this.provider.usesLocalWorkbenchOrganization && (query.departmentId || query.ownerId) || query.sortBy && query.sortBy !== 'paidAt' && !sourcePaymentSort
          || query.timeRange !== undefined)) {
        throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'This filter or sort is not integrated with the Kingdee adapter' })
      }
      const initial = await this.scope(userId, true)
      if (!initial.roles.includes(role)) throw new ForbiddenException('Workbench access denied')
      const permission = await this.permissions(userId, initial)
      const business = initial.business
      if (unpaid && business.role === 'salesperson' && query.ownerId && query.ownerId !== business.employeeId) throw new ForbiddenException('业务员仅允许查看本人订单')
      const result = await this.queryWorkbenchPage(initial, permission, query)
      await this.assertUnchanged(userId, initial)
      return { ...result, refreshedAt: new Date().toISOString(), departments: initial.localOrganization ? localDepartments(initial.localOrganization) : result.departments ?? [], salespeople: initial.localOrganization ? localSalespeople(initial.localOrganization, query) : result.salespeople ?? [] }
    }
    const { filtered, departments, salespeople, shippingCountries } = await this.filteredOrders(userId, query)
    const start = (query.page - 1) * query.pageSize
    return { source: this.provider.source ?? 'fop', refreshedAt: new Date().toISOString(), departments, salespeople, ...(shippingCountries ? { shippingCountries } : {}), items: query.projection === 'count' ? [] : filtered.slice(start, start + query.pageSize), total: filtered.length, totals: summarizeFopOrders(filtered), page: query.page, pageSize: query.pageSize }
  }

  private async purchaseGroups(userId: string, query: PurchaseGroupFiltersDto) {
    if (query.completed && (query.purchaseStage || query.queue !== 'procurement' || query.timeRange && !['1w', '1m', '3m'].includes(query.timeRange))) throw new BadRequestException('Invalid completed purchase filters')
    if (!query.completed && query.timeRange) throw new BadRequestException('timeRange requires completed purchases')
    if (query.purchaseStage !== undefined && query.queue !== 'procurement') throw new BadRequestException('purchaseStage requires the procurement queue')
    const scoped = await this.scopedOrders(userId, 'procurement')
    const inRange = consumerPaymentRange(query.timeRange ?? '1w')
    const orders = scoped.orders.filter(o => !o.cancelled && o.paymentStatus === 'paid' && (!query.completed || isStageCompleted(o, 'procurement') && inRange(o.consumerPaidAt)))
    const snapshot = orders.length ? await this.providerCall(() => this.provider.getPurchaseLinks(scoped.permission.subject, scoped.permission, orders.map(o => o.id))) : { subject: scoped.permission.subject, orders: [] }
    await this.assertUnchanged(userId, scoped.initial)
    // Whitelist membership does not imply unchanged record ownership/department.
    const current = await this.scopedOrders(userId, 'procurement')
    await this.assertUnchanged(userId, scoped.initial)
    const requested = new Set(orders.map(o => o.id))
    const currentOrders = current.orders.filter(o => requested.has(o.id) && (!query.completed || isStageCompleted(o, 'procurement') && inRange(o.consumerPaidAt)))
    const groups = await this.providerCall(async () => buildPurchaseGroups(currentOrders, current.departmentPaths, current.permission, snapshot, query))
    const departments = [...new Map(currentOrders.filter(o => o.department && o.salesDepartmentCode).map(o => [o.department!.id, o.department!])).values()]
    return { groups, departments, initial: scoped.initial }
  }

  async getPurchaseGroups(userId: string, query: PurchaseGroupQueryDto) {
    const { groups, departments } = await this.purchaseGroups(userId, query)
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), items: groups.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map(purchaseGroupSummary), departments,
      total: groups.length, page: query.page, pageSize: query.pageSize, totals: purchaseGroupTotals(groups) }
  }

  async getPurchaseGroupDetails(userId: string, groupId: string, query: PurchaseGroupQueryDto) {
    const { groups } = await this.purchaseGroups(userId, query)
    const group = groups.find(g => g.id === groupId)
    if (!group) throw new NotFoundException('Purchase group unavailable')
    return { group: purchaseGroupSummary(group), items: group.rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: group.rows.length, page: query.page, pageSize: query.pageSize }
  }

  private async purchaseGroupContact(userId: string, groupId: string, query: PurchaseGroupFiltersDto) {
    if (query.queue !== 'procurement_shipping') throw new BadRequestException('Purchase follow-up requires pending supplier shipment')
    const initial = await this.purchaseGroups(userId, query)
    const group = initial.groups.find(g => g.id === groupId && g.purchase)
    if (!group?.purchase || !group.rows.length) throw new NotFoundException('Purchase group unavailable')
    if (group.purchase.purchaseType !== 'online' || group.purchase.platform !== '1688') throw new ConflictException({ code: 'supplier_contact_unavailable', message: '此采购类型请在 FOP 联系供应商。' })
    // A purchase has exactly one supplier. An authorized source is only the
    // server-side route to the existing contact adapter, never the dialog scope.
    const sourceId = group.rows[0].orderId
    const { contacts } = await this.supplierContacts(userId, sourceId)
    const contact = contacts.find(c => c.purchaseOrderId === group.purchase!.id)
    if (!contact) throw new ConflictException({ code: 'supplier_contact_changed', message: '采购单供应商资料不可用，请在 FOP 核对后刷新。' })
    const current = await this.purchaseGroups(userId, query)
    await this.assertUnchanged(userId, initial.initial)
    const fresh = current.groups.find(g => g.id === groupId && g.purchase)
    if (!fresh?.purchase || !fresh.rows.some(r => r.orderId === sourceId)) throw new NotFoundException('Purchase group unavailable')
    if (JSON.stringify(fresh.purchase) !== JSON.stringify(group.purchase)
      || contact.supplier.id !== fresh.purchase.supplier.id || contact.supplier.name !== fresh.purchase.supplier.name
      || contact.purchaseOrderNumber !== fresh.purchase.number || contact.platformOrderNumber !== fresh.purchase.platformOrderNumber) {
      throw new ConflictException({ code: 'supplier_contact_changed', message: '采购单或供应商信息已变化，请刷新后重试。' })
    }
    // No source-order partial quantities are presented as whole-purchase totals.
    const version = createHash('sha256').update(JSON.stringify([groupId, fresh.purchase, contact.supplier, contact.url, contact.availability])).digest('hex')
    return { ...contact, contactVersion: version, lines: [] }
  }

  async getPurchaseGroupSupplier(userId: string, groupId: string, query: PurchaseGroupFiltersDto) {
    const { url: _url, ...contact } = await this.purchaseGroupContact(userId, groupId, query)
    return { source: this.provider.source, orderId: groupId, orderNumber: contact.purchaseOrderNumber, refreshedAt: new Date().toISOString(), items: [contact] }
  }

  async getPurchaseGroupSupplierChat(userId: string, groupId: string, query: PurchaseGroupChatQueryDto) {
    const contact = await this.purchaseGroupContact(userId, groupId, query)
    if (contact.contactVersion !== query.contactVersion) throw new ConflictException({ code: 'supplier_contact_changed', message: '采购单或供应商信息已变化，请刷新后重试。' })
    if (!contact.url || contact.availability !== 'ready') throw new ConflictException({ code: 'supplier_chat_unavailable', message: '供应商旺旺信息不完整，请在 FOP 核对。' })
    return { source: this.provider.source, mode: this.provider.source === 'mock' ? 'demo' : 'live', orderId: groupId, purchaseOrderId: contact.purchaseOrderId, wangwangAccount: contact.supplier.wangwangAccount, url: this.provider.source === 'mock' ? null : contact.url }
  }

  async exportPurchaseGroups(userId: string, query: PurchaseGroupExportDto, sessionVersion = 0) {
    if (query.mode === 'selected' ? !query.groupIds?.length || query.groupIds.length > 100 || new Set(query.groupIds).size !== query.groupIds.length : query.mode !== 'filtered' || query.groupIds !== undefined) throw new BadRequestException('Invalid purchase export selection')
    const session = async () => { const user = await this.users.findById(userId); if (!user || user.accountDisabled || (user.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Session expired') }
    await session()
    const initial = await this.purchaseGroups(userId, query)
    const ids = new Set(query.groupIds)
    const chosen = initial.groups.filter(g => query.mode === 'filtered' || ids.has(g.id))
    if (!chosen.length || query.mode === 'selected' && chosen.length !== ids.size) throw new ConflictException({ code: 'purchase_groups_changed', message: '采购分组已变化，请刷新后重新选择。' })
    const buffer = await buildPurchaseGroupWorkbook(chosen, query, this.provider.source)
    await session(); await this.assertUnchanged(userId, initial.initial)
    const current = await this.purchaseGroups(userId, query)
    const fresh = current.groups.filter(g => query.mode === 'filtered' || ids.has(g.id))
    if (JSON.stringify(fresh) !== JSON.stringify(chosen)) throw new ConflictException({ code: 'purchase_groups_changed', message: '采购分组已变化，请刷新后重新导出。' })
    await session()
    return buffer
  }

  private async stockContext(userId: string, role: 'sales' | 'procurement' | 'inventory' = 'sales') {
    const initial = await this.scope(userId, true)
    if (!(role === 'inventory' ? initial.roles.some(r => r === 'sales' || r === 'procurement') : initial.roles.includes(role))) throw new ForbiddenException('Stock workbench access required')
    const permission = await this.permissions(userId, initial, true)
    if (this.provider.queriedStock && !permission.stockQuery) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'Stock query integration is not configured' })
    return { initial, permission }
  }

  private async scopedStockOrders(userId: string, role: 'sales' | 'procurement' | 'inventory' = 'sales') {
    const context = await this.stockContext(userId, role)
    const allowed = new Set(context.permission.allowedStockOrderIds ?? [])
    const queried = this.provider.queriedStock && !!context.permission.stockQuery?.orders.length
    const candidates = context.initial.localOrganization?.employeeIds?.length === 0 ? [] : allowed.size || queried ? await this.providerCall(() => this.provider.listStockOrders(context.permission.subject, context.permission, context.initial.business)) : []
    await this.assertUnchanged(userId, context.initial)
    const rows = context.initial.localOrganization ? candidates.map(row => localOwnership(row, context.initial.localOrganization!)) : candidates
    const orders = await this.providerCall(async () => {
      if (!Array.isArray(rows)) throw new Error('Invalid stock response')
      const seen = new Set<string>()
      return rows.filter(row => {
        if (!row || row.tenantId !== context.permission.subject.tenantId || !queried && !allowed.has(row.id) || !matchesBusinessScope(context.initial.business, row)) return false
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
    const queried = this.provider.queriedStock && !!context.permission.stockQuery?.inventory.length
    const candidates = context.initial.localOrganization?.employeeIds?.length === 0 ? [] : allowed.size || queried ? await this.providerCall(() => this.provider.listStockInventory(context.permission.subject, context.permission, context.initial.business)) : []
    await this.assertUnchanged(userId, context.initial)
    const rows = context.initial.localOrganization ? candidates.map(row => localOwnership(row, context.initial.localOrganization!)) : candidates
    const inventory = await this.providerCall(async () => {
      if (!Array.isArray(rows)) throw new Error('Invalid inventory response')
      const ids = new Set<string>(), groups = new Set<string>()
      return rows.filter(row => {
        if (!row || row.tenantId !== context.permission.subject.tenantId || !queried && !allowed.has(row.id) || !matchesBusinessScope(context.initial.business, row)) return false
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
    const queue = query.queue === undefined ? 'allocation' : query.queue
    if (queue !== 'allocation' && queue !== 'shipping') throw new BadRequestException('Invalid inventory queue')
    const role = queue === 'shipping' ? 'warehouse' : 'allocation'
    if (this.provider.source === 'fop') {
      const context = await this.realtimeContext(userId, [role])
      const result = await this.providerCall(() => this.provider.queryCurrentInventory(context.identity, context.currentScope, { ...query, queue }))
      await this.assertUnchanged(userId, context.initial)
      return result
    }
    const initial = await this.scope(userId, true)
    if (!initial.roles.includes(role)) throw new ForbiddenException('Inventory workbench access required')
    let permission = await this.permissions(userId, initial)
    let selected: { sku: string; warehouseCode: string; customerId: string }[] | undefined
    if (query.mode === 'selected') {
      const current = await this.scopedOrders(userId, role, undefined)
      await this.assertUnchanged(userId, initial)
      // Use the newest independent inventory grant together with the current order snapshot.
      const orders = current.orders.filter(o => query.orderIds!.includes(o.id) && matchesQueue(o, queue))
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
    if (query.queue === 'procurement' && (query.lifecycle !== undefined || query.timeRange !== undefined)) throw new BadRequestException('Stock lifecycle and creation range are available on the sales stock list only')
    const { orders, initial } = await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales')
    if (initial.localOrganization) localEmployeeFilter(initial.localOrganization, query)
    const filtered = filterStockOrders(orders, query)
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), departments: initial.localOrganization ? localDepartments(initial.localOrganization) : stockDepartments(orders), items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, totals: stockTotals(filtered), page: query.page, pageSize: query.pageSize }
  }

  async getStockCustomers(userId: string, query: StockScopeDto) {
    if (this.provider.source === 'fop') {
      const context = await this.realtimeContext(userId, ['sales', 'procurement'], query)
      const result = await this.providerCall(() => this.provider.queryReservedCustomers(context.identity, context.currentScope, query))
      await this.assertUnchanged(userId, context.initial)
      return result
    }
    const { inventory, initial } = await this.scopedStockInventory(userId)
    const { orders } = await this.scopedStockOrders(userId, 'inventory')
    await this.assertUnchanged(userId, initial)
    const search = query.search?.trim().toLowerCase()
    const customers = new Map<string, { id: string; code: string; name: string }>()
    for (const row of [...orders, ...inventory]) if (stockScopeMatches(row, query) && (!search || [row.customerCode, row.customerName].some(v => v.toLowerCase().includes(search)))) customers.set(row.customerId, { id: row.customerId, code: row.customerCode, name: row.customerName })
    const items = [...customers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    if (items.length > 100) throw new ServiceUnavailableException({ code: 'fop_reserved_customers_search_required', message: '匹配客户超过100条，请输入更完整的客户名称或编码缩小查询范围。' })
    return { items, total: items.length }
  }

  async getStockInventory(userId: string, query: StockInventoryQuery) {
    if (query.orderIds !== undefined && (!Array.isArray(query.orderIds) || !query.orderIds.length || query.orderIds.length > 100 || new Set(query.orderIds).size !== query.orderIds.length || query.orderIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200))) throw new BadRequestException('Invalid stock inventory selection')
    if (this.provider.source === 'fop') {
      const context = await this.realtimeContext(userId, query.queue === 'procurement' ? ['procurement'] : ['sales', 'procurement'], query)
      const result = await this.providerCall(() => this.provider.queryReservedInventory(context.identity, context.currentScope, query))
      await this.assertUnchanged(userId, context.initial)
      return result
    }
    const selected = query.orderIds ? await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales') : undefined
    const { inventory, initial, permission } = await this.scopedStockInventory(userId)
    let pairs: Set<string> | undefined
    if (selected) {
      await this.assertUnchanged(userId, selected.initial)
      const ids = new Set(query.orderIds)
      const currentAllowed = new Set(permission.allowedStockOrderIds ?? [])
      const orders = filterStockOrders(selected.orders, { queue: query.queue }).filter(row => ids.has(row.id) && (this.provider.queriedStock && !!permission.stockQuery?.orders.length || currentAllowed.has(row.id)))
      if (orders.length !== ids.size) throw new ConflictException({ code: 'stock_inventory_orders_changed', message: 'Selected stock orders changed; refresh and select again' })
      // Keep each customer's SKU set separate; never cross-join customers and SKUs.
      pairs = new Set(orders.flatMap(row => row.items.map(item => JSON.stringify([row.customerId, item.sku]))))
    }
    const search = query.search?.trim().toLowerCase()
    const customerSearch = query.customerSearch?.trim().toLowerCase()
    const filtered = inventory.filter(row => (pairs ? pairs.has(JSON.stringify([row.customerId, row.sku])) : !!initial.business.employeeId && row.owner.id === initial.business.employeeId)
      && (!query.customerId || row.customerId === query.customerId) && (!customerSearch || [row.customerCode, row.customerName].some(v => v.toLowerCase().includes(customerSearch))) && stockScopeMatches(row, query) && (!search || [row.sku, row.name].some(v => v.toLowerCase().includes(search))))
      .map(publicStockInventory).sort((a, b) => a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId) || a.sku.localeCompare(b.sku) || a.warehouseCode.localeCompare(b.warehouseCode) || a.id.localeCompare(b.id))
    return { source: this.provider.source, refreshedAt: new Date().toISOString(), customerId: query.customerId ?? null, items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize }
  }

  async exportStockOrders(userId: string, query: ExportStockOrdersDto, sessionVersion = 0): Promise<Buffer> {
    if (query.queue === 'procurement' && (query.lifecycle !== undefined || query.timeRange !== undefined)) throw new BadRequestException('Stock lifecycle and creation range are available on the sales stock list only')
    if (query.mode === 'selected' ? !query.orderIds?.length || query.orderIds.length > 100 || new Set(query.orderIds).size !== query.orderIds.length : query.mode !== 'filtered' || query.orderIds !== undefined) throw new BadRequestException('Invalid stock export selection')
    const assertSession = async () => {
      const user = await this.users.findById(userId)
      if (!user || user.accountDisabled || (user.sessionVersion ?? 0) !== sessionVersion) throw new UnauthorizedException('Session expired')
    }
    await assertSession()
    const initial = await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales')
    const asOf = Date.now()
    const filtered = filterStockOrders(initial.orders, query as StockFilters, asOf)
    const selected = new Set(query.orderIds)
    const rows = query.mode === 'selected' ? filtered.filter(row => selected.has(row.id)) : filtered
    if (query.mode === 'selected' && rows.length !== selected.size) throw new ConflictException({ code: 'export_selection_changed', message: '所选备货单已变化，请刷新。' })
    if (!rows.length) throw new ConflictException({ code: 'export_empty', message: '没有可导出的备货单。' })
    const buffer = await buildStockWorkbook(rows, this.provider.source, query.queue !== 'procurement', query)
    const latest = await this.scopedStockOrders(userId, query.queue === 'procurement' ? 'procurement' : 'sales')
    await this.assertUnchanged(userId, initial.initial)
    const current = new Set(filterStockOrders(latest.orders, query, asOf).map(row => row.id))
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
    if (this.provider.pagedOrders && query.queue === 'dispatch') return this.exportPagedDispatch(userId, query, assertSession)
    if (this.provider.pagedOrders && ['unpaid','review'].includes(query.queue)) return this.exportSalesCompleted(userId, query, assertSession)
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

  private async exportSalesCompleted(userId: string, query: ExportFulfillmentOrdersDto, assertSession: () => Promise<void>): Promise<Buffer> {
    if (query.taskStatus || query.procurementStage || query.warehouseStage || query.completed && query.timeRange === 'all'
      || query.sortBy && !['completedAt', 'paidAt', 'consumerPaidAt'].includes(query.sortBy)) throw new BadRequestException('Invalid sales completion export')
    const initial = await this.scope(userId, true)
    if (!initial.roles.includes('sales') || query.workbenchRole && query.workbenchRole !== 'sales') throw new ForbiddenException('Sales workbench access required')
    const base = { ...query, page: 1, pageSize: 10000, exportManifest: true }
    const read = async () => {
      const permission = await this.permissions(userId, initial)
      const page = await this.queryWorkbenchPage(initial, permission, base)
      await this.assertUnchanged(userId, initial)
      if (page.items.length !== page.total) throw new BadRequestException('单次最多导出10,000笔订单，请缩小范围。')
      if (query.mode === 'selected' && page.items.length !== query.orderIds!.length) throw new ConflictException({ code: 'export_selection_changed', message: '所选已完成订单已变化，请刷新后重选。' })
      return page.items
    }
    const rows = await read()
    if (!rows.length) throw new ConflictException({ code: 'export_empty', message: '当前筛选下没有可导出的已完成订单。' })
    if (rows.reduce((count, row) => count + row.items.length, 0) > 50000) throw new BadRequestException('单次最多导出50,000行商品，请缩小范围。')
    const buffer = await buildFulfillmentWorkbook(rows, query, this.provider.source)
    await assertSession()
    const latest = new Set((await read()).map(row => row.id))
    if (rows.length !== latest.size || rows.some(row => !latest.has(row.id))) throw new ConflictException({ code: 'export_selection_changed', message: '已完成订单或权限已变化，请刷新后导出。' })
    await assertSession()
    return buffer
  }

  /** 导出固定首次ID清单，再按ID读取；同步移出导致的页码前移不能静默漏单。 */
  private async exportPagedDispatch(userId: string, query: ExportFulfillmentOrdersDto, assertSession: () => Promise<void>): Promise<Buffer> {
    if (query.warehouseStage || query.procurementStage || query.shippingCountryCode
      || (query.completed ? query.taskStatus !== undefined || query.timeRange !== undefined && !['1w', '1m', '3m'].includes(query.timeRange)
        : query.timeRange !== undefined || query.taskStatus && !canFilterTaskStatus('dispatch', query.taskStatus))
      || query.sortBy && !(query.completed ? ['completedAt', 'paidAt', 'consumerPaidAt'] : ['paidAt', 'consumerPaidAt', 'dispatchDocumentStatus']).includes(query.sortBy)) throw new BadRequestException('Invalid dispatch export filters')
    const initial = await this.scope(userId, true)
    if (!initial.roles.includes('dispatch') || query.workbenchRole && query.workbenchRole !== 'dispatch') throw new ForbiddenException('Workbench access denied')
    const permission = await this.permissions(userId, initial)
    const base = { ...query, page: 1, pageSize: 100, orderIds: undefined }
    const manifest = async () => {
      const result = await this.queryWorkbenchPage(initial, permission, { ...base, exportManifest: true }, true)
      if (!result.orderIds || result.orderIds.length !== result.total) throw new ServiceUnavailableException('Invalid export manifest')
      return result.orderIds
    }
    const ids = query.mode === 'selected' ? [...query.orderIds!] : await manifest()
    if (!ids.length) throw new ConflictException({ code: 'export_empty', message: '当前筛选下没有可导出的订单。' })
    const read = async () => {
      const rows: FopOrder[] = []
      for (let start = 0; start < ids.length; start += 100) {
        await assertSession()
        const batch = ids.slice(start, start + 100)
        const page = await this.queryWorkbenchPage(initial, permission, { ...base, orderIds: batch })
        const returned = new Map(page.items.map(row => [row.id, row]))
        if (page.total !== batch.length || returned.size !== batch.length || batch.some(id => !returned.has(id))) {
          throw new ConflictException({ code: 'export_selection_changed', message: '订单状态或权限已变化，请刷新后重新导出。' })
        }
        rows.push(...batch.map(id => returned.get(id)!))
        if (rows.reduce((count, row) => count + row.items.length, 0) > 50000) throw new BadRequestException('单次最多导出50,000行商品，请缩小范围。')
      }
      return rows
    }
    const rows = await read()
    const buffer = await buildFulfillmentWorkbook(rows, query, this.provider.source)
    await this.assertUnchanged(userId, initial)
    // 返回文件前重新解析平台授权；授权缩减不能沿用最初的grant。
    const latestPermission = await this.permissions(userId, initial)
    if (!latestPermission.orderQuery?.queues.includes('dispatch')
      || JSON.stringify(latestPermission.orderQuery) !== JSON.stringify(permission.orderQuery)) throw new ForbiddenException('Export grants changed')
    if (query.mode === 'filtered') {
      const current = await manifest(), original = new Set(ids)
      if (current.length !== ids.length || current.some(id => !original.has(id))) throw new ConflictException({ code: 'export_selection_changed', message: '待履约清单已变化，请刷新后重新导出。' })
    }
    await read()
    await this.assertUnchanged(userId, initial)
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
    const scoped = await this.scopedOrders(userId, undefined, context, this.reportRange(orderVolumePeriods(query)))
    const receipts = query.category === 'customer' && scoped.permission.analyticsScopes?.includes('receipts') ? await this.scopedReceipts(userId, scoped, context) : undefined
    const result = aggregateOrderVolume(scoped.orders, query, now, receipts)
    if (query.category === 'organization' && result.series[0]) result.series[0].label = context.access.dataScope === 'self' ? '本人订单合计' : '当前成员订单合计'
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: context.access, summaryOnly: false, ...(chartId === 'customer_orders' ? { customerOwnershipBasis: this.customerBasis(context) } : {}), ...result }
  }

  async searchOrderCustomers(userId: string, query: OrderCustomerSearchDto) {
    const context = await this.chartContext(userId, 'customer_orders')
    const scoped = await this.scopedOrders(userId, undefined, context, { from: '2020-01-01', to: businessDate(new Date()), keyword: query.keyword })
    const receipts = await this.scopedReceipts(userId, scoped, context)
    const result = searchOrderCustomers(scoped.orders, query, receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: context.access, customerOwnershipBasis: this.customerBasis(context), ...result }
  }

  async getOrderVolumeDetails(userId: string, query: OrderVolumeDetailsDto) {
    if (query.view === 'summary') throw new ForbiddenException({ code: 'chart_access_denied', message: 'Organization summaries do not grant order details' })
    const chartId = query.category === 'customer' ? 'customer_orders' : 'order_volume'
    const context = await this.chartContext(userId, chartId, true, query.workbenchRole)
    const scoped = await this.scopedOrders(userId, query.workbenchRole, context, this.reportRange(orderVolumePeriods(query)))
    const receipts = query.category === 'customer' ? await this.scopedReceipts(userId, scoped, context) : []
    const rows = orderVolumeDetails(scoped.orders, query, new Date(), receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', chartAccess: context.access, ...(chartId === 'customer_orders' ? { customerOwnershipBasis: this.customerBasis(context) } : {}), total: rows.length, totals: summarizeFopOrders(rows), page: query.page, pageSize: query.pageSize, items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
  }

  async getDashboard(userId: string, query: FopDashboardQueryDto, local?: LocalWorkbenchService) {
    const start = Date.parse(`${query.from}T00:00:00Z`)
    const end = Date.parse(`${query.to}T00:00:00Z`)
    const now = new Date()
    const day = 86_400_000
    if (!Number.isFinite(start) || !Number.isFinite(end)
      || new Date(start).toISOString().slice(0, 10) !== query.from || new Date(end).toISOString().slice(0, 10) !== query.to
      || start > end || end - start > 365 * day || query.to > businessDate(now) || query.year > Number(businessDate(now).slice(0, 4))) {
      throw new BadRequestException('Invalid dashboard date range or year')
    }
    if (this.provider.pagedOrders) {
      const initial = await this.scope(userId)
      if (!initial.roles.length) throw new ForbiddenException('Workbench access denied')
      const permission = await this.permissions(userId, initial)
      const chartAccess = this.effectiveCharts(initial, permission)
      const chartContext = (chartId: ChartId): ChartContext => ({ chartId, initial, permission, access: chartAccess.find(chart => chart.chartId === chartId)! })
      const registrationContext = chartContext('registrations')
      const receiptContext = chartContext('salesperson_receipts')
      // Card counts use the same published local lists. Independent analytics stays on its own APIs.
      const pending = await dashboardQueues(query.includeQueues === false ? [] : initial.roles, async queue => {
        if (!local?.enabled) return null
        return (await local.getOrders(userId, { queue, projection: 'count', page: 1, pageSize: 1 })).total
      })
      await this.assertUnchanged(userId, initial)
      let registration: ReturnType<typeof aggregateRegistrations> = { registrations: [], registrationDepartments: [] }
      const receiptsEnabled = !!permission.analyticsQuery?.receipts?.length && !!permission.analyticsScopes?.includes('receipts') && receiptContext.access.visible && receiptContext.access.dataScope !== 'none'
      let receiptRecords: FopReceipt[] = []
      if (permission.analyticsQuery?.registrations?.length && permission.analyticsScopes?.includes('registrations') && registrationContext.access.visible && registrationContext.access.dataScope !== 'none') {
        const facts = await this.analytics(userId, { permission, initial }, 'registrations', { from: query.from, to: query.to })
        // 先按日期、部门、业务员合并注册事件，再复用既有图表聚合契约。
        const entries = new Map<string, { date: string; salesDepartmentCode: typeof facts.registrations[number]['salesDepartmentCode']; owner: { id: string; name: string }; count: number }>()
        for (const fact of facts.registrations) {
          if (!this.matchesChart(registrationContext, fact)) continue
          const date = businessDate(fact.registeredAt), key = JSON.stringify([date, fact.salesDepartmentCode, fact.owner.id])
          const entry = entries.get(key)
          if (entry) entry.count++
          else entries.set(key, { date, salesDepartmentCode: fact.salesDepartmentCode, owner: fact.owner, count: 1 })
        }
        registration = await this.providerCall(async () => aggregateRegistrations([...entries.values()], query.from, query.to))
      }
      if (receiptsEnabled) {
        receiptRecords = await this.scopedReceipts(userId, { permission, initial, range: { from: `${query.year - 1}-12-01`, to: query.year === Number(businessDate(now).slice(0, 4)) ? businessDate(now) : `${query.year}-12-31` } }, receiptContext)
      }
      const receipts = await this.providerCall(async () => monthlyReceipts(receiptRecords, query.year, receiptsEnabled, now))
      if (receipts.marketingCenter) receipts.marketingCenter.name = receiptContext.access.dataScope === 'self' ? '本人回款合计' : '当前成员回款合计'
      await this.assertUnchanged(userId, initial)
      return { businessScope: initial.business, source: 'fop' as const, updatedAt: now.toISOString(),
        ...pending, analyticsConfigured: !!permission.analyticsQuery,
        rates: [], ...registration, exceptions: [],
        receipts, chartAccess, departmentReceipts: monthlyReceipts([], query.year, false, now) }
    }
    const scoped = await this.scopedOrders(userId)
    // Date controls belong to registrations/receipts, not the current pending queues.
    const orders = scoped.orders
    const allowed = (queue: Queue) => scoped.roles.includes(FULFILLMENT_QUEUE_ROLES[queue])
    // The legacy dispatch list explicitly includes descendant departments; other lists and charts do not.
    const dispatchScoped = !local && query.includeQueues !== false && allowed('dispatch') && scoped.initial.business.role === 'department_manager' && !scoped.initial.localOrganization
      ? await this.scopedOrders(userId, 'dispatch', undefined, undefined, true) : scoped
    const pendingOrders = (queue: Queue) => (queue === 'dispatch' ? dispatchScoped.orders : orders).filter(order => matchesQueue(order, queue))
    const pending = await dashboardQueues(query.includeQueues === false ? [] : scoped.roles, async queue => local?.enabled
      ? (await local.getOrders(userId, { queue, projection: 'count', page: 1, pageSize: 1 })).total : pendingOrders(queue).length)
    for (const task of local ? [] : pending.tasks) {
      const oldest = DASHBOARD_QUEUES[task.kind].flatMap(queue => pendingOrders(queue)).map(paymentTime).filter(Number.isFinite).sort((a, b) => a - b)[0]
      task.time = oldest === undefined ? '' : new Date(oldest + 8 * 3_600_000).toISOString().slice(11, 16)
    }
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
      businessScope: scoped.initial.business, source: this.provider.source ?? 'fop', updatedAt: now.toISOString(), ...pending, rates, ...registrationData,
      exceptions: allowed('exceptions') ? orders.filter((order) => matchesQueue(order, 'exceptions'))
        .sort(comparePaymentTime)
        .map((order) => ({ id: order.orderNumber, customer: order.customerName, type: order.exception!.type, reason: order.exception!.reason, hours: order.exception!.hours })) : [],
      receipts, departmentReceipts, chartAccess,
    }
  }
}

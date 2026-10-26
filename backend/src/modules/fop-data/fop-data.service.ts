import { aggregateFreight, freightDetails, freightPeriods, publicFreight } from './fop-freight'
import type { FopFreight, FreightQuery, FreightDetailsQuery } from './fop-freight.types'
import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { isWorkbenchRole, WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { FULFILLMENT_QUEUE_ROLES, ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'
import { FopDashboardQueryDto } from './fop-data.dto'
import { FOP_DATA_PROVIDER, FopDataProvider, FopIdentity, FopIntegrationUnavailableError, FopOrder, FopOrderCandidate, FopPermissionDeniedError, FopPermissionGrant, FopReceipt, FopAnalyticsRange, FopAnalyticsResource } from './fop-data.types'

import { businessScope, matchesBusinessScope, BusinessScope } from '../users/business-scope'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from './order-volume.dto'
import { aggregateOrderVolume, orderVolumeDetails, orderVolumeReceiptDetails, searchOrderCustomers, orderVolumePeriods } from './order-volume'
import { aggregateRegistrations } from './fop-registration'
import { summarizeFopOrders } from './fop-order-totals'

import { eligibleReceipts, monthlyReceipts, publicReceipt, summarizeReceipts } from './fop-receipts'
import { businessDate, BUSINESS_TIME_ZONE, validBusinessDay } from './fop-business-time'
import { ReceiptQueryDto } from './fop-receipts.dto'
import { emptyAnalyticsData } from './fop-kingdee.analytics'
import { ConfirmFopConnectionDto } from './fop-connection.dto'

type Queue = keyof typeof FULFILLMENT_QUEUE_ROLES
type Scope = { binding: FopIdentity | null; roles: WorkbenchRole[]; business: BusinessScope }

function matchesQueue(order: FopOrder, queue: Queue): boolean {
  if (order.cancelled || order.paymentStatus === 'refunded') return false
  switch (queue) {
    case 'review': return order.reviewStatus === 'pending'
    case 'procurement': return order.reviewStatus === 'approved' && order.paymentStatus === 'paid' && order.procurementStatus === 'pending'
    case 'allocation': return order.reviewStatus === 'approved' && order.paymentStatus === 'paid' && order.allocationStatus === 'pending'
    case 'dispatch': return order.paymentStatus === 'paid' && order.allocationStatus === 'allocated' && order.dispatchStatus === 'pending'
    case 'shipping': return order.paymentStatus === 'paid' && order.dispatchStatus === 'dispatched' && order.shippingStatus === 'pending'
    case 'exceptions': return order.paymentStatus === 'paid' && order.shippingStatus !== 'shipped' && order.exception !== null
  }
}

function sameIdentity(left: FopIdentity | null | undefined, right: FopIdentity | null | undefined): boolean {
  return !!left && !!right && left.tenantId === right.tenantId && left.userId === right.userId
}

// Only the reviewed client contract is serialized, never arbitrary provider metadata.
function publicOrder(order: FopOrderCandidate): FopOrder {
  if (order.reviewStatus === 'approved' && (!['HZ', 'SZ'].includes(order.warehouseCode ?? '') || !['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER'].includes(order.carrierCode ?? ''))) {
    throw new Error('Approved fulfillment requires mapped warehouse and logistics channel')
  }
  return {
    ...(order.salesDepartmentCode ? { salesDepartmentCode: order.salesDepartmentCode } : {}),
    id: order.id, orderNumber: order.orderNumber, shopifyOrderNumber: order.shopifyOrderNumber,
    customerId: order.customerId, customerCode: order.customerCode, warehouseCode: order.warehouseCode, carrierCode: order.carrierCode,
    customerName: order.customerName, storeName: order.storeName,
    items: order.items.map(({ sku, name, imageUrl, variant, quantity, productId }) => ({ sku, name, imageUrl, variant, quantity, ...(productId ? { productId } : {}) })),
    ...(order.organization ? { organization: { id: order.organization.id, name: order.organization.name } } : {}),
    ...(order.department ? { department: { id: order.department.id, name: order.department.name } } : {}),
    ...(order.owner ? { owner: { id: order.owner.id, name: order.owner.name } } : {}),
    amount: order.amount, currency: order.currency?.trim().toUpperCase() || 'USD', paymentStatus: order.paymentStatus,
    reviewStatus: order.reviewStatus, procurementStatus: order.procurementStatus,
    allocationStatus: order.allocationStatus, dispatchStatus: order.dispatchStatus, shippingStatus: order.shippingStatus,
    warehouse: order.warehouse, carrier: order.carrier, trackingNumber: order.trackingNumber,
    salesperson: order.salesperson, createdAt: order.createdAt, paidAt: order.paidAt, cancelled: order.cancelled,
    exception: order.exception ? { reason: order.exception.reason, hours: order.exception.hours } : null,
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
    if (user.role !== 'admin' || user.businessRole !== 'admin') throw new ForbiddenException('Company administrator access required')
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
    const initial = await this.requireConnectionAdmin(userId)
    const connection = await this.testConnection(userId)
    if (!sameIdentity(connection.subject, expected) || connection.currentOrganization.id !== expected.organizationId) {
      throw new ForbiddenException({ code: 'fop_binding_changed', message: 'Kingdee identity or company changed; test the connection again' })
    }
    const binding = initial.fopTenantId && initial.fopUserId ? { tenantId: initial.fopTenantId, userId: initial.fopUserId } : null
    return this.users.connectCurrentAdminFop(userId, binding, connection.subject)
  }

  private async scope(userId: string): Promise<Scope> {
    const user = await this.users.findById(userId)
    if (!user) throw new UnauthorizedException('Account no longer exists')
    return {
      business: businessScope(user),
      binding: this.provider.demoIdentity?.(userId) ?? (user.fopTenantId && user.fopUserId ? { tenantId: user.fopTenantId, userId: user.fopUserId } : null),
      roles: businessScope(user).role === 'none' ? [] : businessScope(user).role === 'admin' ? [...WORKBENCH_ROLES] : (user.workbenchRoles ?? []).filter(isWorkbenchRole),
    }
  }

  private async assertUnchanged(userId: string, initial: Scope): Promise<void> {
    const current = await this.scope(userId)
    if (JSON.stringify(current.business) !== JSON.stringify(initial.business)
      || ((current.binding !== null || initial.binding !== null) && !sameIdentity(current.binding, initial.binding))
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
    const grant = await this.providerCall(() => this.provider.resolvePermissions(identity, initial.business))
    await this.assertUnchanged(userId, initial)
    if (!sameIdentity(grant?.subject, identity) || !Array.isArray(grant?.allowedOrderIds)
      || grant.allowedOrderIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'FOP permissions do not authorize this account identity' })
    }
    if (grant.allowedReceiptIds !== undefined && (!Array.isArray(grant.allowedReceiptIds) || grant.allowedReceiptIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP receipt permissions' })
    }
    if (grant.allowedFreightIds !== undefined && (!Array.isArray(grant.allowedFreightIds) || grant.allowedFreightIds.some(id => typeof id !== 'string' || !id.trim()))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP freight permissions' })
    }
    if (grant.analyticsScopes !== undefined && (!Array.isArray(grant.analyticsScopes) || grant.analyticsScopes.some(scope => !['rates', 'registrations', 'receipts', 'freight'].includes(scope)))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP analytics permissions' })
    }
    if (grant.orderQuery && (grant.orderQuery.queues?.length !== 1 || grant.orderQuery.queues[0] !== 'review'
      || !Array.isArray(grant.orderQuery.organizationIds) || !grant.orderQuery.organizationIds.length
      || grant.orderQuery.organizationIds.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id)))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP query grant' })
    }
    if (grant.analyticsQuery && (typeof grant.analyticsQuery !== 'object' || Array.isArray(grant.analyticsQuery)
      || Object.entries(grant.analyticsQuery).some(([resource, ids]) => !['orders', 'receipts', 'registrations', 'freight'].includes(resource)
        || !Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[1-9]\d{0,18}$/.test(id))))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP analytics query grant' })
    }
    return { subject: { ...identity }, allowedOrderIds: [...new Set(grant.allowedOrderIds)], allowedReceiptIds: [...new Set(grant.allowedReceiptIds ?? [])], allowedFreightIds: [...new Set(grant.allowedFreightIds ?? [])], analyticsScopes: [...new Set(grant.analyticsScopes ?? [])],
      ...(grant.analyticsQuery ? { analyticsQuery: Object.fromEntries(Object.entries(grant.analyticsQuery).map(([resource, ids]) => [resource, [...ids]])) } : {}),
      ...(grant.orderQuery ? { orderQuery: { queues: ['review'] as const, organizationIds: [...grant.orderQuery.organizationIds] } } : {}) }
  }

  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof FopPermissionDeniedError) throw new ForbiddenException({ code: error.code, message: 'FOP denied access to this employee account' })
      if (error instanceof FopIntegrationUnavailableError) throw new ServiceUnavailableException({ code: error.code, message: 'FOP query endpoint is not available' })
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

  private async scopedOrders(userId: string, requiredRole?: WorkbenchRole, range?: FopAnalyticsRange): Promise<{ orders: FopOrder[]; roles: WorkbenchRole[]; permission: FopPermissionGrant; initial: Scope; range?: FopAnalyticsRange }> {
    const initial = await this.scope(userId)
    if (requiredRole ? !initial.roles.includes(requiredRole) : initial.roles.length === 0) {
      throw new ForbiddenException('Workbench access denied')
    }
    const permission = await this.permissions(userId, initial)
    if (this.provider.pagedOrders) {
      if (!range || !permission.analyticsQuery) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured', message: 'This report is not integrated' })
      const data = await this.analytics(userId, { permission, initial }, 'orders', range)
      const orders = await this.providerCall(async () => data.orders.map(publicOrder))
      return { orders, roles: initial.roles, permission, initial, range }
    }
    const allowedIds = new Set(permission.allowedOrderIds)
    if (!allowedIds.size) return { orders: [], roles: initial.roles, permission, initial }
    const identity = Object.freeze({ ...permission.subject })
    const grant = Object.freeze({ subject: identity, allowedOrderIds: Object.freeze([...permission.allowedOrderIds]) })
    const candidates = await this.providerCall(() => this.provider.listOrders(identity, grant))
    await this.assertUnchanged(userId, initial)
    return this.providerCall(async () => {
      if (!Array.isArray(candidates)) throw new Error('Invalid FOP order response')
      const seen = new Set<string>()
      const orders = candidates.filter((candidate) => {
        if (!candidate || candidate.tenantId !== identity.tenantId || !allowedIds.has(candidate.id) || seen.has(candidate.id) || !matchesBusinessScope(initial.business, candidate)) return false
        seen.add(candidate.id)
        return true
      }).map(publicOrder)
      return { orders, roles: initial.roles, permission, initial }
    })
  }

  private async scopedReceipts(userId: string, scoped: { permission: FopPermissionGrant; initial: Scope; range?: FopAnalyticsRange }): Promise<FopReceipt[]> {
    if (!scoped.permission.analyticsScopes?.includes('receipts')) return []
    if (this.provider.pagedOrders && scoped.range) {
      const data = await this.analytics(userId, scoped, 'receipts', scoped.range)
      return this.providerCall(async () => data.receipts.map(publicReceipt))
    }
    const allowed = new Set(scoped.permission.allowedReceiptIds ?? [])
    if (!allowed.size) return []
    const identity = Object.freeze({ ...scoped.permission.subject })
    const grant = Object.freeze({ ...scoped.permission, subject: identity, allowedOrderIds: Object.freeze([...scoped.permission.allowedOrderIds]), allowedReceiptIds: Object.freeze([...allowed]) })
    const candidates = await this.providerCall(() => this.provider.listReceipts(identity, grant))
    await this.assertUnchanged(userId, scoped.initial)
    return this.providerCall(async () => {
      if (!Array.isArray(candidates)) throw new Error('Invalid FOP receipt response')
      const seen = new Set<string>()
      return candidates.filter(candidate => {
        if (!candidate || candidate.tenantId !== identity.tenantId || !allowed.has(candidate.id) || !matchesBusinessScope(scoped.initial.business, candidate)) return false
        if (seen.has(candidate.id)) throw new Error('Duplicate authorized receipt ID')
        seen.add(candidate.id)
        return true
      }).map(publicReceipt)
    })
  }

  private async scopedFreight(userId: string, requiredRole?: WorkbenchRole, range?: FopAnalyticsRange): Promise<{ records: FopFreight[]; initial: Scope }> {
    const initial = await this.scope(userId)
    if (requiredRole ? !initial.roles.includes(requiredRole) : !initial.roles.length) throw new ForbiddenException('Workbench access denied')
    const permission = await this.permissions(userId, initial)
    if (!permission.analyticsScopes?.includes('freight')) throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Freight cost access denied' })
    if (this.provider.pagedOrders && range) {
      const data = await this.analytics(userId, { permission, initial }, 'freight', range)
      return { records: await this.providerCall(async () => data.freight.map(publicFreight)), initial }
    }
    const allowed = new Set(permission.allowedFreightIds ?? [])
    if (!allowed.size) return { records: [], initial }
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
        if (!matchesBusinessScope(initial.business, candidate)) return false
        if (seen.has(candidate.id)) throw new Error('Duplicate authorized freight ID')
        seen.add(candidate.id)
        return true
      }).map(publicFreight)
    })
    return { records, initial }
  }

  async getFreight(userId: string, query: FreightQuery) {
    const now = new Date()
    const { periods } = freightPeriods(query, now)
    const { records, initial } = await this.scopedFreight(userId, undefined, this.reportRange(periods))
    const result = await this.providerCall(async () => aggregateFreight(records, query, now))
    await this.assertUnchanged(userId, initial)
    return { source: this.provider.source ?? 'fop', ...result }
  }

  async getFreightDetails(userId: string, query: FreightDetailsQuery) {
    const now = new Date()
    // Validate period IDs before data fetch; malformed user filters are HTTP 400.
    freightDetails([], query, now)
    const { records, initial } = await this.scopedFreight(userId, query.workbenchRole, this.reportRange(freightPeriods(query, now).periods))
    const result = await this.providerCall(async () => freightDetails(records, query, now))
    await this.assertUnchanged(userId, initial)
    return { source: this.provider.source ?? 'fop', ...result }
  }

  private receiptPage(rows: FopReceipt[], query: { page: number; pageSize: number }) {
    const usd = rows.filter(row => row.currency === 'USD').sort((a, b) => Date.parse(b.paidAt!) - Date.parse(a.paidAt!) || a.id.localeCompare(b.id))
    return { source: this.provider.source ?? 'fop', timeZone: BUSINESS_TIME_ZONE, total: usd.length, totals: summarizeReceipts(usd), page: query.page, pageSize: query.pageSize, items: usd.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
  }

  async getReceipts(userId: string, query: ReceiptQueryDto) {
    if (!validBusinessDay(query.from) || !validBusinessDay(query.to) || query.from < '2020-01-01' || query.from > query.to || query.to > businessDate(new Date())) throw new BadRequestException('Invalid receipt date range')
    const initial = await this.scope(userId)
    if (query.workbenchRole ? !initial.roles.includes(query.workbenchRole) : !initial.roles.length) throw new ForbiddenException('Workbench access denied')
    const scoped = { initial, permission: await this.permissions(userId, initial), range: { from: query.from, to: query.to } }
    if (!scoped.permission.analyticsScopes?.includes('receipts')) throw new ForbiddenException('Receipt access denied')
    const records = await this.scopedReceipts(userId, scoped)
    const rows = eligibleReceipts(records).filter(r => businessDate(r.paidAt!) >= query.from && businessDate(r.paidAt!) <= query.to
      && (!query.department || r.salesDepartmentCode === query.department) && (!query.ownerId || r.owner?.id === query.ownerId)
      && (!query.customerId || r.customerId === query.customerId) && (query.warehouse === 'ALL' || r.warehouseCode === query.warehouse)
      && (!query.sourceType || r.sourceType === query.sourceType))
    await this.assertUnchanged(userId, scoped.initial)
    return this.receiptPage(rows, query)
  }

  async getOrderVolumeReceipts(userId: string, query: OrderVolumeDetailsDto) {
    if (query.category !== 'customer') throw new BadRequestException('Receipt cohort requires customer category')
    const scoped = await this.scopedOrders(userId, query.workbenchRole, this.reportRange(orderVolumePeriods(query)))
    if (!scoped.permission.analyticsScopes?.includes('receipts')) throw new ForbiddenException('Receipt access denied')
    const receipts = await this.scopedReceipts(userId, scoped)
    const rows = orderVolumeReceiptDetails(scoped.orders, receipts, query)
    await this.assertUnchanged(userId, scoped.initial)
    return this.receiptPage(rows, query)
  }

  async getOrders(userId: string, query: ListFulfillmentOrdersDto) {
    const role = FULFILLMENT_QUEUE_ROLES[query.queue]
    if (query.workbenchRole && query.workbenchRole !== role) throw new BadRequestException('workbenchRole does not match the requested queue')
    if (this.provider.pagedOrders) {
      const initial = await this.scope(userId)
      if (!initial.roles.includes(role)) throw new ForbiddenException('Workbench access denied')
      const permission = await this.permissions(userId, initial)
      const result = await this.providerCall(() => this.provider.queryOrders(permission.subject, permission, initial.business, query))
      await this.assertUnchanged(userId, initial)
      return result
    }
    const { orders } = await this.scopedOrders(userId, role)
    const search = query.search?.trim().toLowerCase()
    const filtered = orders.filter((order) => matchesQueue(order, query.queue)
      && (!query.orderNumber || order.orderNumber === query.orderNumber)
      && (!search || [order.orderNumber, order.shopifyOrderNumber, order.customerName, order.storeName, ...order.items.map((item) => item.sku)]
        .some((value) => value.toLowerCase().includes(search))))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id))
    const start = (query.page - 1) * query.pageSize
    return { source: this.provider.source ?? 'fop', items: filtered.slice(start, start + query.pageSize), total: filtered.length, totals: summarizeFopOrders(filtered), page: query.page, pageSize: query.pageSize }
  }

  async getOrderVolume(userId: string, query: OrderVolumeQueryDto) {
    const scoped = await this.scopedOrders(userId, undefined, this.reportRange(orderVolumePeriods(query)))
    const receipts = query.category === 'customer' && scoped.permission.analyticsScopes?.includes('receipts') ? await this.scopedReceipts(userId, scoped) : undefined
    const result = aggregateOrderVolume(scoped.orders, query, new Date(), receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', ...result }
  }

  async searchOrderCustomers(userId: string, query: OrderCustomerSearchDto) {
    const scoped = await this.scopedOrders(userId, undefined, { from: '2020-01-01', to: businessDate(new Date()), keyword: query.keyword })
    const receipts = await this.scopedReceipts(userId, scoped)
    const result = searchOrderCustomers(scoped.orders, query, receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', ...result }
  }

  async getOrderVolumeDetails(userId: string, query: OrderVolumeDetailsDto) {
    const scoped = await this.scopedOrders(userId, query.workbenchRole, this.reportRange(orderVolumePeriods(query)))
    const receipts = query.category === 'customer' ? await this.scopedReceipts(userId, scoped) : []
    const rows = orderVolumeDetails(scoped.orders, query, new Date(), receipts)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', total: rows.length, totals: summarizeFopOrders(rows), page: query.page, pageSize: query.pageSize, items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
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
    if (this.provider.pagedOrders) {
      const initial = await this.scope(userId)
      if (!initial.roles.includes('sales')) throw new ForbiddenException('Workbench access denied')
      const permission = await this.permissions(userId, initial)
      const summary = permission.orderQuery ? await this.providerCall(() => this.provider.queryOrders(permission.subject, permission, initial.business, { queue: 'review', page: 1, pageSize: 1 }, true)) : null
      await this.assertUnchanged(userId, initial)
      let registration: ReturnType<typeof aggregateRegistrations> = { registrations: [], registrationDepartments: [] }
      const receiptsEnabled = !!permission.analyticsQuery?.receipts?.length && !!permission.analyticsScopes?.includes('receipts')
      let receiptRecords: FopReceipt[] = []
      if (permission.analyticsQuery?.registrations?.length && permission.analyticsScopes?.includes('registrations')) {
        const facts = await this.analytics(userId, { permission, initial }, 'registrations', { from: query.from, to: query.to })
        // 先按日期、部门、业务员合并注册事件，再复用既有图表聚合契约。
        const entries = new Map<string, { date: string; salesDepartmentCode: typeof facts.registrations[number]['salesDepartmentCode']; owner: { id: string; name: string }; count: number }>()
        for (const fact of facts.registrations) {
          const date = businessDate(fact.registeredAt), key = JSON.stringify([date, fact.salesDepartmentCode, fact.owner.id])
          const entry = entries.get(key)
          if (entry) entry.count++
          else entries.set(key, { date, salesDepartmentCode: fact.salesDepartmentCode, owner: fact.owner, count: 1 })
        }
        registration = await this.providerCall(async () => aggregateRegistrations([...entries.values()], query.from, query.to))
      }
      if (receiptsEnabled) {
        receiptRecords = await this.scopedReceipts(userId, { permission, initial, range: { from: `${query.year - 1}-12-01`, to: query.year === Number(businessDate(now).slice(0, 4)) ? businessDate(now) : `${query.year}-12-31` } })
      }
      const receipts = await this.providerCall(async () => monthlyReceipts(receiptRecords, query.year, receiptsEnabled, now))
      await this.assertUnchanged(userId, initial)
      return { businessScope: initial.business, source: 'fop' as const, updatedAt: now.toISOString(),
        integratedQueues: summary ? ['review'] : [], analyticsConfigured: !!permission.analyticsQuery,
        queues: { review: summary?.total ?? null, allocation: null, dispatch: null, shipping: null },
        tasks: summary?.total ? [{ id: 'review', kind: 'review', count: summary.total, time: '', priority: 'high' }] : [],
        rates: [], ...registration, exceptions: [],
        receipts }
    }
    const scoped = await this.scopedOrders(userId)
    // Date controls belong to registrations/receipts, not the current pending queues.
    const orders = scoped.orders
    const allowed = (queue: Queue) => scoped.roles.includes(FULFILLMENT_QUEUE_ROLES[queue])
    const count = (queue: Queue) => allowed(queue) ? orders.filter((order) => matchesQueue(order, queue)).length : 0
    const queues = { review: count('review'), allocation: count('allocation'), dispatch: count('dispatch'), shipping: count('shipping') }
    const tasks = (['review', 'allocation', 'shipping'] as const).filter((queue) => allowed(queue) && queues[queue] > 0)
      .map((queue) => {
        const oldest = orders.filter(order => matchesQueue(order, queue)).map(order => Date.parse(order.createdAt)).filter(Number.isFinite).sort((a, b) => a - b)[0]
        const time = oldest === undefined ? '' : new Date(oldest + 8 * 3_600_000).toISOString().slice(11, 16)
        return { id: queue, kind: queue, count: queues[queue], time, priority: queue === 'allocation' ? 'normal' : 'high' }
      })
    const analyticsScopes = scoped.permission.analyticsScopes ?? []
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
    const registrationData = analyticsScopes.includes('registrations') && analytics.registrationEntries !== undefined
      ? await this.providerCall(async () => aggregateRegistrations(analytics.registrationEntries!.filter(entry => matchesBusinessScope(scoped.initial.business, entry)), query.from, query.to))
      : { registrations: scoped.initial.business.role === 'admin' ? dailyRegistrations : [], registrationDepartments: [] }
    const receiptRecords = await this.scopedReceipts(userId, scoped)
    const receipts = await this.providerCall(async () => monthlyReceipts(receiptRecords, query.year, analyticsScopes.includes('receipts'), now))
    await this.assertUnchanged(userId, scoped.initial)
    return {
      businessScope: scoped.initial.business, source: this.provider.source ?? 'fop', updatedAt: now.toISOString(), queues, rates, ...registrationData, tasks,
      exceptions: allowed('exceptions') ? orders.filter((order) => matchesQueue(order, 'exceptions'))
        .map((order) => ({ id: order.orderNumber, customer: order.customerName, reason: order.exception!.reason, hours: order.exception!.hours })) : [],
      receipts,
    }
  }
}

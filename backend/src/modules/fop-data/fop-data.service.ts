import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { isWorkbenchRole, WORKBENCH_ROLES, WorkbenchRole } from '../users/workbench-role'
import { FULFILLMENT_QUEUE_ROLES, ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'
import { FopDashboardQueryDto } from './fop-data.dto'
import { FOP_DATA_PROVIDER, FopDataProvider, FopIdentity, FopOrder, FopOrderCandidate, FopPermissionDeniedError, FopPermissionGrant, SALES_DEPARTMENTS } from './fop-data.types'

import { businessScope, matchesBusinessScope, BusinessScope } from '../users/business-scope'
import { OrderVolumeQueryDto, OrderVolumeDetailsDto, OrderCustomerSearchDto } from './order-volume.dto'
import { aggregateOrderVolume, orderVolumeDetails, searchOrderCustomers } from './order-volume'
import { aggregateRegistrations } from './fop-registration'
import { moneyToCents, summarizeFopOrders } from './fop-order-totals'

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
    if (grant.analyticsScopes !== undefined && (!Array.isArray(grant.analyticsScopes) || grant.analyticsScopes.some(scope => !['rates', 'registrations', 'receipts'].includes(scope)))) {
      throw new ForbiddenException({ code: 'fop_permission_denied', message: 'Invalid FOP analytics permissions' })
    }
    return { subject: { ...identity }, allowedOrderIds: [...new Set(grant.allowedOrderIds)], analyticsScopes: [...new Set(grant.analyticsScopes ?? [])] }
  }

  private async providerCall<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
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

  private async scopedOrders(userId: string, requiredRole?: WorkbenchRole): Promise<{ orders: FopOrder[]; roles: WorkbenchRole[]; permission: FopPermissionGrant; initial: Scope }> {
    const initial = await this.scope(userId)
    if (requiredRole ? !initial.roles.includes(requiredRole) : initial.roles.length === 0) {
      throw new ForbiddenException('Workbench access denied')
    }
    const permission = await this.permissions(userId, initial)
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

  async getOrders(userId: string, query: ListFulfillmentOrdersDto) {
    const role = FULFILLMENT_QUEUE_ROLES[query.queue]
    if (query.workbenchRole && query.workbenchRole !== role) throw new BadRequestException('workbenchRole does not match the requested queue')
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
    const scoped = await this.scopedOrders(userId)
    const result = aggregateOrderVolume(scoped.orders, query)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', ...result }
  }

  async searchOrderCustomers(userId: string, query: OrderCustomerSearchDto) {
    const scoped = await this.scopedOrders(userId)
    const result = searchOrderCustomers(scoped.orders, query)
    await this.assertUnchanged(userId, scoped.initial)
    return { source: this.provider.source ?? 'fop', ...result }
  }

  async getOrderVolumeDetails(userId: string, query: OrderVolumeDetailsDto) {
    const scoped = await this.scopedOrders(userId, query.workbenchRole)
    const rows = orderVolumeDetails(scoped.orders, query)
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
      || start > end || end - start > 365 * day || query.to > now.toISOString().slice(0, 10) || query.year > now.getUTCFullYear()) {
      throw new BadRequestException('Invalid dashboard date range or year')
    }
    const scoped = await this.scopedOrders(userId)
    // Date controls belong to registrations/receipts, not the current pending queues.
    const orders = scoped.orders
    const allowed = (queue: Queue) => scoped.roles.includes(FULFILLMENT_QUEUE_ROLES[queue])
    const count = (queue: Queue) => allowed(queue) ? orders.filter((order) => matchesQueue(order, queue)).length : 0
    const queues = { review: count('review'), allocation: count('allocation'), dispatch: count('dispatch'), shipping: count('shipping') }
    const tasks = (['review', 'allocation', 'shipping'] as const).filter((queue) => allowed(queue) && queues[queue] > 0)
      .map((queue) => ({ id: queue, kind: queue, count: queues[queue], time: orders.filter(order => matchesQueue(order, queue)).map(order => order.createdAt).sort()[0]?.slice(11, 16) ?? '', priority: queue === 'allocation' ? 'normal' : 'high' }))
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
    const months = analyticsScopes.includes('receipts') ? Array.from({ length: query.year === now.getUTCFullYear() ? now.getUTCMonth() + 1 : 12 }, (_, i) => `${query.year}-${String(i + 1).padStart(2, '0')}`) : []
    // Fixed reporting departments; subordinate teams roll up in the provider adapter.
    // Both charts share the same authorized order ledger and integer-cent arithmetic.
    const previousMonth = `${query.year - 1}-12`
    const departments = months.length ? SALES_DEPARTMENTS.map(department => ({ ...department, previousAmount: 0, amounts: months.map(() => 0), salespeople: new Map<string, { id: string; name: string; previousAmount: number; amounts: number[] }>() })) : []
    for (const order of orders) {
      const department = departments.find(item => item.id === order.salesDepartmentCode)
      if (!department || order.paymentStatus !== 'paid' || order.cancelled || !order.paidAt || order.currency !== 'USD') continue
      const month = months.indexOf(order.paidAt.slice(0, 7))
      const cents = moneyToCents(order.amount)
      const isPreviousMonth = order.paidAt.slice(0, 7) === previousMonth
      if ((month < 0 && !isPreviousMonth) || !Number.isSafeInteger(cents) || cents < 0) continue
      const owner = order.owner?.id ? order.owner : { id: '__unassigned__', name: '未分配业务员' }
      let salesperson = department.salespeople.get(owner.id)
      if (!salesperson) {
        salesperson = { ...owner, previousAmount: 0, amounts: months.map(() => 0) }
        department.salespeople.set(owner.id, salesperson)
      }
      if (isPreviousMonth) {
        department.previousAmount += cents
        salesperson.previousAmount += cents
      } else {
        department.amounts[month] += cents
        salesperson.amounts[month] += cents
      }
    }
    return {
      businessScope: scoped.initial.business, source: this.provider.source ?? 'fop', updatedAt: now.toISOString(), queues, rates, ...registrationData, tasks,
      exceptions: allowed('exceptions') ? orders.filter((order) => matchesQueue(order, 'exceptions'))
        .map((order) => ({ id: order.orderNumber, customer: order.customerName, reason: order.exception!.reason, hours: order.exception!.hours })) : [],
      receipts: {
        currency: 'USD', months, ...(months.length ? { previousMonth } : {}),
        marketingCenter: months.length ? { id: 'marketing', name: '营销中心', previousAmount: departments.reduce((sum, department) => sum + department.previousAmount, 0) / 100, amounts: months.map((_, month) => departments.reduce((sum, department) => sum + department.amounts[month], 0) / 100) } : null,
        departments: departments.map(department => ({ ...department, previousAmount: department.previousAmount / 100, amounts: department.amounts.map(cents => cents / 100), salespeople: [...department.salespeople.values()].sort((a, b) => a.id.localeCompare(b.id)).map(person => ({ ...person, previousAmount: person.previousAmount / 100, amounts: person.amounts.map(cents => cents / 100) })) })),
      },
    }
  }
}

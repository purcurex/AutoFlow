import { compareFulfillmentOrders, fulfillmentSortDirection, fulfillmentSortField } from './fop-order-sort'
import Decimal from 'decimal.js'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'
import type { BusinessScope } from '../users/business-scope'
import { matchesBusinessScope } from '../users/business-scope'
import { kingdeeDepartmentPath } from './fop-kingdee-scope'
import { KingdeeStockDecoder } from './fop-kingdee.stock'
import { applyKingdeeOrderDetail } from './fop-kingdee.detail'
import { readKingdeeRma, type RmaDiscoveryCache } from './fop-kingdee.rma'
import { completedSalesRows } from './fop-kingdee.sales-completed'
import { consumerPaymentRange } from './consumer-payment-range'
import { summarizeFopOrders } from './fop-order-totals'
import type { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
import { businessDate, normalizeBusinessTimestamp, validBusinessDay } from './fop-business-time'
import { emptyAnalyticsData, KingdeeAnalyticsDecoder } from './fop-kingdee.analytics'
import type { FopAnalyticsData, FopAnalyticsRange, FopAnalyticsResource, FopAnalyticsScope, FopConnectionContext } from './fop-data.types'
import { FOP_ADMIN_CONTEXT, FopDataProvider, FopIdentity, FopIntegrationUnavailableError, FopOrder, FopOrderPage, FopOrderPageQuery, FopPermissionDeniedError, FopPermissionGrant } from './fop-data.types'
import type { FopBindingEmployee, FopBindingEmployeePage, FopEmployeeBindingDetails, VerifiedFopEmployeeBinding } from './fop-employee-binding'
import { KingdeeRealtimeAdapter } from './fop-kingdee.realtime'
import type { FopRealtimeScope, FopRealtimeApprovalContext, FopRealtimePage, CurrentInventoryRow, ReservedInventoryRow } from './fop-realtime.types'
import type { ApprovalQueue, ApprovalCommand, ApprovalOutcome } from './fop-approval.types'
import type { AllocationInventoryQueryDto } from './allocation-inventory.dto'
import type { StockInventoryQuery } from './fop-stock.types'

type Configuration = { get(key: string): string | undefined }
type JsonObject = Record<string, unknown>
type BindingResolver = (identity: Readonly<FopIdentity>) => Promise<FopEmployeeBindingDetails | null>

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Kingdee response')
  return value as JsonObject
}
function string(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 2000) throw new Error('Invalid Kingdee text')
  return value
}
function identifier(value: unknown): string {
  const id = string(value)
  if (!/^[1-9]\d{0,18}$/.test(id)) throw new Error('Invalid Kingdee ID')
  return id
}
function decimal(value: unknown): number {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value) || value.length > 60) throw new Error('Invalid Kingdee decimal')
  const result = new Decimal(value).toNumber()
  if (!Number.isFinite(result)) throw new Error('Invalid Kingdee decimal')
  // 金额合计由金蝶 BigDecimal 完成，这里仅转换现有页面展示类型，不进行浮点结算。
  return result
}
function integer(value: unknown): number {
  // 金蝶将 Long 计数序列化为十进制字符串；仅兼容规范非负整数，并继续限制在安全整数范围内。
  const count = typeof value === 'string' && /^(?:0|[1-9]\d{0,15})$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error('Invalid Kingdee count')
  return Number(count)
}
function reference(value: unknown): { id: string; name: string } | undefined {
  if (value === null) return undefined
  const item = object(value)
  return { id: identifier(item.id), name: string(item.name, true) }
}
function date(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null
  const result = string(value)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('Invalid Kingdee date')
  return result
}

/** 新前端专用查询模块的 HTTPS 适配器；所有凭据只在 Node 服务端读取。 */
export class KingdeeFopDataProvider extends FopDataProvider {
  get usesLocalWorkbenchOrganization(): boolean { return this.config.get('FOP_KINGDEE_LOCAL_ORGANIZATION') === 'true' }
  readonly pagedOrders = true
  readonly supportedOrderQueues: readonly FopOrderPageQuery['queue'][] = []
  get supportsReviewCountryFilters(): boolean { return this.config.get('FOP_KINGDEE_WORKBENCH_FACTS_MODE') === 'raw' }
  readonly queriedStock: boolean = false
  readonly queriedRma: boolean = false
  readonly supportsEmployeeBinding = true
  // 既有金蝶接口提供单据历史归属，明确声明兼容模式；不将其伪装成客户当前归属。
  readonly customerOwnershipMode = 'legacy_historical' as const
  private readonly logger = new Logger(KingdeeFopDataProvider.name)
  private readonly configuredOrganizations: string[]
  private connection?: FopConnectionContext
  private cachedToken?: { value: string; expiresAt: number }
  private tokenRequest?: Promise<string>
  private readonly pendingPermissionReads = new Map<string, Promise<unknown>>()
  private readonly userProviders = new Map<string, { fingerprint: string; provider: KingdeeFopDataProvider }>()
  private serviceProvider?: KingdeeFopDataProvider
  private readonly rmaDiscoveryCache: RmaDiscoveryCache = {}
  constructor(protected readonly config: Configuration, private readonly request: typeof fetch = fetch, private readonly resolveBinding?: BindingResolver) {
    super()
    this.configuredOrganizations = (config.get('FOP_KINGDEE_ORGANIZATION_IDS') ?? '').split(',').map(value => value.trim()).filter(Boolean)
  }

  private realtimeAdapter() {
    return new KingdeeRealtimeAdapter(this.config, this.organizationIds, (key, body, mutate) => this.performCall(key, body, undefined, !mutate))
  }
  async readApprovalContext(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, queue: ApprovalQueue, orderId: string): Promise<FopRealtimeApprovalContext> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).readApprovalContext(identity, scope, queue, orderId)
    return this.realtimeAdapter().approval(identity, scope, queue, orderId)
  }
  async approveDocument(identity: Readonly<FopIdentity>, command: ApprovalCommand): Promise<ApprovalOutcome> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).approveDocument(identity, command)
    return this.realtimeAdapter().approve(identity, command)
  }
  async queryCurrentInventory(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: AllocationInventoryQueryDto): Promise<FopRealtimePage<CurrentInventoryRow>> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).queryCurrentInventory(identity, scope, query)
    return this.realtimeAdapter().current(identity, scope, query)
  }
  async queryReservedInventory(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: StockInventoryQuery): Promise<FopRealtimePage<ReservedInventoryRow>> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).queryReservedInventory(identity, scope, query)
    return this.realtimeAdapter().reserved(identity, scope, query)
  }
  async queryReservedCustomers(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: { search?: string }): Promise<{ items: { id: string; code: string; name: string }[]; total: number }> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).queryReservedCustomers(identity, scope, query)
    return this.realtimeAdapter().customers(identity, scope, query)
  }

  async querySupplierContacts(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: import('./fop-realtime.types').FopSupplierContext): Promise<import('./fop-realtime.types').FopSupplierContacts> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).querySupplierContacts(identity, scope, query)
    return this.realtimeAdapter().supplierContacts(identity, scope, query)
  }
  async launchSupplierChat(identity: Readonly<FopIdentity>, scope: FopRealtimeScope, query: import('./fop-realtime.types').FopSupplierLaunchQuery): Promise<import('./fop-realtime.types').FopSupplierLaunch> {
    this.assertQueriesEnabled()
    if (this.resolveBinding) return (await this.userProvider(identity)).launchSupplierChat(identity, scope, query)
    return this.realtimeAdapter().supplierChat(identity, scope, query)
  }

  /** 每次读取当前绑定再选择独立适配器；令牌、刷新Promise及当前组织绝不跨员工共享。 */
  private async userProvider(identity: Readonly<FopIdentity>, resolvedBinding?: FopEmployeeBindingDetails | null): Promise<KingdeeFopDataProvider> {
    if (identity[FOP_ADMIN_CONTEXT]) {
      const current = await this.administratorIdentity()
      if (!current || current.tenantId !== identity.tenantId || current.userId !== identity.userId) throw new FopPermissionDeniedError('Administrator service context changed')
      return this.serviceProvider!
    }
    if (!this.resolveBinding) return this
    const key = JSON.stringify([identity.tenantId, identity.userId])
    const binding = resolvedBinding === undefined ? await this.resolveBinding(identity) : resolvedBinding
    if (!binding || !binding.username || !this.automaticTokenConfigured()) {
      this.userProviders.delete(key)
      throw new FopPermissionDeniedError('Employee binding must be verified again', 'fop_binding_required')
    }
    if (this.configuredOrganizations.length && !this.configuredOrganizations.includes(binding.organizationId)) throw new FopPermissionDeniedError('Employee organization is not configured')
    const fingerprint = JSON.stringify(binding)
    let cached = this.userProviders.get(key)
    if (cached?.fingerprint !== fingerprint) {
      const provider = this.employeeProvider(binding.username, binding.organizationId, identity)
      cached = { fingerprint, provider }
    }
    // 有界LRU：活跃员工复用各自令牌，绑定变化替换，避免长期运行无限积累连接。
    this.userProviders.delete(key)
    if (this.userProviders.size >= 200) this.userProviders.delete(this.userProviders.keys().next().value!)
    this.userProviders.set(key, cached!)
    return cached!.provider
  }

  /** 应用密钥由后端共用，员工用户名必须来自可信目录；员工模式禁止回退统一手工Token。 */
  private employeeProvider(username: string, organizationId: string, identity?: Readonly<FopIdentity>): KingdeeFopDataProvider {
    const overrides: Record<string, string> = { FOP_KINGDEE_USERNAME: username, FOP_KINGDEE_ACCESS_TOKEN: '',
      FOP_KINGDEE_ORGANIZATION_IDS: organizationId, FOP_KINGDEE_TENANT_ID: identity?.tenantId ?? '', FOP_KINGDEE_USER_ID: identity?.userId ?? '' }
    return new KingdeeFopDataProvider({ get: key => Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : this.config.get(key) }, this.request)
  }

  /** 目录认证主体必须仍是配置的目录读取账号，且只能读取其当前公司的可信结果。 */
  private directoryEnvelope(raw: JsonObject, connection: FopConnectionContext) {
    this.analyticsSubject(raw, connection.subject)
    if (raw.organizationId !== connection.currentOrganization.id || raw.schemaVersion !== 1) throw new FopPermissionDeniedError('Employee directory company mismatch')
  }

  /** 按平台任职游标有界分页，核验公司、范围版本和重复行，禁止把缺失状态当作启用。 */
  private async directoryPage(connection: FopConnectionContext, cursor?: string, scopeVersion?: string, deadline?: number): Promise<FopBindingEmployeePage> {
    if (!this.config.get('FOP_KINGDEE_DIRECTORY_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const raw = object(await this.call('FOP_KINGDEE_DIRECTORY_URL', { query: { tenantId: connection.subject.tenantId,
      organizationId: connection.currentOrganization.id, resource: 'employees', pageSize: 100, ...(cursor ? { cursor, scopeVersion } : {}) } }, deadline))
    this.directoryEnvelope(raw, connection)
    if (raw.resource !== 'employees' || !Array.isArray(raw.items) || raw.items.length > 100
      || !/^[a-f0-9]{64}$/.test(String(raw.scopeVersion)) || (scopeVersion && raw.scopeVersion !== scopeVersion)
      || (raw.nextCursor !== null && (typeof raw.nextCursor !== 'string' || !/^[1-9]\d{0,18}:[1-9]\d{0,18}$/.test(raw.nextCursor)))) throw new Error('Invalid employee directory page')
    const seen = new Set<string>()
    const items = raw.items.map(value => {
      const row = object(value), id = identifier(row.id), membershipId = identifier(row.membershipId)
      const rowKey = `${id}:${membershipId}`
      if (seen.has(rowKey) || !['active','disabled','unknown'].includes(String(row.state))) throw new Error('Invalid employee membership')
      seen.add(rowKey)
      return { id, membershipId, masterId: identifier(row.masterId), departmentId: identifier(row.departmentId),
        employeeNumber: typeof row.number === 'string' && /^\S{1,128}$/u.test(row.number) ? row.number : null,
        name: string(row.name), username: row.username == null ? '' : string(row.username, true), state: row.state as FopBindingEmployee['state'] }
    })
    return { items, nextCursor: raw.nextCursor as string | null, scopeVersion: raw.scopeVersion as string }
  }

  async listBindingEmployees(cursor?: string, scopeVersion?: string): Promise<FopBindingEmployeePage> {
    if (!!cursor !== !!scopeVersion) throw new FopPermissionDeniedError('Employee directory cursor and version must be paired')
    return this.directoryPage(await this.getConnectionContext(), cursor, scopeVersion)
  }

  /** 实时状态独立于缓存令牌；未知/不可见只拒绝访问，不据此自动停用本地员工账号。 */
  private async requireActiveEmployee(binding: FopEmployeeBindingDetails) {
    if (!this.config.get('FOP_KINGDEE_ACCOUNT_STATES_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const connection = await this.getConnectionContext()
    if (connection.currentOrganization.id !== binding.organizationId) throw new FopPermissionDeniedError('Employee directory company changed')
    const raw = object(await this.call('FOP_KINGDEE_ACCOUNT_STATES_URL', { query: { tenantId: connection.subject.tenantId,
      organizationId: binding.organizationId, employeeIds: [binding.employeeRecordId] } }))
    this.directoryEnvelope(raw, connection)
    if (!Array.isArray(raw.items) || raw.items.length !== 1) throw new Error('Invalid employee state response')
    const row = object(raw.items[0])
    if (row.id !== binding.employeeRecordId || row.state !== 'active') throw new FopPermissionDeniedError('Employee is disabled or its current state cannot be verified', 'fop_employee_unavailable')
  }

  /** 保存前重读任职行，再用该行用户名取Token；实际认证主体必须属于同一条人员记录。 */
  async verifyEmployeeBinding(employeeId: string, membershipId: string, employeeNumber: string): Promise<VerifiedFopEmployeeBinding> {
    if (!this.automaticTokenConfigured()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    identifier(employeeId); identifier(membershipId)
    if (typeof employeeNumber !== 'string' || !/^\S{1,128}$/u.test(employeeNumber)) throw new FopPermissionDeniedError('Employee number is required', 'fop_employee_number_mismatch')
    const directory = await this.getConnectionContext(), cursors = new Set<string>(), deadline = Date.now() + 30_000
    let cursor: string | undefined, scopeVersion: string | undefined, employee: FopBindingEmployee | undefined
    let numberOwner: string | undefined, complete = false
    // 扫完同一版本目录后再认证，防止跨页同工号指向不同人员；同一人的任职行仍需显式选择。
    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      const page = await this.directoryPage(directory, cursor, scopeVersion, deadline)
      for (const row of page.items) {
        if (row.id === employeeId && row.membershipId === membershipId) {
          if (row.employeeNumber !== employeeNumber) throw new FopPermissionDeniedError('Employee number changed or is missing', 'fop_employee_number_mismatch')
          employee = row
        }
        if (row.employeeNumber === employeeNumber) {
          const owner = `${row.id}:${row.masterId}`
          if (numberOwner && numberOwner !== owner) throw new FopPermissionDeniedError('Ambiguous employee number', 'fop_employee_number_ambiguous')
          numberOwner = owner
        }
      }
      if (!page.nextCursor) { complete = true; break }
      if (cursors.has(page.nextCursor)) throw new Error('Repeated employee directory cursor')
      cursors.add(page.nextCursor); cursor = page.nextCursor; scopeVersion = page.scopeVersion
    }
    if (!complete) throw new FopIntegrationUnavailableError('fop_result_too_large')
    if (!employee) throw new FopPermissionDeniedError('Employee is not visible in the current company')
    if (employee.state !== 'active' || !employee.username.trim() || employee.username.length > 128) throw new FopPermissionDeniedError('Employee is not enabled', 'fop_employee_unavailable')
    const provider = this.employeeProvider(employee.username, directory.currentOrganization.id)
    const { connection } = await provider.connectionGrant(true)
    if (connection.subject.tenantId !== directory.subject.tenantId || connection.currentOrganization.id !== directory.currentOrganization.id
      || ![employee.id, employee.masterId].includes(connection.subject.userId)) throw new FopPermissionDeniedError('Employee authenticated identity mismatch')
    const details: FopEmployeeBindingDetails = { employeeNumber: employee.employeeNumber, username: employee.username, name: employee.name, employeeRecordId: employee.id,
      employeeMasterId: employee.masterId, departmentId: employee.departmentId, organizationId: connection.currentOrganization.id,
      localEmployeeId: null, localDepartmentId: null, verifiedAt: new Date().toISOString() }
    await this.requireActiveEmployee(details)
    return { ...connection.subject, details }
  }

  /** 显式组织配置继续收窄范围；没有配置时只使用平台确认的当前公司，不能扩大成全部组织。 */
  private get organizationIds(): string[] {
    return this.configuredOrganizations.length ? this.configuredOrganizations : this.connection ? [this.connection.currentOrganization.id] : []
  }

  private automaticTokenConfigured(): boolean {
    return ['FOP_KINGDEE_TOKEN_URL', 'FOP_KINGDEE_CLIENT_ID', 'FOP_KINGDEE_CLIENT_SECRET', 'FOP_KINGDEE_ACCOUNT_ID', 'FOP_KINGDEE_USERNAME']
      .every(key => !!this.config.get(key)?.trim())
  }

  isConfigured(): boolean {
    const required = ['FOP_KINGDEE_IDENTITY']
    return required.every(key => !!this.config.get(key)?.trim())
      && (this.automaticTokenConfigured() || !!this.config.get('FOP_KINGDEE_ACCESS_TOKEN')?.trim())
      && (!this.config.get('FOP_KINGDEE_ORGANIZATION_IDS')?.trim() || this.configuredOrganizations.length > 0)
      && this.configuredOrganizations.length <= 200 && this.configuredOrganizations.every(id => /^[1-9]\d{0,18}$/.test(id))
  }

  private assertIdentity(identity: Readonly<FopIdentity>) {
    const tenantId = this.config.get('FOP_KINGDEE_TENANT_ID')?.trim() || this.connection?.subject.tenantId
    const userId = this.config.get('FOP_KINGDEE_USER_ID')?.trim() || this.connection?.subject.userId
    if (!this.isConfigured() || identity.tenantId !== tenantId || identity.userId !== userId) throw new FopPermissionDeniedError('Kingdee identity not configured for this account')
  }

  /** 首次连接不接受客户端声明身份；从已认证平台响应取身份及当前公司，并验证各资源组织交集。 */
  private async connectionGrant(allowEmptyResources = false): Promise<{ connection: FopConnectionContext; grant: FopPermissionGrant }> {
    if (!this.isConfigured() || !this.config.get('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const raw = object(await this.call('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL', { query: { scopeRole: 'admin', page: 1, pageSize: 100,
      ...(this.configuredOrganizations.length ? { organizationIds: this.configuredOrganizations } : {}) } }))
    const subject = object(raw.subject), organization = reference(raw.currentOrganization)
    if (!organization) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const identity = { tenantId: string(subject.tenantId), userId: identifier(subject.userId) }
    const organizations = this.configuredOrganizations.length ? this.configuredOrganizations : [organization.id]
    const grant = this.analyticsGrant(raw, identity, organizations)
    const connection: FopConnectionContext = { subject: identity, currentOrganization: organization,
      username: this.config.get('FOP_KINGDEE_USERNAME')?.trim() || null,
      resources: (['orders', 'receipts', 'registrations', 'freight'] as const).filter(resource => grant.analyticsQuery?.[resource]?.length) }
    if (!allowEmptyResources && !connection.resources.length) throw new FopPermissionDeniedError('No resource is authorized for this company')
    // 兼容旧配置中的身份约束：配置了就继续核对，不因新增自动发现而绕过旧约束。
    if ((this.config.get('FOP_KINGDEE_TENANT_ID')?.trim() && identity.tenantId !== this.config.get('FOP_KINGDEE_TENANT_ID')?.trim())
      || (this.config.get('FOP_KINGDEE_USER_ID')?.trim() && identity.userId !== this.config.get('FOP_KINGDEE_USER_ID')?.trim())) throw new FopPermissionDeniedError('Configured Kingdee identity mismatch')
    this.connection = connection
    return { connection, grant }
  }

  async getConnectionContext(): Promise<FopConnectionContext> {
    return (await this.connectionGrant()).connection
  }

  async administratorIdentity(): Promise<FopIdentity | null> {
    if (this.config.get('FOP_KINGDEE_ADMIN_SERVICE_ACCESS') !== 'true') return null
    this.serviceProvider ??= new KingdeeFopDataProvider(this.config, this.request)
    const connection = this.serviceProvider.connection ?? await this.serviceProvider.getConnectionContext()
    return { ...connection.subject, [FOP_ADMIN_CONTEXT]: { organizationId: connection.currentOrganization.id } }
  }

  private analyticsGrant(raw: JsonObject, identity: FopIdentity, organizations: readonly string[]): FopPermissionGrant {
    this.analyticsSubject(raw, identity)
    const grants = object(raw.grants), analyticsQuery: FopPermissionGrant['analyticsQuery'] = {}
    for (const resource of ['orders', 'receipts', 'registrations', 'freight'] as const) {
      const ids = grants[resource]
      if (!Array.isArray(ids) || ids.length > 200) throw new Error('Invalid analytics grant')
      const allowed = ids.map(identifier)
      if (new Set(allowed).size !== allowed.length || allowed.some(id => !organizations.includes(id))) throw new FopPermissionDeniedError('Invalid analytics organizations')
      analyticsQuery[resource] = allowed
    }
    const analyticsScopes: FopAnalyticsScope[] = (['receipts', 'registrations', 'freight'] as const).filter(resource => analyticsQuery[resource]!.length > 0)
    // 旧部署未声明能力时仍只开放待审核，防止把尚未更新的接口误当作待履约查询。
    const queues = raw.orderQueues === undefined ? ['review'] : raw.orderQueues
    if (!Array.isArray(queues) || queues.some(queue => !['unpaid', 'review', 'dispatch'].includes(queue))) throw new Error('Invalid Kingdee order queues')
    return { subject: { ...identity }, allowedOrderIds: [], analyticsQuery, analyticsScopes,
      ...(analyticsQuery.orders!.length ? { orderQuery: { queues: queues as ('unpaid' | 'review' | 'dispatch')[], organizationIds: analyticsQuery.orders!,
        ...(raw.orderQuery && object(raw.orderQuery).employeeFilterVersion === 1 ? { employeeFilterVersion: 1 as const } : {}) } } : {}) }
  }

  /** 实际读取认证后的汇总响应确认权限；禁止配置文件或本地 admin 单独伪造金蝶授权。 */
  async resolvePermissions(identity: Readonly<FopIdentity>, scope?: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    return this.resolvePermission(identity, scope, false)
  }

  /** Retained only for the unregistered diagnostic provider; never part of product list capabilities. */
  async diagnosticResolvePermissions(identity: Readonly<FopIdentity>, scope?: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    return this.resolvePermission(identity, scope, true)
  }

  async resolveStockPermissions(_identity: Readonly<FopIdentity>, _scope: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    throw new FopIntegrationUnavailableError('fop_reserved_inventory_not_configured')
  }

  private async resolvePermission(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope> | undefined, diagnostic: boolean): Promise<FopPermissionGrant> {
    if (identity[FOP_ADMIN_CONTEXT] && this.resolveBinding) {
      if (scope?.role !== 'admin') throw new FopPermissionDeniedError('Administrator role required')
      return (await this.userProvider(identity)).resolvePermission(identity, scope, diagnostic)
    }
    if (this.resolveBinding) {
      const binding = await this.resolveBinding(identity)
      const provider = await this.userProvider(identity, binding)
      if (!binding) throw new FopPermissionDeniedError('Employee binding changed', 'fop_binding_required')
      const [, permission] = await Promise.all([
        this.requireActiveEmployee(binding), provider.resolvePermission(identity, scope, diagnostic),
      ])
      return permission
    }
    if (!scope || scope.role === 'none') throw new FopPermissionDeniedError('Business scope required')
    if (!this.config.get('FOP_KINGDEE_TENANT_ID')?.trim() || !this.config.get('FOP_KINGDEE_USER_ID')?.trim() || !this.configuredOrganizations.length) {
      const { grant } = await this.connectionGrant()
      this.assertIdentity(identity)
      this.requireEmployeeCapability(this.localEmployeeScope(scope), grant.orderQuery?.employeeFilterVersion)
      return grant
    }
    this.assertIdentity(identity)
    if (this.config.get('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL')?.trim()) {
      const raw = object(await this.call('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL', { query: this.workbenchQuery(identity, scope) }))
      const grant = this.analyticsGrant(raw, identity, this.organizationIds)
      this.requireEmployeeCapability(this.localEmployeeScope(scope), grant.orderQuery?.employeeFilterVersion)
      return grant
    }
    if (!diagnostic) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    this.requireEmployeeCapability(this.localEmployeeScope(scope), undefined)
    const page = await this.read(identity, scope, { queue: 'review', page: 1, pageSize: 1 }, true)
    return { subject: { ...identity }, allowedOrderIds: [], orderQuery: { queues: ['review'], organizationIds: page.organizationIds } }
  }

  async listOrders(): Promise<never> { throw new FopIntegrationUnavailableError('fop_feature_not_configured') }
  /** RMA API authorization and exact employee-authorized fulfillment sources are both required. */
  async diagnosticQueryRmaOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, flowStatus: 'active' | 'closed' | 'all' = 'all'): Promise<Awaited<ReturnType<typeof readKingdeeRma>>> {
    if (this.resolveBinding) return (await this.userProvider(identity)).diagnosticQueryRmaOrders(identity, permission, scope, flowStatus)
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('RMA identity mismatch')
    if (!this.config.get('FOP_KINGDEE_RMA_URL')?.trim() || !this.config.get('FOP_KINGDEE_RMA_ORDER_LIST_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_rma_not_configured')
    if (this.config.get('FOP_KINGDEE_WORKBENCH_FACTS_MODE') !== 'raw' || !permission.orderQuery?.queues.includes('review')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const local = this.localEmployeeScope(scope)
    this.requireEmployeeCapability(local, permission.orderQuery.employeeFilterVersion)
    if (local?.empty) return { snapshot: { subject: { ...identity }, cases: [] }, orders: [], permission: { ...permission, allowedOrderIds: [], allowedRmaCaseIds: [] } }
    const mapping = object(JSON.parse(this.config.get('FOP_KINGDEE_ORGANIZATION_NUMBERS') ?? '{}')), organizations: Record<string, string> = {}
    for (const organization of permission.orderQuery.organizationIds) {
      if (!this.organizationIds.includes(organization) || typeof mapping[organization] !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(mapping[organization])) throw new FopIntegrationUnavailableError('fop_mapping_required')
      organizations[organization] = mapping[organization]
    }
    if (!Object.keys(organizations).length) throw new FopPermissionDeniedError('No RMA source organization authorized')
    return readKingdeeRma({ identity, permission, scope, flowStatus, discoveryCache: this.rmaDiscoveryCache, organizations, warehouses: this.unpaidWarehouses(),
      call: (key, body, deadline) => this.call(key, body, deadline), workbenchQuery: this.workbenchQuery(identity, scope),
      verifyPage: raw => { this.analyticsSubject(raw, identity); this.verifyEmployeeEcho(raw, local) } })
  }


  /** 仅备货入口调用独立授权接口；不让备货发布/配置故障阻塞原履约查询。 */
  async diagnosticResolveStockPermissions(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    if (identity[FOP_ADMIN_CONTEXT] && this.resolveBinding) {
      if (scope.role !== 'admin') throw new FopPermissionDeniedError('Administrator role required')
      return (await this.userProvider(identity)).diagnosticResolveStockPermissions(identity, scope)
    }
    if (this.resolveBinding) {
      const binding = await this.resolveBinding(identity), provider = await this.userProvider(identity, binding)
      if (!binding) throw new FopPermissionDeniedError('Employee binding changed', 'fop_binding_required')
      const [, permission] = await Promise.all([
        this.requireActiveEmployee(binding), provider.diagnosticResolveStockPermissions(identity, scope),
      ])
      return permission
    }
    if (!this.config.get('FOP_KINGDEE_STOCK_PERMISSIONS_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!this.connection && (!this.config.get('FOP_KINGDEE_TENANT_ID')?.trim() || !this.config.get('FOP_KINGDEE_USER_ID')?.trim() || !this.configuredOrganizations.length)) await this.getConnectionContext()
    this.assertIdentity(identity)
    const raw = object(await this.call('FOP_KINGDEE_STOCK_PERMISSIONS_URL', { query: this.workbenchQuery(identity, scope) }))
    this.analyticsSubject(raw, identity)
    if (raw.schemaVersion !== 1) throw new Error('Invalid stock permission version')
    const grants = object(raw.grants)
    const organizations = (resource: 'orders' | 'inventory') => {
      const values = grants[resource]
      if (!Array.isArray(values) || values.length > 200) throw new Error('Invalid stock organizations')
      const ids = values.map(identifier)
      if (new Set(ids).size !== ids.length || ids.some(id => !this.organizationIds.includes(id))) throw new FopPermissionDeniedError('Invalid stock organization grant')
      return ids
    }
    this.requireEmployeeCapability(this.localEmployeeScope(scope), raw.stockEmployeeFilterVersion)
    return { subject: { ...identity }, allowedOrderIds: [], stockQuery: { orders: organizations('orders'), inventory: organizations('inventory') },
      ...(raw.stockEmployeeFilterVersion === 1 ? { stockEmployeeFilterVersion: 1 as const } : {}) }
  }

  /** 分页收集限制60秒、64MB和十万行，缺页/重复/权限变化均失败，不返回截断合计。 */
  private async stockRows(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, resource: 'orders' | 'inventory'): Promise<unknown[]> {
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Stock permission identity mismatch')
    const organizations = permission.stockQuery?.[resource]
    if (!organizations?.length) throw new FopPermissionDeniedError('Stock resource not authorized')
    const local = this.localEmployeeScope(scope)
    this.requireEmployeeCapability(local, permission.stockEmployeeFilterVersion)
    if (local?.empty) return []
    const key = resource === 'orders' ? 'FOP_KINGDEE_STOCK_ORDERS_URL' : 'FOP_KINGDEE_STOCK_INVENTORY_URL'
    if (!this.config.get(key)?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const rows: unknown[] = [], seen = new Set<string>(), deadline = Date.now() + 60_000
    let bytes = 0
    for (let page = 1; page <= 1000; page++) {
      const raw = object(await this.call(key, { query: { ...this.workbenchQuery(identity, scope), page, pageSize: 100 } }, deadline))
      this.analyticsSubject(raw, identity)
      this.verifyEmployeeEcho(raw, local)
      if (raw.schemaVersion !== 1 || raw.resource !== resource || raw.page !== page || raw.pageSize !== 100 || typeof raw.hasMore !== 'boolean'
        || !Array.isArray(raw.items) || raw.items.length > 100 || raw.hasMore && raw.items.length !== 100
        || !Array.isArray(raw.organizationIds) || !raw.organizationIds.length) throw new Error('Invalid stock page')
      const pageOrganizations = raw.organizationIds.map(identifier)
      if (new Set(pageOrganizations).size !== pageOrganizations.length || pageOrganizations.some(id => !organizations.includes(id) || !this.organizationIds.includes(id))) throw new FopPermissionDeniedError('Stock organization grant changed')
      bytes += Buffer.byteLength(JSON.stringify(raw))
      if (bytes > 64 * 1024 * 1024 || rows.length + raw.items.length > 100_000) throw new FopIntegrationUnavailableError('fop_result_too_large')
      for (const value of raw.items) {
        const row = object(value), rowId = identifier(row.id), organization = object(row.organization)
        if (!pageOrganizations.includes(identifier(organization.id))) throw new FopPermissionDeniedError('Stock row outside page organizations')
        if (seen.has(rowId)) throw new Error('Duplicate stock row across pages')
        seen.add(rowId); rows.push(value)
      }
      if (!raw.hasMore) return rows
    }
    throw new FopIntegrationUnavailableError('fop_result_too_large')
  }

  /** 字段转换复用原页面契约；金蝶与本地分别校验本人及直属部门范围。 */
  async diagnosticListStockOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope?: Readonly<BusinessScope>): Promise<FopStockOrderCandidate[]> {
    if (this.resolveBinding) return (await this.userProvider(identity)).diagnosticListStockOrders(identity, permission, scope)
    if (!scope) throw new FopPermissionDeniedError('Stock business scope required')
    if (this.localEmployeeScope(scope)?.empty) return []
    const decoder = new KingdeeStockDecoder(this.config, !!this.localEmployeeScope(scope))
    const rows = await this.stockRows(identity, permission, scope, 'orders')
    return rows.map(value => decoder.order(object(value), identity, scope, permission.stockQuery!.orders))
  }

  /** 允许历史台账存在同客户/SKU/仓库多行；按精确维度合并，余额使用Decimal累加。 */
  async diagnosticListStockInventory(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope?: Readonly<BusinessScope>): Promise<FopStockInventoryCandidate[]> {
    if (this.resolveBinding) return (await this.userProvider(identity)).diagnosticListStockInventory(identity, permission, scope)
    if (!scope) throw new FopPermissionDeniedError('Stock business scope required')
    const decoder = new KingdeeStockDecoder(this.config, !!this.localEmployeeScope(scope)), groups = new Map<string, FopStockInventoryCandidate>()
    for (const value of await this.stockRows(identity, permission, scope, 'inventory')) {
      const row = decoder.inventory(value, identity, scope, permission.stockQuery!.inventory)
      const key = JSON.stringify([row.customerId, row.sku, row.warehouseCode]), previous = groups.get(key)
      if (!previous) { groups.set(key, { ...row, id: key }); continue }
      if (previous.owner.id !== row.owner.id || previous.department.id !== row.department.id) throw new Error('Stock customer assignment changed during pagination')
      for (const type of ['fullPayment', 'deposit'] as const) for (const field of ['available', 'locked'] as const) {
        const sum = new Decimal(previous[type][field]).plus(row[type][field])
        if (sum.greaterThan(Number.MAX_SAFE_INTEGER)) throw new Error('Stock inventory quantity overflow')
        previous[type][field] = sum.toNumber()
      }
    }
    return [...groups.values()]
  }

  /** Local directory IDs never become FOP department IDs. Only validated employee master IDs cross this boundary. */
  private localEmployeeScope(scope: Readonly<BusinessScope>, filter?: FopOrderPageQuery['employeeFilter']) {
    if (!scope.localOrganization) {
      if (filter) throw new FopPermissionDeniedError('Employee filter requires local organization scope')
      return undefined
    }
    if (!this.usesLocalWorkbenchOrganization) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const maximum = scope.localOrganization
    const validateIds = (values: readonly string[] | null) => {
      if (values === null) return
      if (!Array.isArray(values) || values.length > 10000 || new Set(values).size !== values.length) throw new FopPermissionDeniedError('Invalid local employee scope')
      values.forEach(identifier)
    }
    string(maximum.version)
    validateIds(maximum.employeeIds)
    if (scope.role === 'none' || maximum.employeeIds === null && scope.role !== 'admin'
      || scope.role === 'salesperson' && (!scope.employeeId || maximum.employeeIds?.some(id => id !== scope.employeeId))) throw new FopPermissionDeniedError('Invalid local role scope')
    const effective = filter ?? maximum
    validateIds(effective.employeeIds)
    if (effective.version !== maximum.version || maximum.employeeIds !== null && (effective.employeeIds === null
      || effective.employeeIds.some(id => !maximum.employeeIds!.includes(id)))) throw new FopPermissionDeniedError('Local employee filter exceeds current scope')
    const self = scope.role === 'salesperson' && effective.employeeIds?.length === 1 && effective.employeeIds[0] === scope.employeeId
    return { employeeIds: effective.employeeIds, version: effective.version,
      empty: effective.employeeIds?.length === 0, requiresCapability: !self && effective.employeeIds !== null && effective.employeeIds.length > 0 }
  }

  private workbenchQuery(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>, filter?: FopOrderPageQuery['employeeFilter']) {
    const local = this.localEmployeeScope(scope, filter)
    if (!local) return this.analyticsQuery(identity, scope)
    return { ...identity, organizationIds: this.organizationIds, scopeRole: scope.role,
      employeeId: scope.role === 'salesperson' ? scope.employeeId : null, departmentIds: [], page: 1, pageSize: 100,
      ...(local.requiresCapability ? { employeeIds: local.employeeIds, localScopeVersion: local.version } : {}) }
  }

  private requireEmployeeCapability(local: ReturnType<KingdeeFopDataProvider['localEmployeeScope']>, capability: unknown) {
    if (local?.requiresCapability && capability !== 1) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
  }

  private verifyEmployeeEcho(raw: JsonObject, local: ReturnType<KingdeeFopDataProvider['localEmployeeScope']>) {
    if (!local?.requiresCapability) return
    if (raw.localScopeVersion !== local.version || !Array.isArray(raw.employeeIds)
      || raw.employeeIds.length !== local.employeeIds!.length || new Set(raw.employeeIds).size !== raw.employeeIds.length
      || raw.employeeIds.some(id => typeof id !== 'string' || !local.employeeIds!.includes(id))) throw new FopPermissionDeniedError('Local employee filter response changed')
  }

  private analyticsQuery(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>) {
    if (scope.role === 'none' || (scope.role === 'salesperson' && !scope.employeeId) || (scope.role === 'department_manager' && !scope.departmentId)) throw new FopPermissionDeniedError('Incomplete business scope')
    return { ...identity, organizationIds: this.organizationIds, scopeRole: scope.role, employeeId: scope.employeeId,
      departmentIds: scope.departmentId ? [scope.departmentId] : [], page: 1, pageSize: 100 }
  }

  private analyticsSubject(raw: JsonObject, identity: Readonly<FopIdentity>) {
    const subject = object(raw.subject)
    if (subject.tenantId !== identity.tenantId || subject.userId !== identity.userId) throw new FopPermissionDeniedError('Analytics identity mismatch')
  }

  /** 四类事实只在Nest后端分页收集。明确限制累计体积/数量/时长，超限失败，不返回截断后的错误合计。 */
  async readAnalytics(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, resource: FopAnalyticsResource, range: FopAnalyticsRange): Promise<FopAnalyticsData> {
    if (this.resolveBinding) return (await this.userProvider(identity)).readAnalytics(identity, permission, scope, resource, range)
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Analytics permission identity mismatch')
    const organizations = permission.analyticsQuery?.[resource]
    if (!organizations?.length) throw new FopPermissionDeniedError('Analytics resource not authorized')
    if (!this.config.get('FOP_KINGDEE_ANALYTICS_QUERY_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!validBusinessDay(range.from) || !validBusinessDay(range.to) || range.from < '2019-01-01' || range.to < range.from || range.to > businessDate(new Date())
      || (range.keyword !== undefined && (typeof range.keyword !== 'string' || range.keyword.length > 100))) throw new Error('Invalid analytics range')
    const data = emptyAnalyticsData(), decoder = new KingdeeAnalyticsDecoder(this.config), seen = new Set<string>()
    const started = Date.now()
    let bytes = 0
    for (let page = 1; page <= 1000; page++) {
      if (Date.now() - started > 60_000) throw new FopIntegrationUnavailableError('fop_result_too_large')
      const raw = object(await this.call('FOP_KINGDEE_ANALYTICS_QUERY_URL', { query: { ...this.analyticsQuery(identity, scope), from: range.from, to: range.to, keyword: range.keyword, resource, page,
        exchangeRateTableId: this.config.get('FOP_KINGDEE_EXRATE_TABLE_ID')?.trim() } }, started + 60_000))
      this.analyticsSubject(raw, identity)
      if (raw.resource !== resource || raw.from !== range.from || raw.to !== range.to || raw.page !== page || raw.pageSize !== 100
        || typeof raw.hasMore !== 'boolean' || !Array.isArray(raw.items) || !Array.isArray(raw.organizationIds) || !raw.organizationIds.length) throw new Error('Invalid analytics page')
      const pageOrganizations = raw.organizationIds.map(identifier)
      if (pageOrganizations.some(id => !organizations.includes(id) || !this.organizationIds.includes(id))) throw new FopPermissionDeniedError('Analytics grant changed')
      bytes += Buffer.byteLength(JSON.stringify(raw))
      if (bytes > 64 * 1024 * 1024 || seen.size + raw.items.length > 100_000 || (resource !== 'receipts' && raw.items.length > 100)) throw new FopIntegrationUnavailableError('fop_result_too_large')
      for (const value of raw.items) {
        const id = decoder.append(data, resource, value, identity, scope, pageOrganizations)
        if (seen.has(id)) throw new Error('Duplicate analytics fact across pages')
        seen.add(id)
        const row = object(value), at = date(resource === 'orders' || resource === 'receipts' ? row.paidAt : resource === 'freight' ? row.confirmedAt : row.registeredAt)!
        if (businessDate(at) < range.from || businessDate(at) > range.to || Date.parse(at) > Date.now()) throw new Error('Analytics fact outside requested range')
      }
      if (Date.now() - started > 60_000) throw new FopIntegrationUnavailableError('fop_result_too_large')
      if (!raw.hasMore) return data
      // 收款页按主单分页；源单无查看权限时可能无可输出分录，不能用items为空提前终止。
    }
    throw new FopIntegrationUnavailableError('fop_result_too_large')
  }

  async diagnosticQueryOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly = false): Promise<FopOrderPage> {
    if (this.resolveBinding) return (await this.userProvider(identity)).diagnosticQueryOrders(identity, permission, scope, query, summaryOnly)
    summaryOnly ||= query.projection === 'count'
    this.assertIdentity(identity)
    if (!['unpaid', 'review', 'dispatch'].includes(query.queue) || !permission.orderQuery?.queues.includes(query.queue as 'unpaid' | 'review' | 'dispatch')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    // 待支付沿用服务端解析出的角色范围；业务员不能借筛选切换到其他人。
    if (query.queue === 'unpaid' && scope.role === 'salesperson') {
      if (query.ownerId && query.ownerId !== scope.employeeId) throw new FopPermissionDeniedError('Unpaid orders are personal only')
    }
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Permission identity mismatch')
    const local = this.localEmployeeScope(scope, query.employeeFilter)
    this.requireEmployeeCapability(local, permission.orderQuery.employeeFilterVersion)
    if (query.queue === 'review' && query.completed && this.config.get('FOP_KINGDEE_WORKBENCH_FACTS_MODE') === 'raw') return this.readSalesCompleted(identity, permission, scope, query, summaryOnly)
    // A count is the total of the same employee-scoped list, never the separate statistics API.
    // Filters absent from the upstream contract must still use the complete local filtering path.
    if (query.projection === 'count' && !query.completed && !query.exportManifest && !query.orderIds
      && (!query.timeRange || query.timeRange === 'all') && !query.shippingCountryCode
      && !(query.queue === 'review' && query.warehouseCode)) {
      const { organizationIds, detailSources: _details, ...page } = await this.read(identity, scope,
        { ...query, page: 1, pageSize: 1, timeRange: undefined }, false)
      if (organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Organization grant changed')
      return { ...page, items: [], page: query.page, pageSize: query.pageSize }
    }
    if (!query.completed && (query.timeRange && query.timeRange !== 'all' || query.shippingCountryCode
      || query.queue === 'review' && (query.warehouseCode || this.supportsReviewCountryFilters)
      || query.queue !== 'dispatch' && (query.exportManifest || query.orderIds))) return this.readOrderPaymentPage(identity, permission, scope, query, summaryOnly || query.projection === 'count')
    if (query.completed || query.timeRange && query.timeRange !== 'all') throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const { organizationIds, detailSources, ...page } = await this.read(identity, scope, query, summaryOnly)
    if (organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Organization grant changed')
    if (detailSources && this.config.get('FOP_KINGDEE_ORDER_DETAIL_URL')?.trim()) await this.enrichOrderDetails(page.items, detailSources)
    return page
  }

  /** Filter the authorized queue by its own receipt date; country facets still need same-document details. */
  private async readOrderPaymentPage(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly: boolean): Promise<FopOrderPage> {
    if (query.completed) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1
      || query.pageSize > (query.exportManifest ? 10000 : 100)) throw new Error('Invalid payment page')
    const rows: FopOrder[] = [], seen = new Set<string>(), deadline = Date.now() + 90_000
    let total: number | undefined
    let options: Pick<FopOrderPage, 'departments' | 'salespeople'> = {}
    for (let page = 1; page <= 1000; page++) {
      if (Date.now() > deadline) throw new FopIntegrationUnavailableError('fop_result_too_large')
      const result = await this.read(identity, scope, { ...query, page, pageSize: 100, timeRange: undefined,
        shippingCountryCode: undefined, warehouseCode: query.queue === 'review' ? undefined : query.warehouseCode,
        orderIds: undefined, exportManifest: false, sortBy: 'paidAt', sortOrder: 'desc' }, false)
      if (total !== undefined && result.total !== total) throw new Error('Pending orders changed during pagination')
      total = result.total
      if (page === 1) options = { departments: result.departments, salespeople: result.salespeople }
      if (result.organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Pending order company grant changed')
      if (result.detailSources && this.config.get('FOP_KINGDEE_ORDER_DETAIL_URL')?.trim()) await this.enrichOrderDetails(result.items, result.detailSources)
      for (const row of result.items) {
        if (seen.has(row.id)) throw new Error('Duplicate pending order')
        seen.add(row.id); rows.push(row)
      }
      if (rows.length === total) break
      if (!result.items.length || rows.length > total || rows.length > 100000) throw new Error('Incomplete customer payment read')
    }
    if (rows.length !== total) throw new FopIntegrationUnavailableError('fop_result_too_large')
    const matchesTime = consumerPaymentRange(query.timeRange)
    const candidates = rows.filter(row => matchesTime(row.consumerPaidAt) && (!query.warehouseCode || row.warehouseCode === query.warehouseCode))
    const shippingCountries = query.queue === 'review' ? [...new Set(candidates.map(row => row.shippingCountryCode).filter((code): code is string => typeof code === 'string' && /^[A-Z]{2}$/.test(code)))].sort() : undefined
    const orders = candidates.filter(row => (!query.shippingCountryCode || row.shippingCountryCode === query.shippingCountryCode) && (!query.orderIds || query.orderIds.includes(row.id)))
      .sort((a, b) => compareFulfillmentOrders(a, b, { queue: query.queue as 'unpaid' | 'review' | 'dispatch',
        sortBy: query.sortBy as 'paidAt' | 'consumerPaidAt' | 'dispatchDocumentStatus', sortOrder: query.sortOrder, paidAtOrder: query.paidAtOrder }))
    return { source: 'fop', ...options, ...(shippingCountries ? { shippingCountries } : {}),
      items: summaryOnly ? [] : orders.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: orders.length,
      page: query.page, pageSize: query.pageSize, totals: summarizeFopOrders(orders), ...(query.exportManifest ? { orderIds: orders.map(row => row.id) } : {}) }
  }

  /** Sales approval history is derived from authorized native facts, never the pending-review page. */
  private async readSalesCompleted(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly: boolean): Promise<FopOrderPage> {
    if (this.config.get('FOP_KINGDEE_WORKBENCH_FACTS_MODE') !== 'raw') throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1
      || query.pageSize > (query.exportManifest ? 10000 : 100) || query.timeRange && !(query.completed ? ['1w','1m','3m'] : ['all','1w','1m','3m']).includes(query.timeRange)
      || query.sortBy && !['completedAt', 'paidAt', 'consumerPaidAt'].includes(query.sortBy) || query.taskStatus) throw new Error('Invalid sales completion query')
    const local = this.localEmployeeScope(scope, query.employeeFilter)
    const rows: JsonObject[] = [], ids = new Set<string>(), cursors = new Set<string>(), deadline = Date.now() + 90_000
    let cursor: string | undefined, bytes = 0, complete = false
    if (!local?.empty) for (let page = 1; page <= 1000; page++) {
      const raw = object(await this.call('FOP_KINGDEE_QUERY_URL', { query: { ...this.workbenchQuery(identity, scope, query.employeeFilter),
        queue: 'review', rawWorkbenchFacts: true, page, pageSize: 100, ...(cursor ? { afterOrderId: cursor } : {}) } }, deadline))
      this.analyticsSubject(raw, identity)
      this.verifyEmployeeEcho(raw, local)
      if (raw.workbenchFactsSchemaVersion !== 1 || raw.queue !== 'review' || raw.page !== page || raw.pageSize !== 100
        || typeof raw.hasMore !== 'boolean' || !Array.isArray(raw.items) || raw.items.length > 100 || !Array.isArray(raw.organizationIds) || !raw.organizationIds.length) throw new Error('Invalid sales completion page')
      const organizations = raw.organizationIds.map(identifier)
      if (new Set(organizations).size !== organizations.length || organizations.some(id => !this.organizationIds.includes(id)
        || !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Completion organization grant changed')
      bytes += Buffer.byteLength(JSON.stringify(raw))
      if (bytes > 128 * 1024 * 1024 || rows.length + raw.items.length > 100000) throw new FopIntegrationUnavailableError('fop_result_too_large')
      for (const value of raw.items) {
        const row = object(value), id = identifier(row.id), organization = reference(row.hzkj_org), owner = reference(row.hzkj_operator)
        if (!organization || !organizations.includes(organization.id) || ids.has(id)) throw new FopPermissionDeniedError('Invalid completion row scope or duplicate')
        if (local ? local.employeeIds !== null && (!owner || !local.employeeIds.includes(owner.id))
          : !matchesBusinessScope(scope, { owner, department: reference(row.hzkj_dept), departmentPathIds: row.departmentPathIds as string[] })) throw new FopPermissionDeniedError('Completed order outside employee scope')
        ids.add(id); rows.push(row)
      }
      if (!raw.hasMore) { complete = true; break }
      const next = identifier(raw.nextAfterOrderId)
      if (!raw.items.length || cursors.has(next) || next === cursor) throw new Error('Incomplete completion cursor')
      cursors.add(next); cursor = next
    }
    if (!local?.empty && !complete) throw new FopIntegrationUnavailableError('fop_result_too_large')
    const candidates = completedSalesRows(rows, { ...query, shippingCountryCode: undefined }, this.unpaidWarehouses())
    const shippingCountries = [...new Set(candidates.map(row => row.shippingCountryCode).filter((code): code is string => typeof code === 'string' && /^[A-Z]{2}$/.test(code)))].sort()
    const orders = candidates.filter(row => !query.shippingCountryCode || row.shippingCountryCode === query.shippingCountryCode)
    return { source: 'fop', items: summaryOnly ? [] : orders.slice((query.page-1)*query.pageSize, query.page*query.pageSize),
      total: orders.length, page: query.page, pageSize: query.pageSize, shippingCountries, totals: summarizeFopOrders(orders) }
  }

  private async read(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly: boolean): Promise<FopOrderPage & { organizationIds: string[]; detailSources?: JsonObject[] }> {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 1_000_000 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) throw new Error('Invalid page')
    const local = this.localEmployeeScope(scope, query.employeeFilter)
    if (!local && (scope.role === 'none' || (scope.role === 'salesperson' && !scope.employeeId) || (scope.role === 'department_manager' && !scope.departmentId))) throw new FopPermissionDeniedError('Incomplete business scope')
    if (local && (query.departmentId || query.ownerId) && !query.employeeFilter) throw new FopPermissionDeniedError('Local selection requires an employee filter')
    if (local?.empty) return { source: 'fop', total: 0, page: query.page, pageSize: query.pageSize, items: [], organizationIds: [],
      ...(query.exportManifest ? { orderIds: [] } : {}), totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } }
    const unpaid = query.queue === 'unpaid'
    const dispatch = query.queue === 'dispatch'
    const completed = query.completed === true
    if (completed && !dispatch) throw new Error('Completed mode requires dispatch')
    const warehouseMap = this.unpaidWarehouses()
    const warehouseIds = query.warehouseCode ? Object.keys(warehouseMap).filter(id => warehouseMap[id] === query.warehouseCode) : undefined
    if ((unpaid || dispatch) && warehouseIds && !warehouseIds.length) throw new FopIntegrationUnavailableError('fop_mapping_required')
    // The legacy diagnostic endpoint has no published delivery-state filter contract.
    if (dispatch && ['dispatch_pending','dispatch_tracking','dispatch_updating','dispatch_cancelled'].includes(query.taskStatus ?? '')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (dispatch && ((completed
      ? query.taskStatus !== undefined || query.timeRange !== undefined && !['1w', '1m', '3m'].includes(query.timeRange)
      : query.timeRange !== undefined || query.taskStatus !== undefined && !['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved'].includes(query.taskStatus))
      || query.sortBy !== undefined && !(completed ? ['completedAt', 'paidAt', 'consumerPaidAt'] : ['paidAt', 'consumerPaidAt', 'dispatchDocumentStatus']).includes(query.sortBy)
      || query.orderIds !== undefined && (!query.orderIds.length || query.orderIds.length > 100 || new Set(query.orderIds).size !== query.orderIds.length))) throw new Error('Invalid dispatch filters')
    if (unpaid && (query.timeRange !== undefined && !['all', '1w', '1m', '3m'].includes(query.timeRange)
      || query.sortBy !== undefined && !['paidAt', 'consumerPaidAt'].includes(query.sortBy))) throw new Error('Invalid unpaid filters')
    const body = { query: { ...this.workbenchQuery(identity, scope, query.employeeFilter),
      search: query.search ?? '', orderNumber: query.orderNumber ?? '', page: query.page, pageSize: query.pageSize,
      ...(dispatch ? { queue: 'dispatch', departmentId: local ? undefined : query.departmentId, ownerId: local ? undefined : query.ownerId, warehouseIds, taskStatus: query.taskStatus,
        ...(completed ? { completed: true, timeRange: query.timeRange ?? '1w' } : {}),
        sortBy: fulfillmentSortField(query) === 'consumerPaidAt' ? 'paidAt' : fulfillmentSortField(query), sortOrder: fulfillmentSortDirection(query),
        orderIds: query.orderIds, exportManifest: query.exportManifest } : {}),
      // 待审核的时间排序交给金蝶在分页前执行，不能仅反转当前页。
      ...(query.queue === 'review'
        ? { sortBy: fulfillmentSortField(query) === 'consumerPaidAt' ? 'paidAt' : fulfillmentSortField(query), sortOrder: fulfillmentSortDirection(query) } : {}),
      ...(unpaid ? { queue: 'unpaid', timeRange: query.timeRange, departmentId: local ? undefined : query.departmentId, ownerId: local ? undefined : query.ownerId, warehouseIds,
        sortBy: fulfillmentSortField(query) === 'consumerPaidAt' ? 'paidAt' : fulfillmentSortField(query), sortOrder: fulfillmentSortDirection(query) } : {}) } }
    const raw = object(await this.call(summaryOnly ? 'FOP_KINGDEE_SUMMARY_URL' : 'FOP_KINGDEE_QUERY_URL', body))
    this.verifyEmployeeEcho(raw, local)
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error('Unsupported employee order schema')
    const subject = object(raw.subject)
    if (subject.tenantId !== identity.tenantId || subject.userId !== identity.userId) throw new FopPermissionDeniedError('Kingdee response identity mismatch')
    // 完成能力必须由上游显式确认，旧接口即使返回空页也不能冒充已接通。
    if (completed && (raw.completed !== true || raw.completedSchemaVersion !== 2)) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!completed && raw.completed === true) throw new Error('Unexpected completed response')
    const expectedBasis = unpaid ? 'unpaid_active_self' : dispatch ? completed ? 'paid_tracking_synced_active' : 'paid_tracking_pending_active' : 'submitted_paid_active'
    if (raw.queue !== query.queue || raw.basis !== expectedBasis || !Array.isArray(raw.organizationIds)
      || raw.organizationIds.length === 0 || raw.organizationIds.some(id => !this.organizationIds.includes(String(id)))) throw new FopPermissionDeniedError('Kingdee response scope mismatch')
    if (dispatch && raw.dispatchSchemaVersion !== 1) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const organizationIds = raw.organizationIds.map(identifier)
    const total = integer(raw.total)
    if (raw.page !== query.page || raw.pageSize !== query.pageSize || !Array.isArray(raw.items)
      || raw.items.length > (summaryOnly ? 0 : query.pageSize) || total < raw.items.length) throw new Error('Invalid Kingdee page')
    const seen = new Set<string>()
    const items = raw.items.map(value => {
      const row = object(value)
      const id = identifier(row.id)
      const organization = reference(row.organization)
      if (seen.has(id) || !organization || !organizationIds.includes(organization.id)) throw new FopPermissionDeniedError('Unexpected order organization or duplicate')
      seen.add(id)
      // 待审核包含已支付但尚未审核的草稿，不以“已提交”作为额外门槛。
      const billStatus = string(row.billStatus)
      if (!['A', 'B', 'C'].includes(billStatus) || query.queue === 'review' && billStatus === 'C' || completed && billStatus !== 'C' || !(unpaid ? ['1'] : ['2', '3', '4', '5']).includes(string(row.orderStatus))) throw new Error('Unexpected review order status')
      const owner = reference(row.owner)
      const department = local ? { id: 'local:unmapped', name: '未关联本地部门' } : reference(row.department)
      if (!department) throw new FopPermissionDeniedError('Order department missing')
      const departmentPathIds = local ? undefined : kingdeeDepartmentPath(row.departmentPathIds, organization.id, department.id, raw.schemaVersion === 1)
      if (local ? local.employeeIds !== null && (!owner || !local.employeeIds.includes(owner.id)) : !matchesBusinessScope(scope, { owner, department, departmentPathIds }, dispatch)) throw new FopPermissionDeniedError('Order outside local business scope')
      const customer = reference(raw.schemaVersion === 1 ? row.customer ?? null : row.customer)
      const store = reference(raw.schemaVersion === 1 ? row.store ?? null : row.store)
      const warehouse = reference(raw.schemaVersion === 1 ? row.warehouse ?? null : row.warehouse)
      // paidAt is the fulfillment document's hzkj_receipt_date. Never use the legacy source-order clock.
      const consumerPaidAt = date(row.paidAt ?? null, true)
      // 时间边界由金蝶用同一时钟过滤和汇总，避免两端毫秒差将合法边界记录误拒绝。
      if ((unpaid || dispatch) && (!local && query.departmentId && department.id !== query.departmentId && !departmentPathIds?.includes(query.departmentId)
        || !local && query.ownerId && owner?.id !== query.ownerId
        || warehouseIds && (!warehouse || !warehouseIds.includes(warehouse.id)))) throw new FopPermissionDeniedError('Unexpected unpaid filter result')
      if (!Array.isArray(row.items)) throw new Error('Invalid order lines')
      const lineIds = new Set<string>()
      const lines = row.items.map(value => {
        const line = object(value)
        const lineId = identifier(line.id)
        if (lineIds.has(lineId) || !Number.isSafeInteger(line.sequence)
          || (!(raw.schemaVersion === 1 && line.rowType == null) && !Number.isSafeInteger(line.rowType))) throw new Error('Invalid order line')
        lineIds.add(lineId)
        return { id: lineId, parentId: string(line.parentId, true), ...(line.rowType == null ? {} : { rowType: Number(line.rowType) }), sku: string(line.sku, true), name: string(line.name, true), variant: string(line.variant, true),
          quantity: decimal(line.quantity), imageUrl: line.imageUrl == null ? null : string(line.imageUrl, true).trim() || null, sequence: Number(line.sequence) }
      }).sort((left, right) => left.sequence - right.sequence).map(({ sequence: _sequence, ...line }) => line)
      const currency = string(row.currency)
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency')
      const order: FopOrder = {
        // 原金蝶查询尚未返回新工作台进度，沿用远程契约的未知状态，禁止推断配货或履约已完成。
        fulfillmentProgress: { allocationCreated: null, shopifySync: query.queue === 'dispatch' ? 'pending' : 'unknown', supplierShipment: 'unknown', stockReadiness: 'unknown', allocationReview: 'unknown', outbound: 'unknown' },
        id, organization, department, departmentPathIds, owner, customerId: customer?.id, orderNumber: string(row.orderNumber),
        shopifyOrderNumber: string(row.shopifyOrderNumber, true), customerName: customer?.name ?? '', storeName: store?.name ?? '',
        items: lines, amount: decimal(row.amount), currency, paymentStatus: unpaid ? 'unpaid' : 'paid', reviewStatus: billStatus === 'C' ? 'approved' : 'pending',
        procurementStatus: 'unknown', allocationStatus: 'unknown', dispatchStatus: 'unknown', shippingStatus: 'unknown',
        warehouse: warehouse?.name ?? '', carrier: null, trackingNumber: null, salesperson: owner?.name ?? '',
        createdAt: date(row.createdAt)!, paidAt: consumerPaidAt, cancelled: false, exception: null,
        ...(unpaid || query.queue === 'review' || dispatch ? { consumerPaidAt } : {}),
        ...(warehouse && warehouseMap[warehouse.id] ? { warehouseCode: warehouseMap[warehouse.id] } : {}),
        ...(unpaid ? { customLogisticsChannelName: row.customLogisticsChannelName == null ? null : string(row.customLogisticsChannelName, true),
          ...(warehouse && warehouseMap[warehouse.id] ? { warehouseCode: warehouseMap[warehouse.id] } : {}) } : {}),
      }
      if (dispatch) this.dispatchFields(order, row, query)
      return order
    })
    const totals = object(raw.totals)
    if (integer(totals.orderCount) !== total || !Array.isArray(totals.amountsByCurrency)) throw new Error('Invalid Kingdee totals')
    const currencies = new Set<string>()
    const amountsByCurrency = totals.amountsByCurrency.map(value => {
      const entry = object(value), currency = string(entry.currency)
      if (!/^[A-Z]{3}$/.test(currency) || currencies.has(currency)) throw new Error('Invalid currency total')
      currencies.add(currency)
      return { currency, amount: decimal(entry.amount) }
    })
    const options = (key: 'departments' | 'salespeople') => {
      if (!Array.isArray(raw[key])) throw new Error('Invalid dispatch filter options')
      const values = raw[key].map(value => reference(value)!)
      if (values.some(value => !value) || new Set(values.map(value => value.id)).size !== values.length) throw new Error('Invalid dispatch filter options')
      return values
    }
    let orderIds: string[] | undefined
    if (dispatch && query.exportManifest) {
      if (!summaryOnly || !Array.isArray(raw.orderIds) || raw.orderIds.length !== total || total > 10000) throw new Error('Invalid dispatch export manifest')
      orderIds = raw.orderIds.map(identifier)
      if (new Set(orderIds).size !== total) throw new Error('Invalid dispatch export manifest')
    }
    return { source: 'fop', total, page: query.page, pageSize: query.pageSize, items, organizationIds,
      ...(!summaryOnly && (unpaid || query.queue === 'review') ? { detailSources: raw.items.map(value => {
        const source = object(value)
        return { billStatus: source.billStatus, orderStatus: source.orderStatus, modifiedAt: source.modifiedAt }
      }) } : {}),
      ...(dispatch && !summaryOnly ? { departments: local ? [] : options('departments'), salespeople: local ? [] : options('salespeople') } : {}),
      ...(orderIds ? { orderIds } : {}),
      totals: { orderCount: total, itemQuantity: decimal(totals.itemQuantity), amountsByCurrency } }
  }

  /** Bounded reads under the same employee token. Never query unknown/customerless orders or cache recipients across users. */
  private async enrichOrderDetails(orders: FopOrder[], originals: JsonObject[]): Promise<void> {
    const deadline = Date.now() + 30_000
    let next = 0, bytes = 0, failed = false
    await Promise.all(Array.from({ length: Math.min(4, orders.length) }, async () => {
      while (!failed && next < orders.length) {
        const index = next++, order = orders[index]
        if (!order.customerId || !order.owner?.id) continue
        try {
          const detail = await this.call('FOP_KINGDEE_ORDER_DETAIL_URL', { data: { id: order.id }, pageNo: 1, pageSize: 1 }, deadline)
          bytes += Buffer.byteLength(JSON.stringify(detail))
          if (bytes > 16 * 1024 * 1024) throw new FopIntegrationUnavailableError('fop_result_too_large')
          applyKingdeeOrderDetail(order, originals[index], detail)
        } catch (error) { failed = true; throw error }
      }
    }))
  }

  /** 发运契约独立校验待履约四阶段或全部同步完成事实；旧空字段响应不能伪装接通。 */
  private dispatchFields(order: FopOrder, row: JsonObject, query: FopOrderPageQuery): void {
    const stage = string(row.dispatchTaskStatus)
    const completed = query.completed === true
    if (!(completed ? ['dispatch_synced'] : ['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved', 'unknown']).includes(stage)
      || object(row.fulfillmentProgress).shopifySync !== (completed ? 'synced' : 'pending') || !Array.isArray(row.dispatchDocuments) || !Array.isArray(row.logisticsInfo)
      || completed && row.dispatchDocuments.length === 0
      || query.taskStatus && stage !== query.taskStatus || query.orderIds && !query.orderIds.includes(order.id)) throw new Error('Invalid dispatch facts')
    order.dispatchTaskStatus = stage as NonNullable<FopOrder['dispatchTaskStatus']>
    if (completed) {
      // 审核日期与平台同步状态分开消费；旧同步时间字段不能替代约定的审核日期。
      if (!normalizeBusinessTimestamp(row.dispatchApprovedAt)) throw new Error('Invalid shipment approval time')
      order.dispatchApprovedAt = string(row.dispatchApprovedAt)
      order.fulfillmentProgress.shopifySync = 'synced'
    }
    const seen = new Set<string>()
    order.dispatchDocuments = row.dispatchDocuments.map(value => {
      const doc = object(value), id = identifier(doc.id), status = string(doc.status)
      if (seen.has(id) || !['draft', 'submitted', 'approved', 'unknown'].includes(status)) throw new Error('Invalid dispatch document')
      seen.add(id)
      return { id, number: string(doc.number), status: status as NonNullable<FopOrder['dispatchDocuments']>[number]['status'] }
    })
    order.logisticsInfo = row.logisticsInfo.map(value => {
      const group = object(value)
      const selected = group.shopifyTracking == null ? null : object(group.shopifyTracking)
      const type = selected ? string(selected.type) : null
      if (type && !['full', 'first_mile', 'last_mile'].includes(type)) throw new Error('Invalid Shopify tracking type')
      return { carrierName: group.carrierName == null ? null : string(group.carrierName, true),
        channelName: group.channelName == null ? null : string(group.channelName, true), channelCode: group.channelCode == null ? null : string(group.channelCode, true),
        shopifyTracking: selected ? { type: type as 'full' | 'first_mile' | 'last_mile', number: string(selected.number) } : null }
    })
    const recipient = row.shippingRecipient == null ? null : object(row.shippingRecipient)
    const optionalText = (key: string) => recipient?.[key] == null ? null : string(recipient[key], true)
    order.shippingRecipient = recipient ? { name: optionalText('name'), phone: optionalText('phone'), email: optionalText('email'),
      state: optionalText('state'), city: optionalText('city'), postalCode: optionalText('postalCode'), addressLine1: optionalText('addressLine1'), addressLine2: optionalText('addressLine2') } : null
    order.shippingCountryCode = row.shippingCountryCode == null ? null : string(row.shippingCountryCode)
    if (order.shippingCountryCode && !/^[A-Z]{2}$/.test(order.shippingCountryCode)) throw new Error('Invalid dispatch destination')
  }

  /** 沿用已有仓库映射配置，只按稳定主键匹配；缺映射时不能把仓库名称猜成HZ/SZ。 */
  private unpaidWarehouses(): Record<string, 'HZ' | 'SZ'> {
    const raw = this.config.get('FOP_KINGDEE_WAREHOUSE_MAP')?.trim()
    if (!raw) return {}
    const result = object(JSON.parse(raw))
    if (Object.keys(result).length > 200 || Object.entries(result).some(([id, code]) => !/^[1-9]\d{0,18}$/.test(id) || !['HZ', 'SZ'].includes(String(code)))) {
      throw new FopIntegrationUnavailableError('fop_mapping_required')
    }
    return result as Record<string, 'HZ' | 'SZ'>
  }

  /** 暂停覆盖业务读取、认证与重试；员工子适配器继承同一配置。 */
  private assertQueriesEnabled(): void {
    if (this.config.get('FOP_QUERIES_PAUSED')?.trim().toLowerCase() === 'true') throw new FopIntegrationUnavailableError('fop_queries_paused')
  }

  /** 合并并发取Token请求；仅自动认证模式刷新失效令牌，手工Token模式继续明确提示更新。 */
  private async accessToken(invalidToken?: string): Promise<string> {
    this.assertQueriesEnabled()
    if (!this.automaticTokenConfigured()) return this.config.get('FOP_KINGDEE_ACCESS_TOKEN')!.trim()
    if (invalidToken && this.cachedToken?.value === invalidToken) this.cachedToken = undefined
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) return this.cachedToken.value
    if (!this.tokenRequest) this.tokenRequest = this.obtainToken().finally(() => { this.tokenRequest = undefined })
    return this.tokenRequest
  }

  /** 增强型Token的有效期单位为毫秒；凭据与响应只留在服务端内存，不回传、不写日志。 */
  private async obtainToken(): Promise<string> {
    this.assertQueriesEnabled()
    const endpoint = this.endpoint('FOP_KINGDEE_TOKEN_URL')
    const response = await this.request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.requestTimeout()),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        client_id: this.config.get('FOP_KINGDEE_CLIENT_ID')!.trim(), client_secret: this.config.get('FOP_KINGDEE_CLIENT_SECRET')!,
        accountId: this.config.get('FOP_KINGDEE_ACCOUNT_ID')!.trim(), username: this.config.get('FOP_KINGDEE_USERNAME')!.trim(),
        nonce: randomUUID(), timestamp: new Date().toISOString(), language: 'zh_CN',
      }) })
    if (!response.ok) { await response.body?.cancel(); throw new FopPermissionDeniedError('Kingdee token request failed', 'fop_authentication_expired') }
    const envelope = await this.responseEnvelope(response, 64 * 1024)
    if (envelope.status !== true || String(envelope.errorCode) !== '0') {
      const message = typeof envelope.message === 'string' ? envelope.message : ''
      if (String(envelope.errorCode) === '603' && /代理用户/.test(message)) throw new FopPermissionDeniedError('该员工未加入金蝶应用代理用户名单，请在金蝶配置后重试', 'fop_proxy_user_required')
      if (String(envelope.errorCode) === '603' && /用户无效|用户不可用|用户.*无效或不可用/.test(message)) throw new FopPermissionDeniedError('金蝶员工账号无效或不可用，请核对当前数据中心的用户状态', 'fop_employee_unavailable')
      throw new FopPermissionDeniedError('Kingdee application authentication failed', 'fop_authentication_expired')
    }
    const data = object(envelope.data), value = string(data.access_token), duration = Number(data.expires_in)
    if (!Number.isSafeInteger(duration) || duration <= 30_000) throw new Error('Invalid Kingdee token expiry')
    this.cachedToken = { value, expiresAt: Date.now() + duration }
    return value
  }

  private endpoint(key: string): URL {
    const endpoint = new URL(this.config.get(key) ?? '')
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid Kingdee HTTPS endpoint')
    return endpoint
  }

  private requestTimeout(): number {
    const timeout = Number(this.config.get('FOP_KINGDEE_TIMEOUT_MS') ?? 10_000)
    return Number.isInteger(timeout) && timeout >= 1000 && timeout <= 30_000 ? timeout : 10_000
  }

  /** 所有上游JSON都限制读取体积；Token响应使用更小预算，异常路径同样释放响应流。 */
  private async responseEnvelope(response: Response, limit: number): Promise<JsonObject> {
    if (!response.body) throw new Error('Missing Kingdee response')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > limit) throw new FopIntegrationUnavailableError('fop_result_too_large')
        chunks.push(part.value)
      }
    } finally { await reader.cancel(); reader.releaseLock() }
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
  }

  /** Only overlapping, identical authorization reads share transport. Nothing survives settlement. */
  private async call(key: string, body: unknown, deadline?: number): Promise<unknown> {
    this.assertQueriesEnabled()
    if (deadline !== undefined || !['FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL', 'FOP_KINGDEE_ACCOUNT_STATES_URL', 'FOP_KINGDEE_STOCK_PERMISSIONS_URL'].includes(key)) {
      return this.performCall(key, body, deadline)
    }
    // The map belongs to this authenticated provider; employee identities never share a provider.
    const fingerprint = JSON.stringify([key, body])
    let pending = this.pendingPermissionReads.get(fingerprint)
    if (!pending) {
      pending = this.performCall(key, body).finally(() => { this.pendingPermissionReads.delete(fingerprint) })
      this.pendingPermissionReads.set(fingerprint, pending)
    }
    return structuredClone(await pending)
  }

  /** 只读网络/5xx失败至多重试一次；认证失效至多重取一次，不能形成循环或重放业务写入。 */
  private async performCall(key: string, body: unknown, deadline?: number, readOnly = true): Promise<unknown> {
    this.assertQueriesEnabled()
    const endpoint = this.endpoint(key), timeout = this.requestTimeout()
    let token = await this.accessToken(), retries = 0, refreshed = false
    while (true) {
      this.assertQueriesEnabled()
      const remaining = deadline === undefined ? timeout : deadline - Date.now()
      if (remaining <= 0) throw new FopIntegrationUnavailableError('fop_result_too_large')
      let response: Response
      try {
        response = await this.request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.min(timeout, remaining)),
          headers: { 'content-type': 'application/json', access_token: token,
            'x-acgw-identity': this.config.get('FOP_KINGDEE_IDENTITY')! }, body: JSON.stringify(body) })
      } catch {
        if (deadline !== undefined && Date.now() >= deadline) throw new FopIntegrationUnavailableError('fop_result_too_large')
        if (readOnly && retries++ === 0) continue
        throw new Error('Kingdee query transport unavailable')
      }
      if (response.status === 401) {
        await response.body?.cancel()
        if (readOnly && !refreshed && this.automaticTokenConfigured()) { refreshed = true; token = await this.accessToken(token); continue }
        throw new FopPermissionDeniedError('Kingdee authentication expired', 'fop_authentication_expired')
      }
      if (response.status === 403) throw new FopPermissionDeniedError('Kingdee authentication denied')
      if (response.status === 404) throw new FopIntegrationUnavailableError('fop_endpoint_not_published')
      // 网关以519返回的未订阅错误不属于可重试服务故障，明确提示应用API授权缺失。
      if (response.status === 519) {
        const gateway = await this.responseEnvelope(response, 64 * 1024)
        if (['2504','2505'].includes(String(gateway.errorCode))) throw new FopPermissionDeniedError('金蝶应用尚未授权当前接口', 'fop_api_not_authorized')
        if (String(gateway.errorCode) === '2530') throw new FopIntegrationUnavailableError('fop_endpoint_not_published')
        throw new Error('Kingdee gateway unavailable')
      }
      if (readOnly && response.status >= 500 && retries++ === 0) { await response.body?.cancel(); continue }
      if (!response.ok || !response.body) throw new Error('Kingdee query unavailable')
      const envelope = await this.responseEnvelope(response, 4 * 1024 * 1024)
      if (envelope.status !== true || String(envelope.errorCode) !== '0') {
        if (['2504', '2505'].includes(String(envelope.errorCode))) throw new FopPermissionDeniedError('金蝶应用尚未授权当前接口，请核对自建API授权', 'fop_api_not_authorized')
        // 金蝶可能以HTTP 200返回认证失败，不能把这种响应当作取数成功或普通业务异常。
        if (String(envelope.errorCode) === '401' || String(envelope.errorCode) === '612') {
          if (readOnly && !refreshed && this.automaticTokenConfigured()) { refreshed = true; token = await this.accessToken(token); continue }
          throw new FopPermissionDeniedError('Kingdee authentication expired', 'fop_authentication_expired')
        }
        const message = typeof envelope.message === 'string' ? envelope.message : ''
        // 只记录操作配置名和可识别错误分类，不输出URL、令牌、响应正文或客户信息。
        this.logger.warn(`Kingdee query failed: operation=${key}, category=${message.match(/FOP_[A-Z_]+/)?.[0] ?? 'UPSTREAM_ERROR'}`)
        if (/FOP_(?:IDENTITY_MISMATCH|PERMISSION_DENIED)/.test(message)) throw new FopPermissionDeniedError('Kingdee permission denied')
        if (/FOP_FX_MISSING/.test(message)) throw new FopIntegrationUnavailableError('fop_fx_missing')
        if (/FOP_RESULT_TOO_LARGE/.test(message)) throw new FopIntegrationUnavailableError('fop_result_too_large')
        throw new Error('Kingdee query business failure')
      }
      return envelope.data
    }
  }
}

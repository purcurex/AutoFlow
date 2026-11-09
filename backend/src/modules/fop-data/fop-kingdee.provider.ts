import type { ApprovalCommand, ApprovalOutcome, ApprovalQueue, ApprovalTarget } from './fop-approval.types'
import type { AllocationInventoryQueryDto } from './allocation-inventory.dto'
import type { AllocationInventoryPage } from './allocation-inventory'
import Decimal from 'decimal.js'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'
import type { BusinessScope } from '../users/business-scope'
import { matchesBusinessScope } from '../users/business-scope'
import { kingdeeDepartmentPath } from './fop-kingdee-scope'
import type { PurchaseHeader, PurchaseLinkSnapshot, PurchaseObligation } from './procurement-groups.types'
import { validatedPurchaseHeader } from './procurement-groups'
import { summarizeFopOrders } from './fop-order-totals'
import { KingdeeStockDecoder } from './fop-kingdee.stock'
import type { FopStockOrderCandidate, FopStockInventoryCandidate } from './fop-stock.types'
import { businessDate, normalizeBusinessTimestamp, validBusinessDay } from './fop-business-time'
import { emptyAnalyticsData, KingdeeAnalyticsDecoder } from './fop-kingdee.analytics'
import type { FopAnalyticsData, FopAnalyticsRange, FopAnalyticsResource, FopAnalyticsScope, FopConnectionContext } from './fop-data.types'
import { FopDataProvider, FopIdentity, FopIntegrationUnavailableError, FopOrder, FopOrderPage, FopOrderPageQuery, FopPermissionDeniedError, FopPermissionGrant, FopWorkbenchOrders } from './fop-data.types'
import type { FopBindingEmployee, FopBindingEmployeePage, FopEmployeeBindingDetails, VerifiedFopEmployeeBinding } from './fop-employee-binding'
import { parseKingdeeEnvelope } from './fop-kingdee-json'
import { projectWorkbenchFacts } from './workbench-facts-projector'

type Configuration = { get(key: string): string | undefined }
type JsonObject = Record<string, unknown>
type BindingResolver = (identity: Readonly<FopIdentity>) => Promise<FopEmployeeBindingDetails | null>
// 原始数量最多60字符，保留多包裹累计所需余量；独立精度不影响其他业务的Decimal配置。
const AllocationQuantity = Decimal.clone({ precision: 80 })

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
  readonly pagedOrders = true
  readonly workbenchFacts: boolean
  readonly queriedStock = true
  readonly supportsEmployeeBinding = true
  // 既有金蝶接口提供单据历史归属，明确声明兼容模式；不将其伪装成客户当前归属。
  readonly customerOwnershipMode = 'legacy_historical' as const
  private readonly logger = new Logger(KingdeeFopDataProvider.name)
  private readonly configuredOrganizations: string[]
  private connection?: FopConnectionContext
  private cachedToken?: { value: string; expiresAt: number }
  private tokenRequest?: Promise<string>
  private readonly userProviders = new Map<string, { fingerprint: string; provider: KingdeeFopDataProvider }>()
  constructor(private readonly config: Configuration, private readonly request: typeof fetch = fetch, private readonly resolveBinding?: BindingResolver) {
    super()
    this.workbenchFacts = config.get('FOP_KINGDEE_WORKBENCH_FACTS_MODE') === 'raw'
    this.configuredOrganizations = (config.get('FOP_KINGDEE_ORGANIZATION_IDS') ?? '').split(',').map(value => value.trim()).filter(Boolean)
  }

  /** 每次读取当前绑定再选择独立适配器；令牌、刷新Promise及当前组织绝不跨员工共享。 */
  private async userProvider(identity: Readonly<FopIdentity>, resolvedBinding?: FopEmployeeBindingDetails | null): Promise<KingdeeFopDataProvider> {
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
    const links: PurchaseLinkSnapshot['orders'] = []
    const items = raw.items.map(value => {
      const row = object(value), id = identifier(row.id), membershipId = identifier(row.membershipId)
      const rowKey = `${id}:${membershipId}`
      if (seen.has(rowKey) || !['active','disabled','unknown'].includes(String(row.state))) throw new Error('Invalid employee membership')
      seen.add(rowKey)
      return { id, membershipId, masterId: identifier(row.masterId), departmentId: identifier(row.departmentId),
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
  async verifyEmployeeBinding(employeeId: string, membershipId: string): Promise<VerifiedFopEmployeeBinding> {
    if (!this.automaticTokenConfigured()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    identifier(employeeId); identifier(membershipId)
    const directory = await this.getConnectionContext(), cursors = new Set<string>(), deadline = Date.now() + 30_000
    let cursor: string | undefined, scopeVersion: string | undefined
    for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
      const page = await this.directoryPage(directory, cursor, scopeVersion, deadline)
      const employee = page.items.find(row => row.id === employeeId && row.membershipId === membershipId)
      if (employee) {
        if (employee.state !== 'active' || !employee.username.trim() || employee.username.length > 128) throw new FopPermissionDeniedError('Employee is not enabled', 'fop_employee_unavailable')
        const provider = this.employeeProvider(employee.username, directory.currentOrganization.id)
        const { connection } = await provider.connectionGrant(true)
        // id/masterId均来自同一条受控目录记录；认证ID使用Context实值，业务归属另用masterId。
        if (connection.subject.tenantId !== directory.subject.tenantId || connection.currentOrganization.id !== directory.currentOrganization.id
          || ![employee.id, employee.masterId].includes(connection.subject.userId)) throw new FopPermissionDeniedError('Employee authenticated identity mismatch')
        const details: FopEmployeeBindingDetails = { username: employee.username, name: employee.name, employeeRecordId: employee.id,
          employeeMasterId: employee.masterId, departmentId: employee.departmentId, organizationId: connection.currentOrganization.id,
          localEmployeeId: null, localDepartmentId: null, verifiedAt: new Date().toISOString() }
        await this.requireActiveEmployee(details)
        return { ...connection.subject, details }
      }
      if (!page.nextCursor) break
      if (cursors.has(page.nextCursor)) throw new Error('Repeated employee directory cursor')
      cursors.add(page.nextCursor); cursor = page.nextCursor; scopeVersion = page.scopeVersion
    }
    throw new FopPermissionDeniedError('Employee is not visible in the current company')
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
    const required = ['FOP_KINGDEE_QUERY_URL', 'FOP_KINGDEE_SUMMARY_URL', 'FOP_KINGDEE_IDENTITY']
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
    const actions = raw.approvalActions ?? []
    if (!Array.isArray(actions) || actions.some(action => action !== 'allocation_review')) throw new Error('Invalid approval actions')
    return { subject: { ...identity }, allowedOrderIds: [], analyticsQuery, analyticsScopes, approvalActions: actions as ApprovalQueue[],
      ...(analyticsQuery.orders!.length ? { orderQuery: { queues: queues as ('unpaid' | 'review' | 'dispatch')[], organizationIds: analyticsQuery.orders! } } : {}) }
  }

  /** 实际读取认证后的汇总响应确认权限；禁止配置文件或本地 admin 单独伪造金蝶授权。 */
  async resolvePermissions(identity: Readonly<FopIdentity>, scope?: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    if (this.resolveBinding) {
      const binding = await this.resolveBinding(identity)
      const provider = await this.userProvider(identity, binding)
      if (!binding) throw new FopPermissionDeniedError('Employee binding changed', 'fop_binding_required')
      await this.requireActiveEmployee(binding)
      return provider.resolvePermissions(identity, scope)
    }
    if (!scope || scope.role === 'none') throw new FopPermissionDeniedError('Business scope required')
    if (!this.config.get('FOP_KINGDEE_TENANT_ID')?.trim() || !this.config.get('FOP_KINGDEE_USER_ID')?.trim() || !this.configuredOrganizations.length) {
      const { grant } = await this.connectionGrant()
      this.assertIdentity(identity)
      return grant
    }
    this.assertIdentity(identity)
    if (this.config.get('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL')?.trim()) {
      const raw = object(await this.call('FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL', { query: this.analyticsQuery(identity, scope) }))
      return this.analyticsGrant(raw, identity, this.organizationIds)
    }
    const page = await this.read(identity, scope, { queue: 'review', page: 1, pageSize: 1 }, true)
    return { subject: { ...identity }, allowedOrderIds: [], orderQuery: { queues: ['review'], organizationIds: page.organizationIds } }
  }

  async listOrders(): Promise<never> { throw new FopIntegrationUnavailableError('fop_feature_not_configured') }

  /** 仅备货入口调用独立授权接口；不让备货发布/配置故障阻塞原履约查询。 */
  async resolveStockPermissions(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>): Promise<FopPermissionGrant> {
    if (this.resolveBinding) {
      const binding = await this.resolveBinding(identity), provider = await this.userProvider(identity, binding)
      if (!binding) throw new FopPermissionDeniedError('Employee binding changed', 'fop_binding_required')
      await this.requireActiveEmployee(binding)
      return provider.resolveStockPermissions(identity, scope)
    }
    if (!this.config.get('FOP_KINGDEE_STOCK_PERMISSIONS_URL')?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!this.connection && (!this.config.get('FOP_KINGDEE_TENANT_ID')?.trim() || !this.config.get('FOP_KINGDEE_USER_ID')?.trim() || !this.configuredOrganizations.length)) await this.getConnectionContext()
    this.assertIdentity(identity)
    const raw = object(await this.call('FOP_KINGDEE_STOCK_PERMISSIONS_URL', { query: this.analyticsQuery(identity, scope) }))
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
    return { subject: { ...identity }, allowedOrderIds: [], stockQuery: { orders: organizations('orders'), inventory: organizations('inventory') } }
  }

  /** 分页收集限制60秒、64MB和十万行，缺页/重复/权限变化均失败，不返回截断合计。 */
  private async stockRows(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, resource: 'orders' | 'inventory'): Promise<unknown[]> {
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Stock permission identity mismatch')
    const organizations = permission.stockQuery?.[resource]
    if (!organizations?.length) throw new FopPermissionDeniedError('Stock resource not authorized')
    const key = resource === 'orders' ? 'FOP_KINGDEE_STOCK_ORDERS_URL' : 'FOP_KINGDEE_STOCK_INVENTORY_URL'
    if (!this.config.get(key)?.trim()) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const rows: unknown[] = [], seen = new Set<string>(), deadline = Date.now() + 60_000
    let bytes = 0
    for (let page = 1; page <= 1000; page++) {
      const raw = object(await this.call(key, { query: { ...this.analyticsQuery(identity, scope), page, pageSize: 100 } }, deadline))
      this.analyticsSubject(raw, identity)
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
  async listStockOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope?: Readonly<BusinessScope>): Promise<FopStockOrderCandidate[]> {
    if (this.resolveBinding) return (await this.userProvider(identity)).listStockOrders(identity, permission, scope)
    if (!scope) throw new FopPermissionDeniedError('Stock business scope required')
    const decoder = new KingdeeStockDecoder(this.config)
    return (await this.stockRows(identity, permission, scope, 'orders')).map(row => decoder.order(row, identity, scope, permission.stockQuery!.orders))
  }

  /** 允许历史台账存在同客户/SKU/仓库多行；按精确维度合并，余额使用Decimal累加。 */
  async listStockInventory(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope?: Readonly<BusinessScope>): Promise<FopStockInventoryCandidate[]> {
    if (this.resolveBinding) return (await this.userProvider(identity)).listStockInventory(identity, permission, scope)
    if (!scope) throw new FopPermissionDeniedError('Stock business scope required')
    const decoder = new KingdeeStockDecoder(this.config), groups = new Map<string, FopStockInventoryCandidate>()
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

  async queryOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly = false): Promise<FopOrderPage> {
    if (this.resolveBinding) return (await this.userProvider(identity)).queryOrders(identity, permission, scope, query, summaryOnly)
    this.assertIdentity(identity)
    if (!['unpaid', 'review', 'dispatch'].includes(query.queue) || !permission.orderQuery?.queues.includes(query.queue as 'unpaid' | 'review' | 'dispatch')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    // 待支付沿用服务端解析出的角色范围；业务员不能借筛选切换到其他人。
    if (query.queue === 'unpaid' && scope.role === 'salesperson') {
      if (query.ownerId && query.ownerId !== scope.employeeId) throw new FopPermissionDeniedError('Unpaid orders are personal only')
    }
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Permission identity mismatch')
    const { organizationIds, ...page } = await this.read(identity, scope, query, summaryOnly)
    if (organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Organization grant changed')
    return page
  }

  /** 共用已登记的员工订单page入口。游标按金蝶主键前进，超过限额整次失败，禁止返回截断的采购组。 */
  async readPendingProcurement(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, warehouseCode?: string, queue: 'procurement' | 'procurement_shipping' = 'procurement'): Promise<{ orders: FopOrder[]; snapshot: PurchaseLinkSnapshot; purchaseIds: string[] }> {
    if (this.resolveBinding) return (await this.userProvider(identity)).readPendingProcurement(identity, permission, scope, warehouseCode, queue)
    if (this.workbenchFacts) {
      const result = await this.workbenchSnapshot(identity, permission, scope, { queue, page: 1, pageSize: 100 })
      return { orders: result.orders, snapshot: { subject: { ...identity }, exactSourceLines: true, orders: result.links }, purchaseIds: result.purchaseIds }
    }
    if (warehouseCode !== undefined && warehouseCode !== 'HZ' && warehouseCode !== 'SZ') throw new Error('Invalid procurement warehouse')
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId || !permission.orderQuery?.organizationIds.length)
      throw new FopPermissionDeniedError('Missing procurement order grant')
    const snapshot: PurchaseLinkSnapshot = { subject: { ...identity }, exactSourceLines: true, orders: [] }
    const orders: FopOrder[] = [], purchaseIds = new Set<string>(), started = Date.now()
    let afterOrderId: string | undefined, bytes = 0
    for (let page = 1; page <= 100; page++) {
      const result = await this.read(identity, scope, { queue, page, pageSize: 100, warehouseCode }, false, afterOrderId)
      if (result.organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Organization grant changed')
      if (!result.procurement) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
      bytes += result.procurement.bytes
      if (bytes > 64 * 1024 * 1024 || Date.now() - started > 60000) throw new FopIntegrationUnavailableError('fop_result_too_large')
      for (const order of result.items) {
        if (afterOrderId && new Decimal(order.id).lte(afterOrderId)) throw new Error('Invalid procurement cursor')
        afterOrderId = order.id
      }
      for (const link of result.procurement.links) {
        for (const obligation of link.obligations ?? []) if (obligation.purchase) purchaseIds.add(obligation.purchase.id)
        if (link.obligations?.length) snapshot.orders.push(link)
      }
      const pending = new Set(result.procurement.links.filter(link => link.obligations?.length).map(link => link.orderId))
      orders.push(...result.items.filter(order => pending.has(order.id)))
      if (!result.procurement.more) return { orders, snapshot, purchaseIds: [...purchaseIds] }
      afterOrderId = result.procurement.next
    }
    throw new FopIntegrationUnavailableError('fop_result_too_large')
  }

  private approvalQuery(identity: Readonly<FopIdentity>, orderId: string, scope?: Readonly<BusinessScope>) {
    this.assertIdentity(identity); identifier(orderId)
    if (!scope || scope.role === 'none') throw new FopPermissionDeniedError('Missing approval business scope')
    return { tenantId: identity.tenantId, userId: identity.userId, organizationIds: this.organizationIds, scopeRole: scope.role,
      employeeId: scope.employeeId, departmentIds: scope.departmentId ? [scope.departmentId] : [],
      queue: 'allocation_review', orderIds: [orderId], page: 1, pageSize: 100 }
  }

  async approvalTargets(identity: Readonly<FopIdentity>, queue: ApprovalQueue, orderId: string, scope?: Readonly<BusinessScope>): Promise<ApprovalTarget[]> {
    if (this.resolveBinding) return (await this.userProvider(identity)).approvalTargets(identity, queue, orderId, scope)
    if (queue !== 'allocation_review') throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const raw = object(await this.call('FOP_KINGDEE_ALLOCATION_APPROVAL_TARGETS_URL', { query: this.approvalQuery(identity, orderId, scope) }))
    const subject = object(raw.subject)
    if (subject.tenantId !== identity.tenantId || subject.userId !== identity.userId) throw new FopPermissionDeniedError('Approval identity mismatch')
    if (!Array.isArray(raw.items) || raw.items.length > 100) throw new Error('Invalid approval targets')
    return raw.items.map(value => object(value) as unknown as ApprovalTarget)
  }

  async approveDocument(identity: Readonly<FopIdentity>, command: ApprovalCommand, scope?: Readonly<BusinessScope>): Promise<ApprovalOutcome> {
    if (this.resolveBinding) return (await this.userProvider(identity)).approveDocument(identity, command, scope)
    if (command.entity !== 'hzkj_alloc_bill' || command.operation !== 'audit' || command.tenantId !== identity.tenantId) throw new Error('Invalid allocation command')
    identifier(command.id)
    // 审核可能已在上游提交成功；断网、超时和5xx均不能自动重复提交。
    const raw = object(await this.call('FOP_KINGDEE_ALLOCATION_APPROVE_URL', {
      query: this.approvalQuery(identity, command.orderId, scope), command: { orderId: command.orderId, id: command.id, version: command.version },
    }, undefined, false))
    return raw as unknown as ApprovalOutcome
  }

  /** 独立即时库存入口在金蝶核对库存、客户和仓库权限，不能从订单可见性推导库存授权。 */
  async queryAllocationInventory(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: AllocationInventoryQueryDto): Promise<AllocationInventoryPage> {
    if (this.resolveBinding) return (await this.userProvider(identity)).queryAllocationInventory(identity, permission, scope, query)
    this.assertIdentity(identity)
    if (scope.role === 'none' || permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Invalid inventory identity')
    const warehouses = this.unpaidWarehouses(), warehouseIds = query.warehouseCode ? Object.keys(warehouses).filter(id => warehouses[id] === query.warehouseCode) : undefined
    if (warehouseIds && !warehouseIds.length) throw new FopIntegrationUnavailableError('fop_mapping_required')
    const raw = object(await this.call('FOP_KINGDEE_ALLOCATION_INVENTORY_URL', { query: {
      tenantId: identity.tenantId, userId: identity.userId, organizationIds: this.organizationIds, scopeRole: scope.role,
      employeeId: scope.employeeId, departmentIds: scope.departmentId ? [scope.departmentId] : [], queue: query.queue ?? 'allocation',
      orderIds: query.mode === 'selected' ? query.orderIds : undefined, search: query.mode === 'search' ? query.search : undefined,
      warehouseIds, page: query.page, pageSize: query.pageSize,
    } }))
    const subject = object(raw.subject)
    if (subject.tenantId !== identity.tenantId || subject.userId !== identity.userId || !Array.isArray(raw.organizationIds) || !raw.organizationIds.length
      || raw.organizationIds.some(id => !this.organizationIds.includes(String(id)))) throw new FopPermissionDeniedError('Inventory response identity mismatch')
    if (raw.schemaVersion !== 1 || raw.complete !== true || !Array.isArray(raw.items) || raw.page !== query.page || raw.pageSize !== query.pageSize || raw.items.length > query.pageSize) throw new Error('Incomplete inventory response')
    const ids = new Set<string>()
    const items = raw.items.map(value => {
      const row = object(value), id = string(row.id), warehouseCode = warehouses[identifier(row.warehouseKey)], customer = reference(row.customer)
      if (!warehouseCode || ids.has(id) || query.warehouseCode && warehouseCode !== query.warehouseCode) throw new Error('Invalid inventory pool')
      ids.add(id)
      const onHand = decimal(row.onHand), occupied = decimal(row.occupied)
      if (onHand < 0 || occupied < 0) throw new Error('Invalid inventory quantity')
      return { id, sku: string(row.sku), name: string(row.name), warehouseCode, warehouse: string(row.warehouse), customer: customer ?? null,
        onHand, occupied, free: Decimal.max(0, new Decimal(row.onHand as string).minus(row.occupied as string)).toNumber() }
    })
    const total = integer(raw.total)
    if (total < items.length) throw new Error('Invalid inventory total')
    return { items, total, page: query.page, pageSize: query.pageSize, asOf: date(raw.asOf)!, source: this.source }
  }

  /** 各页游标只向前推进；空候选页不能提前终止，超时或超过限额不能返回截断清单。 */
  async readAllocationOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, queue: 'allocation' | 'allocation_review' | 'shipping', completed = false, timeRange?: '1w' | '1m' | '3m'): Promise<FopOrder[]> {
    if (this.resolveBinding) return (await this.userProvider(identity)).readAllocationOrders(identity, permission, scope, queue, completed, timeRange)
    if (this.workbenchFacts) return (await this.workbenchSnapshot(identity, permission, scope, { queue, completed, timeRange, page: 1, pageSize: 100 })).orders
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId || !permission.orderQuery?.organizationIds.length) throw new FopPermissionDeniedError('Missing order grant')
    const result: FopOrder[] = [], seen = new Set<string>(), started = Date.now()
    let afterOrderId: string | undefined, bytes = 0
    for (let page = 1; page <= 100; page++) {
      const response = await this.read(identity, scope, { queue, page, pageSize: 100, ...(completed ? { completed: true, timeRange: timeRange ?? '1w' } : {}) }, false, afterOrderId)
      if (response.organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Organization grant changed')
      if (!response.allocation) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
      bytes += response.allocation.bytes
      if (bytes > 64 * 1024 * 1024 || Date.now() - started > 60000) throw new FopIntegrationUnavailableError('fop_result_too_large')
      for (const row of response.items) {
        if (seen.has(row.id) || afterOrderId && new Decimal(row.id).lte(afterOrderId)) throw new Error('Repeated allocation order')
        seen.add(row.id); result.push(row)
      }
      if (!response.allocation.more) return result
      afterOrderId = response.allocation.next
    }
    throw new FopIntegrationUnavailableError('fop_result_too_large')
  }

  /** 新模式统一读取完整候选；Java只应用认证、组织/数据权限及稳定主键分页。 */
  async readWorkbenchOrders(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery): Promise<FopWorkbenchOrders> {
    if (this.resolveBinding) return (await this.userProvider(identity)).readWorkbenchOrders(identity, permission, scope, query)
    if (!this.workbenchFacts) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    return this.workbenchSnapshot(identity, permission, scope, query)
  }

  private async workbenchSnapshot(identity: Readonly<FopIdentity>, permission: Readonly<FopPermissionGrant>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery) {
    this.assertIdentity(identity)
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId || !permission.orderQuery?.organizationIds.length
      || scope.role === 'none' || scope.role === 'salesperson' && !scope.employeeId || scope.role === 'department_manager' && !scope.departmentId) throw new FopPermissionDeniedError('Missing workbench scope')
    const orders: FopOrder[] = [], links: PurchaseLinkSnapshot['orders'] = [], purchases = new Set<string>(), seen = new Set<string>()
    let departments: { id: string; name: string }[] = []
    const deadline = Date.now() + 60_000
    let afterOrderId: string | undefined, bytes = 0
    const warehouseMap = this.unpaidWarehouses()
    for (let page = 1; page <= 100; page++) {
      const raw = object(await this.call('FOP_KINGDEE_QUERY_URL', { query: { tenantId: identity.tenantId, userId: identity.userId,
        organizationIds: this.organizationIds, scopeRole: scope.role, employeeId: scope.employeeId, departmentIds: scope.departmentId ? [scope.departmentId] : [],
        queue: query.queue, rawWorkbenchFacts: true, page, pageSize: 100, afterOrderId } }, deadline))
      this.analyticsSubject(raw, identity)
      if (raw.workbenchFactsSchemaVersion !== 1) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
      if (raw.queue !== query.queue || raw.page !== page || raw.pageSize !== 100 || typeof raw.hasMore !== 'boolean' || !Array.isArray(raw.items) || raw.items.length > 100
        || !Array.isArray(raw.organizationIds) || !raw.organizationIds.length) throw new Error('Invalid workbench facts page')
      const organizations = raw.organizationIds.map(identifier)
      if (page === 1) {
        if (!Array.isArray(raw.departments) || raw.departments.length > 2000) throw new Error('Invalid workbench department options')
        departments = raw.departments.map(value => { const row = object(value); return { id: identifier(row.id), name: string(row.name, true) } })
        if (new Set(departments.map(row => row.id)).size !== departments.length) throw new Error('Duplicate workbench department option')
      }
      if (organizations.some(id => !this.organizationIds.includes(id) || !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Workbench organization changed')
      bytes += Buffer.byteLength(JSON.stringify(raw))
      if (bytes > 64 * 1024 * 1024 || Date.now() > deadline) throw new FopIntegrationUnavailableError('fop_result_too_large')
      let last = afterOrderId
      for (const value of raw.items) {
        const id = identifier(object(value).id)
        if (seen.has(id) || last && BigInt(id) <= BigInt(last)) throw new Error('Invalid workbench order cursor')
        seen.add(id); last = id
      }
      const projected = projectWorkbenchFacts(raw.items, raw.facts, organizations, scope, query, warehouseMap)
      orders.push(...projected.orders); links.push(...projected.links); projected.purchaseIds.forEach(id => purchases.add(identifier(id)))
      if (Date.now() > deadline) throw new FopIntegrationUnavailableError('fop_result_too_large')
      if (!raw.hasMore) return { orders, links, purchaseIds: [...purchases], departments }
      const next = identifier(raw.nextAfterOrderId)
      if (!raw.items.length || next !== last) throw new Error('Invalid workbench continuation')
      afterOrderId = next
    }
    throw new FopIntegrationUnavailableError('fop_result_too_large')
  }

  /** 按授权履约行解码。同一采购单关联多个履约行时合并一次；线下未知值贯穿展示与导出。 */
  private purchaseObligations(raw: unknown, order: FopOrder): PurchaseObligation[] {
    if (!Array.isArray(raw)) throw new Error('Missing procurement facts')
    const groups = new Map<string, PurchaseObligation>()
    const items = new Map(order.items.map(item => [item.id, item.sku]))
    for (const value of raw) {
      const record = object(value)
      const po = record.purchase == null ? null : object(record.purchase)
      const supplier = po ? reference(po.supplier == null || object(po.supplier).id == null ? null : po.supplier) : undefined
      const purchase = po ? validatedPurchaseHeader({
        ...po, supplier: { id: supplier?.id ?? '', name: supplier?.name || '—' }, platform: po.platform ?? null, paidAt: po.paidAt ?? null, platformOrderNumber: po.platformOrderNumber ?? null,
      } as PurchaseHeader, true) : null
      if (purchase) identifier(purchase.id)
      if (!Array.isArray(record.lines) || !record.lines.length) throw new Error('Missing procurement lines')
      const key = purchase?.id ?? 'uncreated', group = groups.get(key) ?? { purchase, lines: [] }
      if (JSON.stringify(purchase) !== JSON.stringify(group.purchase)) throw new Error('Inconsistent linked purchase')
      for (const value of record.lines) {
        const row = object(value), id = identifier(row.fulfillmentLineId), sku = string(row.sku)
        const demandStage = row.demandStage
        if (items.get(id) !== sku || (!purchase && demandStage !== 'application_pending' && demandStage !== 'purchase_order_pending')
          || purchase && demandStage != null || !purchase && row.purchaseLineId != null) throw new Error('Invalid procurement source')
        if (purchase && purchase.platform !== '1688' && row.shippedQuantity != null) throw new Error('Unverified shipment quantity')
        group.lines.push({ fulfillmentLineId: id, purchaseLineId: purchase ? identifier(row.purchaseLineId) : null,
          sku, quantity: decimal(row.quantity), shippedQuantity: row.shippedQuantity == null ? null : decimal(row.shippedQuantity),
          ...(!purchase ? { demandStage: demandStage as 'application_pending' | 'purchase_order_pending' } : {}) })
      }
      groups.set(key, group)
    }
    return [...groups.values()]
  }

  private async read(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly: boolean, afterOrderId?: string): Promise<FopOrderPage & { organizationIds: string[]; allocation?: { more: boolean; next?: string; bytes: number }; procurement?: { links: PurchaseLinkSnapshot['orders']; more: boolean; next?: string; bytes: number } }> {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 1_000_000 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) throw new Error('Invalid page')
    if (scope.role === 'none' || (scope.role === 'salesperson' && !scope.employeeId) || (scope.role === 'department_manager' && !scope.departmentId)) throw new FopPermissionDeniedError('Incomplete business scope')
    const procurement = query.queue === 'procurement' || query.queue === 'procurement_shipping'
    const allocation = ['allocation', 'allocation_review', 'shipping'].includes(query.queue)
    const unpaid = query.queue === 'unpaid'
    const dispatch = query.queue === 'dispatch'
    const completed = query.completed === true
    if (completed && !dispatch && query.queue !== 'shipping') throw new Error('Unsupported completed queue')
    if (allocation && (completed && query.timeRange !== undefined && !['1w', '1m', '3m'].includes(query.timeRange) || !completed && query.timeRange !== undefined)) throw new Error('Invalid allocation completion range')
    const warehouseMap = unpaid || dispatch || procurement || allocation ? this.unpaidWarehouses() : {}
    const warehouseIds = query.warehouseCode ? Object.keys(warehouseMap).filter(id => warehouseMap[id] === query.warehouseCode) : undefined
    if ((unpaid || dispatch || procurement || allocation) && warehouseIds && !warehouseIds.length) throw new FopIntegrationUnavailableError('fop_mapping_required')
    if (dispatch && ((completed
      ? query.taskStatus !== undefined || query.timeRange !== undefined && !['1w', '1m', '3m'].includes(query.timeRange)
      : query.timeRange !== undefined || query.taskStatus !== undefined && !['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved'].includes(query.taskStatus))
      || query.sortBy !== undefined && !(completed ? ['completedAt', 'paidAt', 'consumerPaidAt'] : ['paidAt', 'consumerPaidAt', 'dispatchDocumentStatus']).includes(query.sortBy)
      || query.orderIds !== undefined && (!query.orderIds.length || query.orderIds.length > 100 || new Set(query.orderIds).size !== query.orderIds.length))) throw new Error('Invalid dispatch filters')
    if (unpaid && (query.timeRange !== undefined && !['all', '1w', '1m', '3m'].includes(query.timeRange)
      || query.sortBy !== undefined && !['paidAt', 'consumerPaidAt'].includes(query.sortBy))) throw new Error('Invalid unpaid filters')
    const body = { query: { tenantId: identity.tenantId, userId: identity.userId, organizationIds: this.organizationIds,
      scopeRole: scope.role, employeeId: scope.employeeId, departmentIds: scope.departmentId ? [scope.departmentId] : [],
      search: query.search ?? '', orderNumber: query.orderNumber ?? '', page: query.page, pageSize: query.pageSize,
      ...(procurement || allocation ? { queue: query.queue, afterOrderId, warehouseIds,
        ...(allocation ? { rawAllocationQuantities: true } : {}),
        ...(allocation && completed ? { completed: true, timeRange: query.timeRange ?? '1w' } : {}) } : {}),
      ...(dispatch ? { queue: 'dispatch', departmentId: query.departmentId, ownerId: query.ownerId, warehouseIds, taskStatus: query.taskStatus,
        ...(completed ? { completed: true, timeRange: query.timeRange ?? '1w' } : {}),
        sortBy: query.sortBy ?? (completed ? 'completedAt' : 'paidAt'), sortOrder: query.sortOrder ?? (completed ? 'desc' : query.paidAtOrder ?? 'asc'),
        orderIds: query.orderIds, exportManifest: query.exportManifest } : {}),
      // 待审核已有C端付款时间排序入口，交给金蝶在分页前按源单付款时间执行。
      ...(query.queue === 'review' && query.sortBy === 'consumerPaidAt'
        ? { sortBy: 'consumerPaidAt', sortOrder: query.sortOrder ?? 'asc' } : {}),
      ...(unpaid ? { queue: 'unpaid', timeRange: query.timeRange, departmentId: query.departmentId, ownerId: query.ownerId, warehouseIds,
        sortBy: query.sortBy ?? 'paidAt', sortOrder: query.sortOrder ?? query.paidAtOrder ?? 'asc' } : {}) } }
    const raw = object(await this.call(summaryOnly ? 'FOP_KINGDEE_SUMMARY_URL' : 'FOP_KINGDEE_QUERY_URL', body))
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error('Unsupported employee order schema')
    const subject = object(raw.subject)
    if (subject.tenantId !== identity.tenantId || subject.userId !== identity.userId) throw new FopPermissionDeniedError('Kingdee response identity mismatch')
    // 完成能力必须由上游显式确认，旧接口即使返回空页也不能冒充已接通。
    if (completed && (raw.completed !== true || (allocation ? raw.outboundCompletedSchemaVersion !== 1 : raw.completedSchemaVersion !== 2))) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (!completed && raw.completed === true) throw new Error('Unexpected completed response')
    if (procurement && (raw.procurementSchemaVersion !== 1 || typeof raw.hasMore !== 'boolean')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (query.queue === 'procurement_shipping' && raw.procurementShippingSchemaVersion !== 1) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (allocation && (raw.allocationSchemaVersion !== 1 && raw.allocationSchemaVersion !== 2
      || typeof raw.hasMore !== 'boolean')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const expectedBasis = allocation ? 'paid_approved_allocation_packages' : procurement ? 'paid_approved_procurement' : unpaid ? 'unpaid_active_self' : dispatch ? completed ? 'paid_tracking_synced_active' : 'paid_tracking_pending_active' : 'submitted_paid_active'
    if (raw.queue !== query.queue || raw.basis !== expectedBasis || !Array.isArray(raw.organizationIds)
      || raw.organizationIds.length === 0 || raw.organizationIds.some(id => !this.organizationIds.includes(String(id)))) throw new FopPermissionDeniedError('Kingdee response scope mismatch')
    if (dispatch && raw.dispatchSchemaVersion !== 1) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    const organizationIds = raw.organizationIds.map(identifier)
    const total = (procurement || allocation) && Array.isArray(raw.items) ? raw.items.length : integer(raw.total)
    if (raw.page !== query.page || raw.pageSize !== query.pageSize || !Array.isArray(raw.items)
      || raw.items.length > (summaryOnly ? 0 : query.pageSize) || total < raw.items.length) throw new Error('Invalid Kingdee page')
    const seen = new Set<string>()
    const links: PurchaseLinkSnapshot['orders'] = []
    const items = raw.items.map(value => {
      const row = object(value)
      const id = identifier(row.id)
      const organization = reference(row.organization)
      if (seen.has(id) || !organization || !organizationIds.includes(organization.id)) throw new FopPermissionDeniedError('Unexpected order organization or duplicate')
      seen.add(id)
      // 待审核包含已支付但尚未审核的草稿，不以“已提交”作为额外门槛。
      const billStatus = string(row.billStatus)
      if (query.queue === 'review' && billStatus === 'C' || procurement && (billStatus !== 'C' || !['2', '3', '5'].includes(string(row.orderStatus))) || (dispatch || allocation) && billStatus !== 'C' || !(unpaid ? ['1'] : ['2', '3', '4', '5']).includes(string(row.orderStatus))) throw new Error('Unexpected review order status')
      const owner = reference(row.owner)
      const department = reference(row.department)
      if (!department) throw new FopPermissionDeniedError('Order department missing')
      const departmentPathIds = kingdeeDepartmentPath(row.departmentPathIds, organization.id, department.id, raw.schemaVersion === 1)
      if (!matchesBusinessScope(scope, { owner, department, departmentPathIds }, dispatch || procurement || allocation)) throw new FopPermissionDeniedError('Order outside local business scope')
      const customer = reference(raw.schemaVersion === 1 ? row.customer ?? null : row.customer)
      const store = reference(raw.schemaVersion === 1 ? row.store ?? null : row.store)
      const warehouse = reference(raw.schemaVersion === 1 ? row.warehouse ?? null : row.warehouse)
      // 两个清单都消费源单付款时间；旧响应缺值保持空，不借用创建或收款日期。
      const consumerPaidAt = unpaid || query.queue === 'review' || dispatch || allocation ? date(row.consumerPaidAt ?? null, true) : undefined
      // 时间边界由金蝶用同一时钟过滤和汇总，避免两端毫秒差将合法边界记录误拒绝。
      if ((unpaid || dispatch || procurement || allocation) && (query.departmentId && department.id !== query.departmentId && !departmentPathIds?.includes(query.departmentId)
        || query.ownerId && owner?.id !== query.ownerId
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
        createdAt: date(row.createdAt)!, paidAt: unpaid ? null : date(raw.schemaVersion === 1 ? row.paidAt ?? null : row.paidAt, true), cancelled: false, exception: null,
        ...(unpaid || query.queue === 'review' || dispatch || allocation ? { consumerPaidAt } : {}),
        ...((dispatch || procurement || allocation) && warehouse && warehouseMap[warehouse.id] ? { warehouseCode: warehouseMap[warehouse.id] } : {}),
        ...(unpaid ? { customLogisticsChannelName: row.customLogisticsChannelName == null ? null : string(row.customLogisticsChannelName, true),
          ...(warehouse && warehouseMap[warehouse.id] ? { warehouseCode: warehouseMap[warehouse.id] } : {}) } : {}),
      }
      if (procurement) {
        order.reviewedAt = date(row.reviewedAt ?? null, true)
        links.push({ orderId: id, obligations: this.purchaseObligations(row.obligations, order) })
      }
      if (allocation && row.allocationIssues !== undefined) {
        // 诊断行先完成与正常行相同的身份、组织和业务范围校验；保持进度未知，不伪造待办事实。
        if (!Array.isArray(row.allocationIssues) || !row.allocationIssues.length || row.allocationDocuments !== undefined)
          throw new Error('Invalid allocation diagnostics')
        order.allocationIssues = row.allocationIssues.map(value => {
          const issue = object(value), code = issue.code
          if (code !== 'ALLOCATION_SKU_MISMATCH' && code !== 'ALLOCATION_SOURCE_UNRESOLVED') throw new Error('Invalid allocation source diagnostic')
          const unresolved = code === 'ALLOCATION_SOURCE_UNRESOLVED'
          const sourceEntryId = unresolved ? string(issue.sourceEntryId, true) : identifier(issue.sourceEntryId)
          const allocationSku = string(issue.allocationSku, unresolved), orderSku = unresolved ? null : string(issue.orderSku)
          if (unresolved ? issue.orderSku != null : allocationSku === orderSku
            || !order.items.some(line => line.id === sourceEntryId && line.sku === orderSku)) throw new Error('Invalid allocation source diagnostic')
          return { code, allocationId: identifier(issue.allocationId), allocationNumber: string(issue.allocationNumber), sourceEntryId, allocationSku, orderSku }
        })
      } else if (allocation) this.allocationFields(order, row, query.queue, completed, raw.allocationSchemaVersion === 2)
      if (dispatch) this.dispatchFields(order, row, query)
      return order
    })
    if (procurement || allocation) {
      const next = raw.hasMore ? identifier(raw.nextAfterOrderId) : undefined
      if (next && (afterOrderId && new Decimal(next).lte(afterOrderId) || items.some(item => new Decimal(item.id).gt(next))))
        throw new Error('Invalid procurement continuation')
      return { source: 'fop', total, page: query.page, pageSize: query.pageSize, items, organizationIds, totals: summarizeFopOrders(items),
        ...(allocation ? { allocation: { next, more: raw.hasMore === true, bytes: Buffer.byteLength(JSON.stringify(raw)) } } : { procurement: { links, next, more: raw.hasMore === true, bytes: Buffer.byteLength(JSON.stringify(raw)) } }) }
    }
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
      ...(dispatch && !summaryOnly ? { departments: options('departments'), salespeople: options('salespeople') } : {}),
      ...(orderIds ? { orderIds } : {}),
      totals: { orderCount: total, itemQuantity: decimal(totals.itemQuantity), amountsByCurrency } }
  }

  /** 阶段、包裹、来源商品和发运完成证据必须显式返回；空值不能推断完成。 */
  private allocationFields(order: FopOrder, row: JsonObject, queue: string, completed: boolean, rawQuantities: boolean): void {
    const progress = object(row.fulfillmentProgress)
    const readiness = queue === 'allocation' ? 'incomplete' : 'ready', review = queue === 'shipping' ? 'approved' : 'pending'
    if (progress.allocationCreated !== true || progress.stockReadiness !== readiness || progress.allocationReview !== review
      || !(completed ? ['completed'] : ['pending', 'partial']).includes(String(progress.outbound)) || !Array.isArray(row.allocationDocuments) || !row.allocationDocuments.length
      || typeof row.dispatchDocumentsComplete !== 'boolean' || !Array.isArray(row.dispatchDocuments)) throw new Error('Invalid allocation facts')
    const ids = new Set<string>(), packages = new Set<string>(), quantities = new Map<string, Decimal>()
    order.allocationDocuments = row.allocationDocuments.map(value => {
      const doc = object(value), id = identifier(doc.id), packageNo = string(doc.packageNo), lines = object(doc.lineQuantities)
      if (ids.has(id) || packages.has(packageNo) || typeof doc.dispatchComplete !== 'boolean') throw new Error('Invalid allocation package')
      if (!Object.keys(lines).length) throw new Error('Invalid allocation source quantities')
      ids.add(id); packages.add(packageNo)
      for (const [lineId, qty] of Object.entries(lines)) {
        // 先校验十进制契约，再直接以原始字符串计算，避免小数经Number转换后损失精度。
        decimal(qty)
        const quantity = new AllocationQuantity(qty as string)
        if (quantity.lte(0)) throw new Error('Invalid allocation source quantities')
        quantities.set(identifier(lineId), (quantities.get(lineId) ?? new AllocationQuantity(0)).plus(quantity))
      }
      const outboundCompletedAt = completed ? date(doc.outboundCompletedAt)! : undefined
      if (completed && doc.outbound !== 'completed') throw new Error('Invalid completed outbound package')
      return { id, number: string(doc.number), packageNo, ...(completed ? { outboundCompletedAt } : {}), readyAt: date(doc.readyAt ?? null, true), wmsCreatedAt: date(doc.wmsCreatedAt ?? null, true), dispatchComplete: doc.dispatchComplete, carrier: string(doc.carrier ?? '', true), trackingNumber: string(doc.trackingNumber ?? '', true) }
    })
    if (rawQuantities) {
      // v2保留整单原始数量；按来源行合并本清单包裹后，才用于筛选、分页、展示及全范围汇总。
      // 未关联行不参与本任务，未知来源或超量整页拒绝，不能截断或伪造数量。
      const source = new Map((row.items as unknown[]).map(value => {
        const line = object(value)
        return [identifier(line.id), new AllocationQuantity(string(line.quantity))] as const
      }))
      for (const [lineId, quantity] of quantities) {
        if (!source.has(lineId) || quantity.gt(source.get(lineId)!)) throw new Error('Invalid allocation source quantities')
      }
      order.items = order.items.filter(line => line.id && quantities.has(line.id))
        .map(line => ({ ...line, quantity: quantities.get(line.id!)!.toNumber() }))
    } else if (quantities.size !== order.items.length || order.items.some(line => !line.id || !quantities.get(line.id)?.eq(line.quantity))) {
      throw new Error('Invalid allocation source quantities')
    }
    order.carrier = [...new Set(row.allocationDocuments.map(value => string(object(value).carrier ?? '', true)).filter(Boolean))].join(' / ') || null
    order.trackingNumber = [...new Set(row.allocationDocuments.map(value => string(object(value).trackingNumber ?? '', true)).filter(Boolean))].join(' / ') || null
    order.shippingCountryCode = row.shippingCountryCode == null ? null : string(row.shippingCountryCode)
    const recipient = row.shippingRecipient == null ? null : object(row.shippingRecipient)
    if (recipient) order.shippingRecipient = Object.fromEntries(['name', 'phone', 'email', 'state', 'city', 'postalCode', 'addressLine1', 'addressLine2'].map(key => [key, recipient[key] == null ? null : string(recipient[key], true)])) as unknown as FopOrder['shippingRecipient']
    order.allocationDocument = order.allocationDocuments.length === 1 ? order.allocationDocuments[0] : null
    order.dispatchDocuments = row.dispatchDocuments.map(value => {
      const doc = object(value), status = string(doc.status)
      if (!['draft', 'submitted', 'approved', 'unknown'].includes(status)) throw new Error('Invalid dispatch status')
      return { id: identifier(doc.id), number: string(doc.number), status: status as 'draft' | 'submitted' | 'approved' | 'unknown' }
    })
    order.dispatchDocumentsComplete = row.dispatchDocumentsComplete
    if (order.dispatchDocumentsComplete && (!order.dispatchDocuments.length || order.dispatchDocuments.some(doc => doc.status !== 'approved') || order.allocationDocuments.some(doc => !doc.dispatchComplete))) throw new Error('Incomplete dispatch packages')
    order.fulfillmentProgress = { ...order.fulfillmentProgress, allocationCreated: true, stockReadiness: readiness, allocationReview: review, outbound: progress.outbound as 'pending' | 'partial' | 'completed' }
    if (completed) {
      order.outboundCompletedAt = date(row.outboundCompletedAt)!
      const latest = Math.max(...order.allocationDocuments.map(doc => Date.parse(doc.outboundCompletedAt!)))
      if (Date.parse(order.outboundCompletedAt) !== latest) throw new Error('Inconsistent outbound completion time')
    }
    order.allocationStatus = readiness === 'ready' ? 'allocated' : 'not_ready'
    order.wmsCreatedAt = order.allocationDocuments.length === 1 ? order.allocationDocuments[0].wmsCreatedAt : null
    order.allocationReadyAt = order.allocationDocuments.map(doc => doc.readyAt).filter((value): value is string => !!value).sort().slice(-1)[0] ?? null
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

  /** 合并并发取Token请求；仅自动认证模式刷新失效令牌，手工Token模式继续明确提示更新。 */
  private async accessToken(invalidToken?: string): Promise<string> {
    if (!this.automaticTokenConfigured()) return this.config.get('FOP_KINGDEE_ACCESS_TOKEN')!.trim()
    if (invalidToken && this.cachedToken?.value === invalidToken) this.cachedToken = undefined
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) return this.cachedToken.value
    if (!this.tokenRequest) this.tokenRequest = this.obtainToken().finally(() => { this.tokenRequest = undefined })
    return this.tokenRequest
  }

  /** 增强型Token的有效期单位为毫秒；凭据与响应只留在服务端内存，不回传、不写日志。 */
  private async obtainToken(): Promise<string> {
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
    return object(parseKingdeeEnvelope(Buffer.concat(chunks).toString('utf8')))
  }

  /** 只读网络/5xx失败至多重试一次；认证失效至多重取一次，不能形成循环或重放业务写入。 */
  private async call(key: string, body: unknown, deadline?: number, retryable = true): Promise<unknown> {
    const endpoint = this.endpoint(key), timeout = this.requestTimeout()
    let token = await this.accessToken(), retries = 0, refreshed = false
    while (true) {
      const remaining = deadline === undefined ? timeout : deadline - Date.now()
      if (remaining <= 0) throw new FopIntegrationUnavailableError('fop_result_too_large')
      let response: Response
      try {
        response = await this.request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(Math.min(timeout, remaining)),
          headers: { 'content-type': 'application/json', access_token: token,
            'x-acgw-identity': this.config.get('FOP_KINGDEE_IDENTITY')! }, body: JSON.stringify(body) })
      } catch {
        if (deadline !== undefined && Date.now() >= deadline) throw new FopIntegrationUnavailableError('fop_result_too_large')
        if (retryable && retries++ === 0) continue
        throw new Error('Kingdee query transport unavailable')
      }
      if (response.status === 401) {
        await response.body?.cancel()
        if (retryable && !refreshed && this.automaticTokenConfigured()) { refreshed = true; token = await this.accessToken(token); continue }
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
      if (retryable && response.status >= 500 && retries++ === 0) { await response.body?.cancel(); continue }
      if (!response.ok || !response.body) throw new Error('Kingdee query unavailable')
      const envelope = await this.responseEnvelope(response, 4 * 1024 * 1024)
      if (envelope.status !== true || String(envelope.errorCode) !== '0') {
        if (['2504', '2505'].includes(String(envelope.errorCode))) throw new FopPermissionDeniedError('金蝶应用尚未授权当前接口，请核对自建API授权', 'fop_api_not_authorized')
        // 金蝶可能以HTTP 200返回认证失败，不能把这种响应当作取数成功或普通业务异常。
        if (String(envelope.errorCode) === '401' || String(envelope.errorCode) === '612') {
          if (retryable && !refreshed && this.automaticTokenConfigured()) { refreshed = true; token = await this.accessToken(token); continue }
          throw new FopPermissionDeniedError('Kingdee authentication expired', 'fop_authentication_expired')
        }
        const message = typeof envelope.message === 'string' ? envelope.message : ''
        // 仅提取受限标识用于关联金蝶日志；绝不记录响应正文、URL、令牌或客户信息。
        const query = body && typeof body === 'object' && 'query' in body ? (body as { query?: unknown }).query : undefined
        const queue = query && typeof query === 'object' && 'queue' in query ? String(query.queue) : ''
        const safeQueue = ['unpaid', 'review', 'dispatch', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'shipping'].includes(queue) ? queue : 'none'
        const code = /^[A-Za-z0-9_-]{1,32}$/.test(String(envelope.errorCode)) ? String(envelope.errorCode) : 'unknown'
        const traceId = message.match(/TraceId\s*[:：]\s*([a-f0-9-]{8,64})\b/i)?.[1] ?? 'unknown'
        const category = message.match(/FOP_[A-Z_]+/)?.[0] ?? (/ORMDesignException/.test(message) ? 'ORM_DESIGN_ERROR' : 'UPSTREAM_ERROR')
        this.logger.warn(`Kingdee query failed: operation=${key}, queue=${safeQueue}, code=${code}, traceId=${traceId}, category=${category}`)
        if (/FOP_(?:IDENTITY_MISMATCH|PERMISSION_DENIED)/.test(message)) throw new FopPermissionDeniedError('Kingdee permission denied')
        if (/FOP_FX_MISSING/.test(message)) throw new FopIntegrationUnavailableError('fop_fx_missing')
        if (/FOP_RESULT_TOO_LARGE/.test(message)) throw new FopIntegrationUnavailableError('fop_result_too_large')
        throw new Error('Kingdee query business failure')
      }
      return envelope.data
    }
  }
}

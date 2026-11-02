import Decimal from 'decimal.js'
import { randomUUID } from 'crypto'
import { Logger } from '@nestjs/common'
import type { BusinessScope } from '../users/business-scope'
import { matchesBusinessScope } from '../users/business-scope'
import { kingdeeDepartmentPath } from './fop-kingdee-scope'
import { businessDate, validBusinessDay } from './fop-business-time'
import { emptyAnalyticsData, KingdeeAnalyticsDecoder } from './fop-kingdee.analytics'
import type { FopAnalyticsData, FopAnalyticsRange, FopAnalyticsResource, FopAnalyticsScope, FopConnectionContext } from './fop-data.types'
import { FopDataProvider, FopIdentity, FopIntegrationUnavailableError, FopOrder, FopOrderPage, FopOrderPageQuery, FopPermissionDeniedError, FopPermissionGrant } from './fop-data.types'
import type { FopBindingEmployee, FopBindingEmployeePage, FopEmployeeBindingDetails, VerifiedFopEmployeeBinding } from './fop-employee-binding'

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
  readonly pagedOrders = true
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
    if (!Array.isArray(queues) || queues.some(queue => queue !== 'review' && queue !== 'dispatch')) throw new Error('Invalid Kingdee order queues')
    return { subject: { ...identity }, allowedOrderIds: [], analyticsQuery, analyticsScopes,
      ...(analyticsQuery.orders!.length ? { orderQuery: { queues: queues as ('review' | 'dispatch')[], organizationIds: analyticsQuery.orders! } } : {}) }
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
    if (query.queue !== 'review' && query.queue !== 'dispatch' || !permission.orderQuery?.queues.includes(query.queue as 'review' | 'dispatch')) throw new FopIntegrationUnavailableError('fop_feature_not_configured')
    if (permission.subject.tenantId !== identity.tenantId || permission.subject.userId !== identity.userId) throw new FopPermissionDeniedError('Permission identity mismatch')
    const { organizationIds, ...page } = await this.read(identity, scope, query, summaryOnly)
    if (organizationIds.some(id => !permission.orderQuery!.organizationIds.includes(id))) throw new FopPermissionDeniedError('Organization grant changed')
    return page
  }

  private async read(identity: Readonly<FopIdentity>, scope: Readonly<BusinessScope>, query: FopOrderPageQuery, summaryOnly: boolean): Promise<FopOrderPage & { organizationIds: string[] }> {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > 1_000_000 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) throw new Error('Invalid page')
    if (scope.role === 'none' || (scope.role === 'salesperson' && !scope.employeeId) || (scope.role === 'department_manager' && !scope.departmentId)) throw new FopPermissionDeniedError('Incomplete business scope')
    const body = { query: { tenantId: identity.tenantId, userId: identity.userId, organizationIds: this.organizationIds,
      scopeRole: scope.role, employeeId: scope.employeeId, departmentIds: scope.departmentId ? [scope.departmentId] : [],
      search: query.search ?? '', orderNumber: query.orderNumber ?? '', page: query.page, pageSize: query.pageSize,
      ...(query.queue === 'dispatch' ? { queue: 'dispatch' } : {}) } }
    const raw = object(await this.call(summaryOnly ? 'FOP_KINGDEE_SUMMARY_URL' : 'FOP_KINGDEE_QUERY_URL', body))
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) throw new Error('Unsupported employee order schema')
    const subject = object(raw.subject)
    if (subject.tenantId !== identity.tenantId || subject.userId !== identity.userId) throw new FopPermissionDeniedError('Kingdee response identity mismatch')
    const expectedBasis = query.queue === 'dispatch' ? 'paid_tracking_pending_active' : 'submitted_paid_active'
    if (raw.queue !== query.queue || raw.basis !== expectedBasis || !Array.isArray(raw.organizationIds)
      || raw.organizationIds.length === 0 || raw.organizationIds.some(id => !this.organizationIds.includes(String(id)))) throw new FopPermissionDeniedError('Kingdee response scope mismatch')
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
      if (query.queue === 'review' && billStatus === 'C' || !['2', '3', '4', '5'].includes(string(row.orderStatus))) throw new Error('Unexpected review order status')
      const owner = reference(row.owner)
      const department = reference(row.department)
      if (!department) throw new FopPermissionDeniedError('Order department missing')
      const departmentPathIds = kingdeeDepartmentPath(row.departmentPathIds, organization.id, department.id, raw.schemaVersion === 1)
      if (!matchesBusinessScope(scope, { owner, department, departmentPathIds })) throw new FopPermissionDeniedError('Order outside local business scope')
      const customer = reference(raw.schemaVersion === 1 ? row.customer ?? null : row.customer)
      const store = reference(raw.schemaVersion === 1 ? row.store ?? null : row.store)
      const warehouse = reference(raw.schemaVersion === 1 ? row.warehouse ?? null : row.warehouse)
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
        items: lines, amount: decimal(row.amount), currency, paymentStatus: 'paid', reviewStatus: billStatus === 'C' ? 'approved' : 'pending',
        procurementStatus: 'unknown', allocationStatus: 'unknown', dispatchStatus: 'unknown', shippingStatus: 'unknown',
        warehouse: warehouse?.name ?? '', carrier: null, trackingNumber: null, salesperson: owner?.name ?? '',
        createdAt: date(row.createdAt)!, paidAt: date(raw.schemaVersion === 1 ? row.paidAt ?? null : row.paidAt, true), cancelled: false, exception: null,
      }
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
    return { source: 'fop', total, page: query.page, pageSize: query.pageSize, items, organizationIds,
      totals: { orderCount: total, itemQuantity: decimal(totals.itemQuantity), amountsByCurrency } }
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
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
  }

  /** 只读网络/5xx失败至多重试一次；认证失效至多重取一次，不能形成循环或重放业务写入。 */
  private async call(key: string, body: unknown, deadline?: number): Promise<unknown> {
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
        if (retries++ === 0) continue
        throw new Error('Kingdee query transport unavailable')
      }
      if (response.status === 401) {
        await response.body?.cancel()
        if (!refreshed && this.automaticTokenConfigured()) { refreshed = true; token = await this.accessToken(token); continue }
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
      if (response.status >= 500 && retries++ === 0) { await response.body?.cancel(); continue }
      if (!response.ok || !response.body) throw new Error('Kingdee query unavailable')
      const envelope = await this.responseEnvelope(response, 4 * 1024 * 1024)
      if (envelope.status !== true || String(envelope.errorCode) !== '0') {
        if (['2504', '2505'].includes(String(envelope.errorCode))) throw new FopPermissionDeniedError('金蝶应用尚未授权当前接口，请核对自建API授权', 'fop_api_not_authorized')
        // 金蝶可能以HTTP 200返回认证失败，不能把这种响应当作取数成功或普通业务异常。
        if (String(envelope.errorCode) === '401' || String(envelope.errorCode) === '612') {
          if (!refreshed && this.automaticTokenConfigured()) { refreshed = true; token = await this.accessToken(token); continue }
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

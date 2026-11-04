import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopDataService } from './fop-data.service'
import type { FopOrderPageQuery } from './fop-data.types'
import type { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'

const identity = { tenantId: 'test-tenant', userId: '100' }
const admin = { role: 'admin' as const, departmentId: null, employeeId: null }
const ref = (id: string) => ({ id, name: `name-${id}` })
const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['dispatch'] as 'dispatch'[], organizationIds: ['10'] } }
const completedQuery = { queue: 'dispatch' as const, completed: true, timeRange: '1w' as const, page: 1, pageSize: 10 }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_TENANT_ID: identity.tenantId, FOP_KINGDEE_USER_ID: identity.userId, FOP_KINGDEE_ORGANIZATION_IDS: '10',
  FOP_KINGDEE_ACCESS_TOKEN: 'offline-token', FOP_KINGDEE_IDENTITY: 'offline-identity', FOP_KINGDEE_OPENAPI_SIGN: 'offline-sign',
  FOP_KINGDEE_WAREHOUSE_MAP: '{"600":"HZ"}',
}

function setup(rowOverrides: Record<string, unknown> = {}, envelopeOverrides: Record<string, unknown> = {}) {
  const request = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)).query as FopOrderPageQuery
    const row = { id: '1001', organization: ref('10'), department: ref('401'), departmentPathIds: ['10', '400', '401'], owner: ref('501'),
      customer: ref('200'), store: ref('300'), warehouse: ref('600'), orderNumber: 'TO1001', shopifyOrderNumber: '#1001',
      billStatus: 'C', orderStatus: '4', amount: '12.34', currency: 'USD', createdAt: '2026-11-01T00:00:00Z',
      paidAt: '2026-11-02T00:00:00Z', consumerPaidAt: '2026-11-01T12:00:00Z', items: [],
      dispatchTaskStatus: 'dispatch_synced', dispatchDocuments: [{ id: '900', number: 'FY900', status: 'approved' }],
      dispatchApprovedAt: '2026-11-03T00:00:00Z', fulfillmentProgress: { shopifySync: 'synced' },
      logisticsInfo: [{ carrierName: 'Carrier', shopifyTracking: { type: 'last_mile', number: 'TRACK1' } }],
      shippingRecipient: null, shippingCountryCode: 'US', ...rowOverrides }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data: {
      schemaVersion: 1, dispatchSchemaVersion: 1, completedSchemaVersion: 2, completed: true,
      subject: identity, organizationIds: ['10'], queue: 'dispatch', basis: 'paid_tracking_synced_active',
      page: q.page, pageSize: q.pageSize, total: 1, items: String(url).endsWith('/summary') ? [] : [row],
      departments: [ref('400'), ref('401')], salespeople: [ref('501')], ...(q.exportManifest ? { orderIds: ['1001'] } : {}),
      totals: { orderCount: 1, itemQuantity: '0', amountsByCurrency: [{ currency: 'USD', amount: '12.34' }] }, ...envelopeOverrides,
    } }))
  })
  const provider = new KingdeeFopDataProvider({ get: key => settings[key] }, request)
  const user = { id: 'local-admin', role: 'admin', businessRole: 'admin', workbenchRoles: ['dispatch'],
    fopTenantId: identity.tenantId, fopUserId: identity.userId, businessDepartmentId: null, businessEmployeeId: null,
    fopBindingDetails: { username: 'offline-user', name: 'offline', employeeRecordId: '100', employeeMasterId: '100', departmentId: '10',
      organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-11-01T00:00:00Z' } } as User
  const service = new FopDataService({ findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService, provider)
  jest.spyOn(provider, 'resolvePermissions').mockResolvedValue(grant)
  return { provider, service, user, request }
}

describe('已履约真实分页接口', () => {
  it('透传完成模式、时间与权限内筛选，映射发运单审核时间', async () => {
    const { provider, request } = setup()
    const result = await provider.queryOrders(identity, grant, admin, { ...completedQuery, departmentId: '400', warehouseCode: 'HZ' })
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query).toMatchObject({
      queue: 'dispatch', completed: true, timeRange: '1w', sortBy: 'completedAt', sortOrder: 'desc', departmentId: '400', warehouseIds: ['600'],
    })
    expect(result.items[0]).toMatchObject({ dispatchTaskStatus: 'dispatch_synced', fulfillmentProgress: { shopifySync: 'synced' }, dispatchApprovedAt: '2026-11-03T00:00:00Z' })
    expect(result.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 12.34 }])
  })
  it('BFF 已履约列表沿用上游完整合计', async () => {
    const { service, user } = setup()
    const result = await service.getOrders(user.id, { ...completedQuery, sortBy: 'completedAt', sortOrder: 'desc' })
    expect(result.total).toBe(1)
    expect(result.items[0].fulfillmentProgress.shopifySync).toBe('synced')
  })
  it('完成模式省略时间时明确使用默认近一周', async () => {
    const { provider, request } = setup()
    await provider.queryOrders(identity, grant, admin, { ...completedQuery, timeRange: undefined }, true)
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query.timeRange).toBe('1w')
  })
  it.each([
    { completedSchemaVersion: undefined }, { completed: undefined }, { completed: false }, { completedSchemaVersion: 1 },
  ])('旧接口即使返回空集合也不能冒充已接通：%j', async envelope => {
    const { provider } = setup({}, { ...envelope, total: 0, items: [], totals: { orderCount: 0, itemQuantity: '0', amountsByCurrency: [] } })
    await expect(provider.queryOrders(identity, grant, admin, completedQuery)).rejects.toMatchObject({ code: 'fop_feature_not_configured' })
  })
  it.each([
    { fulfillmentProgress: { shopifySync: 'pending' } }, { dispatchTaskStatus: 'dispatch_approved' },
    { dispatchApprovedAt: null }, { dispatchApprovedAt: 'bad' }, { dispatchApprovedAt: '2026-11-03T00:00:00' },
    { dispatchApprovedAt: '2026-02-30T00:00:00Z' }, { dispatchDocuments: [] },
    { billStatus: 'B' }, { orderStatus: '1' },
  ])('拒绝没有真实完成事实的订单：%j', async row => {
    const { provider } = setup(row)
    await expect(provider.queryOrders(identity, grant, admin, completedQuery)).rejects.toThrow()
  })
  it.each([
    { timeRange: 'all' as const }, { taskStatus: 'dispatch_approved' }, { sortBy: 'dispatchDocumentStatus' }, { queue: 'review' as const },
  ])('不静默忽略完成清单不支持的条件：%j', async filters => {
    const { provider, request } = setup()
    await expect(provider.queryOrders(identity, grant, admin, { ...completedQuery, ...filters })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
  it('已履约导出保留固定主键清单与完成条件，并再次核验', async () => {
    const { service, user, request } = setup()
    const result = await service.exportOrders(user.id, { queue: 'dispatch', completed: true, timeRange: '1m', mode: 'filtered', sortBy: 'completedAt', sortOrder: 'desc' })
    expect(result.byteLength).toBeGreaterThan(100)
    const queries = request.mock.calls.map(call => JSON.parse(String(call[1]?.body)).query)
    expect(queries).toHaveLength(4)
    expect(queries.every(q => q.completed === true && q.timeRange === '1m')).toBe(true)
    expect(queries.filter(q => q.exportManifest)).toHaveLength(2)
    expect(queries.filter(q => q.orderIds?.[0] === '1001')).toHaveLength(2)
  })
})

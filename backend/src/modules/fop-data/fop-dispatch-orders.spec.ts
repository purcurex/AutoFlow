import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import { FopDataService } from './fop-data.service'
import type { FopOrderPageQuery } from './fop-data.types'
import type { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'

const identity = { tenantId: 'test-tenant', userId: '100' }
const admin = { role: 'admin' as const, departmentId: null, employeeId: null }
const ref = (id: string) => ({ id, name: `name-${id}` })
const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['dispatch'] as 'dispatch'[], organizationIds: ['10'] } }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_TENANT_ID: identity.tenantId, FOP_KINGDEE_USER_ID: identity.userId, FOP_KINGDEE_ORGANIZATION_IDS: '10',
  FOP_KINGDEE_ACCESS_TOKEN: 'offline-token', FOP_KINGDEE_IDENTITY: 'offline-identity', FOP_KINGDEE_OPENAPI_SIGN: 'offline-sign',
  FOP_KINGDEE_WAREHOUSE_MAP: '{"600":"HZ"}',
}
function setup(stage = 'dispatch_missing', transform: (row: Record<string, unknown>) => Record<string, unknown> = row => row) {
  const request = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)).query as FopOrderPageQuery
    const row = transform({ id: '1001', organization: ref('10'), department: ref('401'), departmentPathIds: ['10', '400', '401'], owner: ref('501'),
      customer: ref('200'), store: ref('300'), warehouse: ref('600'), orderNumber: 'TO1001', shopifyOrderNumber: '#1001',
      billStatus: 'C', orderStatus: '2', amount: '12.34', currency: 'USD', createdAt: '2026-11-01T00:00:00Z',
      paidAt: '2026-11-02T00:00:00Z', consumerPaidAt: '2026-11-01T12:00:00Z', items: [],
      dispatchTaskStatus: stage, dispatchDocuments: stage === 'dispatch_missing' ? [] : [{ id: '900', number: 'FY900', status: ({ dispatch_draft: 'draft', dispatch_submitted: 'submitted', dispatch_approved: 'approved' } as Record<string, string>)[stage] }],
      logisticsInfo: [{ carrierName: 'Carrier', shopifyTracking: { type: 'last_mile', number: 'TRACK1' } }],
      fulfillmentProgress: { shopifySync: 'pending' }, shippingRecipient: null, shippingCountryCode: 'US' })
    const summary = String(_url).endsWith('/summary')
    return new Response(JSON.stringify({ status: true, errorCode: '0', data: {
      schemaVersion: 1, dispatchSchemaVersion: 1, subject: identity, organizationIds: ['10'], queue: 'dispatch', basis: 'paid_tracking_pending_active',
      page: q.page, pageSize: q.pageSize, total: 1, items: summary ? [] : [row],
      departments: [ref('400'), ref('401')], salespeople: [ref('501')], ...(q.exportManifest ? { orderIds: ['1001'] } : {}),
      totals: { orderCount: 1, itemQuantity: '0', amountsByCurrency: [{ currency: 'USD', amount: '12.34' }] },
    } }))
  })
  const provider = new KingdeeFopDataProvider({ get: key => settings[key] }, request)
  const user = { id: 'local-admin', role: 'admin', businessRole: 'admin', workbenchRoles: ['dispatch'],
    fopTenantId: identity.tenantId, fopUserId: identity.userId, businessDepartmentId: null, businessEmployeeId: null,
    fopBindingDetails: { username: 'offline-user', name: 'offline', employeeRecordId: '100', employeeMasterId: '100', departmentId: '10',
      organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-11-01T00:00:00Z' } } as User
  const service = new FopDataService({ findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService, provider)
  jest.spyOn(provider, 'resolvePermissions').mockResolvedValue(grant)
  return { provider, request, service, user }
}

describe('待履约真实分页接口', () => {
  it.each(['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved'])('完整返回四种状态：%s', async stage => {
    const { provider } = setup(stage)
    const result = await provider.queryOrders(identity, grant, admin, { queue: 'dispatch', page: 1, pageSize: 10 })
    expect(result.items[0]).toMatchObject({ dispatchTaskStatus: stage, reviewStatus: 'approved', warehouseCode: 'HZ',
      consumerPaidAt: '2026-11-02T00:00:00Z', logisticsInfo: [{ carrierName: 'Carrier', shopifyTracking: { type: 'last_mile', number: 'TRACK1' } }] })
    expect(result.departments).toHaveLength(2)
  })
  it.each(['1w', '1m', '3m'] as const)('用履约单收款日期筛选%s窗口，不依赖收款接口或源单时间', async timeRange => {
    const recent = new Date(Date.now() - 1000).toISOString()
    const { provider, request } = setup('dispatch_missing', row => ({ ...row, paidAt: recent }))
    for (const summaryOnly of [false, true]) {
      expect(await provider.queryOrders(identity, grant, admin, { queue: 'dispatch', page: 1, pageSize: 10, timeRange }, summaryOnly)).toMatchObject({ total: 1 })
    }
    expect(request.mock.calls.every(call => String(call[0]).endsWith('/page') && JSON.parse(String(call[1]?.body)).query.timeRange === undefined)).toBe(true)
  })
  it('上级可看管理范围内子部门，不能查看无管理关系部门', async () => {
    const { provider } = setup()
    const manager = { role: 'department_manager' as const, departmentId: '400', employeeId: '500' }
    await expect(provider.queryOrders(identity, grant, manager, { queue: 'dispatch', page: 1, pageSize: 10 })).resolves.toMatchObject({ total: 1 })
    await expect(provider.queryOrders(identity, grant, { ...manager, departmentId: '999' }, { queue: 'dispatch', page: 1, pageSize: 10 })).rejects.toThrow()
  })
  it('将状态、仓库、部门和排序完整交给金蝶分页前执行', async () => {
    const { service, request, user } = setup('dispatch_missing')
    await service.getOrders(user.id, { queue: 'dispatch', page: 1, pageSize: 10, departmentId: '400', warehouseCode: 'HZ', taskStatus: 'dispatch_missing', sortBy: 'dispatchDocumentStatus', sortOrder: 'desc' })
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query).toMatchObject({ departmentId: '400', warehouseIds: ['600'], taskStatus: 'dispatch_missing', sortBy: 'dispatchDocumentStatus', sortOrder: 'desc' })
  })
  it('未发布交付状态筛选时明确拒绝，不能沿用旧审核状态代替', async () => {
    const {service,user,request}=setup('dispatch_approved')
    await expect(service.getOrders(user.id,{queue:'dispatch',page:1,pageSize:10,taskStatus:'dispatch_tracking'})).rejects.toMatchObject({response:{code:'fop_feature_not_configured'}})
    expect(request).not.toHaveBeenCalled()
  })
  it.each(['A', 'B'])('保留已付款未审核履约订单%s，且不混淆发运单阶段', async billStatus => {
    const { provider } = setup('dispatch_missing', row => ({ ...row, billStatus }))
    const result = await provider.queryOrders(identity, grant, admin, { queue: 'dispatch', page: 1, pageSize: 10 })
    expect(result.items[0]).toMatchObject({ paymentStatus: 'paid', reviewStatus: 'pending', dispatchTaskStatus: 'dispatch_missing' })
  })
  it('同步已完成不得返回到待履约清单', async () => {
    const { provider } = setup('dispatch_approved', row => ({ ...row, fulfillmentProgress: { shopifySync: 'synced' } }))
    await expect(provider.queryOrders(identity, grant, admin, { queue: 'dispatch', page: 1, pageSize: 10 })).rejects.toThrow()
  })
  it('整单已有发运单但仍缺包裹时，保留服务端未创建阶段', async () => {
    const { provider } = setup('dispatch_missing', row => ({ ...row, dispatchDocuments: [{ id: '900', number: 'FY900', status: 'approved' }] }))
    const result = await provider.queryOrders(identity, grant, admin, { queue: 'dispatch', page: 1, pageSize: 10 })
    expect(result.items[0].dispatchTaskStatus).toBe('dispatch_missing')
  })
  it('真实分页导出使用固定ID清单并按ID分批读取，不调用旧全量入口', async () => {
    const { service, user, request, provider } = setup('dispatch_draft')
    const legacy = jest.spyOn(provider, 'listOrders')
    const result = await service.exportOrders(user.id, { queue: 'dispatch', mode: 'filtered' })
    expect(result.byteLength).toBeGreaterThan(100)
    expect(legacy).not.toHaveBeenCalled()
    const queries = request.mock.calls.map(call => JSON.parse(String(call[1]?.body)).query)
    expect(queries.some(q => q.exportManifest === true)).toBe(true)
    expect(queries.some(q => q.orderIds?.[0] === '1001')).toBe(true)
  })
})

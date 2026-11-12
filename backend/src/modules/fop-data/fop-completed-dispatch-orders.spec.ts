import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import { FopDataService } from './fop-data.service'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import type { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'
import { ListFulfillmentOrdersDto } from '../users/dto/workbench.dto'

const identity = { tenantId: 'test-tenant', userId: '100' }
const admin = { role: 'admin' as const, departmentId: null, employeeId: null }
const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['dispatch'] as 'dispatch'[], organizationIds: ['10'] } }
const completedQuery = { queue: 'dispatch' as const, completed: true, timeRange: '1w' as const, page: 1, pageSize: 10 }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_TENANT_ID: identity.tenantId, FOP_KINGDEE_USER_ID: identity.userId, FOP_KINGDEE_ORGANIZATION_IDS: '10',
  FOP_KINGDEE_ACCESS_TOKEN: 'offline-token', FOP_KINGDEE_IDENTITY: 'offline-identity', FOP_KINGDEE_OPENAPI_SIGN: 'offline-sign',
  FOP_KINGDEE_WAREHOUSE_MAP: '{"600":"HZ"}',
}

function setup() {
  const request = jest.fn(async (): Promise<Response> => { throw new Error('Legacy shipment-audit-window endpoint must not be queried') })
  const provider = new KingdeeFopDataProvider({ get: key => settings[key] }, request)
  const user = { id: 'local-admin', role: 'admin', businessRole: 'admin', workbenchRoles: ['dispatch'],
    fopTenantId: identity.tenantId, fopUserId: identity.userId, businessDepartmentId: null, businessEmployeeId: null,
    fopBindingDetails: { username: 'offline-user', name: 'offline', employeeRecordId: '100', employeeMasterId: '100', departmentId: '10',
      organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-11-01T00:00:00Z' } } as User
  const service = new FopDataService({ findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService, provider)
  const permissions = jest.spyOn(provider, 'resolvePermissions').mockResolvedValue(grant)
  return { provider, service, user, request, permissions }
}

describe('已履约真实接口的客户付款期间能力边界', () => {
  it.each([
    { timeRange: undefined, summaryOnly: false },
    { timeRange: '1w' as const, summaryOnly: false },
    { timeRange: '3m' as const, summaryOnly: true },
  ])('没有客户付款期间契约时拒绝旧完成清单和汇总请求：%j', async ({ timeRange, summaryOnly }) => {
    const { provider, request } = setup()
    await expect(provider.queryOrders(identity, grant, admin, { ...completedQuery, timeRange, departmentId: '400', warehouseCode: 'HZ', exportManifest: summaryOnly }, summaryOnly))
      .rejects.toMatchObject({ code: 'fop_feature_not_configured' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([undefined, '1w', '1m', '3m'] as const)('BFF已履约列表明确报告付款期间尚未接通，不请求旧发运审核窗口：%s', async timeRange => {
    const { service, user, request } = setup()
    await expect(service.getOrders(user.id, { ...completedQuery, timeRange, sortBy: 'consumerPaidAt', sortOrder: 'desc' }))
      .rejects.toMatchObject({ status: 503, response: { code: 'fop_feature_not_configured' } })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    { mode: 'filtered' as const },
    { mode: 'selected' as const, orderIds: ['1001'] },
  ])('全部和选中导出均不能绕过客户付款期间能力校验：%j', async selection => {
    const { service, user, request } = setup()
    await expect(service.exportOrders(user.id, { queue: 'dispatch', completed: true, timeRange: '1m', sortBy: 'consumerPaidAt', sortOrder: 'desc', ...selection }))
      .rejects.toMatchObject({ status: 503, response: { code: 'fop_feature_not_configured' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('未授权岗位不能借未配置提示绕过列表或导出授权', async () => {
    const { service, user, request, permissions } = setup()
    user.role = 'user' as User['role']; user.businessRole = 'salesperson'; user.businessEmployeeId = '501'; user.workbenchRoles = ['sales']
    await expect(service.getOrders(user.id, completedQuery)).rejects.toMatchObject({ status: 403 })
    await expect(service.exportOrders(user.id, { queue: 'dispatch', completed: true, mode: 'filtered' })).rejects.toMatchObject({ status: 403 })
    expect(permissions).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('过期会话不能发起已履约导出', async () => {
    const { service, user, request, permissions } = setup()
    user.sessionVersion = 1
    await expect(service.exportOrders(user.id, { queue: 'dispatch', completed: true, mode: 'filtered' })).rejects.toMatchObject({ status: 401 })
    expect(permissions).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('拒绝与当前认证身份不符的订单授权', async () => {
    const { provider, request } = setup()
    await expect(provider.queryOrders(identity, { ...grant, subject: { ...identity, userId: 'another' } }, admin, completedQuery))
      .rejects.toMatchObject({ code: 'fop_permission_denied' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    { timeRange: 'all' as const }, { taskStatus: 'dispatch_approved' as const }, { sortBy: 'dispatchDocumentStatus' as const },
  ])('BFF不静默忽略完成清单不支持的筛选：%j', async filters => {
    const { service, user, provider, request } = setup()
    const query = jest.spyOn(provider, 'queryOrders')
    await expect(service.getOrders(user.id, { ...completedQuery, ...filters }))
      .rejects.toMatchObject({ response: { code: 'fop_feature_not_configured' } })
    expect(query).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('未授权的完成队列不能回退查询发运清单', async () => {
    const { provider, request } = setup()
    await expect(provider.queryOrders(identity, grant, admin, { ...completedQuery, queue: 'review' }))
      .rejects.toMatchObject({ code: 'fop_feature_not_configured' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([{ completed: 'yes' }, { timeRange: '1y' }, { page: 0 }, { pageSize: 101 }, { sortBy: 'unrecognized' }])('完成清单DTO仍拒绝非法输入：%j', filters => {
    expect(validateSync(plainToInstance(ListFulfillmentOrdersDto, { ...completedQuery, ...filters })).length).toBeGreaterThan(0)
  })
})

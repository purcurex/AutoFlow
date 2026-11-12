import { KingdeeWorkbenchDiagnosticProvider as KingdeeFopDataProvider } from './fop-kingdee.diagnostic'
import { FopDataService } from './fop-data.service'
import { FopPermissionDeniedError } from './fop-data.types'
import { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'

const identity = { tenantId: 'unpaid-test', userId: '100' }
const ref = (id: string) => ({ id, name: `name-${id}` })
const own = { role: 'salesperson' as const, employeeId: '501', departmentId: '400' }
const query = { queue: 'unpaid' as const, page: 1, pageSize: 20 }
const sourceTime = '2026-10-31T01:30:00Z'
const order = () => ({ id: '1001', orderNumber: 'BT-1001', shopifyOrderNumber: '#1001', organization: ref('10'),
  department: ref('400'), departmentPathIds: ['10', '400'], owner: ref('501'), warehouse: ref('900'), customer: ref('200'), store: ref('300'),
  orderStatus: '1', billStatus: 'A', amount: '123.45', currency: 'USD', createdAt: '2026-10-01T00:00:00Z', paidAt: null,
  consumerPaidAt: sourceTime as string | null, customLogisticsChannelName: 'Custom Channel',
  items: [{ id: '10011', parentId: '0', sequence: 1, rowType: null, sku: 'SKU-1', name: 'Product', variant: '', quantity: '2.5' }] })

function setup(transform?: (row: ReturnType<typeof order>) => unknown, queues = ['unpaid', 'review', 'dispatch']) {
  const settings: Record<string, string> = { FOP_KINGDEE_QUERY_URL: 'https://example.test/page', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
    FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL: 'https://example.test/permissions', FOP_KINGDEE_ORGANIZATION_IDS: '10',
    FOP_KINGDEE_ACCESS_TOKEN: 'test-token', FOP_KINGDEE_IDENTITY: 'test-identity', FOP_KINGDEE_OPENAPI_SIGN: 'test-sign',
    FOP_KINGDEE_WAREHOUSE_MAP: '{"900":"HZ","901":"SZ"}', FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP: 'unused-invalid-stock-config' }
  const request = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const params = JSON.parse(String(init?.body)).query
    const data = String(input).endsWith('/permissions')
      ? { subject: identity, currentOrganization: ref('10'), grants: { orders: ['10'], receipts: [], registrations: [], freight: [] }, orderQueues: queues }
      : { subject: identity, schemaVersion: 1, organizationIds: ['10'], queue: 'unpaid', basis: 'unpaid_active_self',
        page: params.page, pageSize: params.pageSize, total: params.pageSize === 100 ? '1' : '31',
        items: String(input).endsWith('/summary') ? [] : [transform ? transform(order()) : order()],
        totals: { orderCount: params.pageSize === 100 ? '1' : '31', itemQuantity: '77.5', amountsByCurrency: [{ currency: 'USD', amount: '3826.95' }] } }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data }))
  })
  const provider = new KingdeeFopDataProvider({ get: key => settings[key] }, request)
  const user = { id: 'local-admin', role: 'user', businessRole: 'salesperson', businessEmployeeId: '501', businessDepartmentId: '400',
    fopTenantId: identity.tenantId, fopUserId: identity.userId, workbenchRoles: ['sales'],
    fopBindingDetails: { username: 'test-user', name: 'Employee', employeeRecordId: '100', employeeMasterId: '501', departmentId: '400',
      organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-01T00:00:00Z' } } as User
  const users = { findById: jest.fn(async () => user) } as unknown as UsersService
  return { provider, request, user, service: new FopDataService(users, provider) }
}

describe('按角色读取待支付平台订单', () => {
  it('管理员保留全部部门范围和上游合计，未配置收款来源时付款时间为空', async () => {
    const { service, request, user } = setup()
    user.role = 'admin' as User['role']; user.businessRole = 'admin'
    const result = await service.getOrders('local-admin', { ...query, timeRange: 'all', warehouseCode: 'HZ', search: 'Custom',
      departmentId: '400', sortBy: 'consumerPaidAt', sortOrder: 'desc' })
    expect(result.total).toBe(31)
    expect(result.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 3826.95 }])
    expect(result.items[0]).toMatchObject({ paymentStatus: 'unpaid', consumerPaidAt: null, paidAt: null,
      warehouseCode: 'HZ', customLogisticsChannelName: 'Custom Channel', owner: ref('501') })
    const sent = JSON.parse(String(request.mock.calls[1][1]?.body)).query
    expect(sent).toMatchObject({ queue: 'unpaid', scopeRole: 'admin', employeeId: null, timeRange: 'all',
      warehouseIds: ['900'], departmentId: '400', search: 'Custom', sortBy: 'paidAt', sortOrder: 'desc' })
  })

  it('没有已确认客户收款时间时保留空值，不回退源单或创建时间', async () => {
    const { service } = setup(row => ({ ...row, consumerPaidAt: null }))
    expect((await service.getOrders('local-admin', query)).items[0]).toMatchObject({ consumerPaidAt: null, paidAt: null })
  })

  it.each(['502', '999'])('拒绝金蝶返回其他业务员%s的数据', async employeeId => {
    const { service } = setup(row => ({ ...row, owner: ref(employeeId) }))
    await expect(service.getOrders('local-admin', query)).rejects.toMatchObject({ status: 403 })
  })

  it('浏览器业务员参数不能覆盖本人身份', async () => {
    const { service, request } = setup()
    await expect(service.getOrders('local-admin', { ...query, ownerId: '999' })).rejects.toMatchObject({ status: 403 })
    expect(request.mock.calls.every(call => String(call[0]).endsWith('/permissions'))).toBe(true)
  })

  it('未绑定账号不退化为管理员全部订单', async () => {
    const { service, user } = setup()
    user.fopBindingDetails = null
    await expect(service.getOrders('local-admin', query)).rejects.toMatchObject({ status: 403 })
  })

  it.each(['0', '2', '3', '4', '5', '6', 'no'])('拒绝不属于待支付的订单状态%s', async status => {
    const { provider } = setup(row => ({ ...row, orderStatus: status }))
    const permission = await provider.resolvePermissions(identity, own)
    await expect(provider.queryOrders(identity, permission, own, query)).rejects.toThrow('Unexpected review order status')
  })

  it('旧部署未声明待支付时明确报未配置', async () => {
    const { service } = setup(undefined, ['review', 'dispatch'])
    await expect(service.getOrders('local-admin', query)).rejects.toMatchObject({ response: { code: 'fop_feature_not_configured' } })
  })

  it('无付款时间限制的合计接口保留角色和仓库条件', async () => {
    const { provider, request } = setup()
    const permission = await provider.resolvePermissions(identity, own)
    const result = await provider.queryOrders(identity, permission, { ...own, role: 'admin' }, { ...query, timeRange: 'all', warehouseCode: 'SZ' }, true)
    expect(result.items).toEqual([])
    expect(result.total).toBe(31)
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query).toMatchObject({ scopeRole: 'admin', employeeId: '501', timeRange: 'all', warehouseIds: ['901'] })
  })

  it.each(['1w', '1m', '3m'] as const)('没有本单收款日期的待支付单不进入%s窗口，也不借用源单时间', async timeRange => {
    const { service, request, provider } = setup()
    expect(await service.getOrders('local-admin', { ...query, timeRange })).toMatchObject({ total: 0, items: [] })
    const permission = await provider.resolvePermissions(identity, own)
    expect(await provider.queryOrders(identity, permission, own, { ...query, timeRange }, true)).toMatchObject({ total: 0, items: [] })
    const calls = request.mock.calls.filter(call => !String(call[0]).endsWith('/permissions'))
    expect(calls).toHaveLength(2)
    expect(calls.every(call => JSON.parse(String(call[1]?.body)).query.timeRange === undefined)).toBe(true)
  })

  it.each(['admin', 'department_manager'] as const)('%s可查看授权范围内其他业务员的待支付订单', async businessRole => {
    const { service, user, request } = setup(row => ({ ...row, owner: ref('502') }))
    user.businessRole = businessRole
    user.dataDisplayScope = 'department'
    user.dataDisplayScope = 'department'
    const result = await service.getOrders(user.id, query)
    expect(result.items[0].owner?.id).toBe('502')
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query.scopeRole).toBe(businessRole)
    expect(user.role).toBe('user')
  })

  it.each([{ department: ref('999'), departmentPathIds: ['10', '999'] },
    { department: ref('401'), departmentPathIds: ['10', '400', '401'] }])('经理不能读取其他部门或子部门%j', async patch => {
    const { service, user } = setup(row => ({ ...row, ...patch }))
    user.dataDisplayScope = 'department'; user.businessRole = 'department_manager'
    await expect(service.getOrders(user.id, query)).rejects.toMatchObject({ status: 403 })
  })

  it('管理员筛选业务员只收窄范围，并校验上游结果', async () => {
    const { service, user, request } = setup(row => ({ ...row, owner: ref('502') }))
    user.role = 'admin' as User['role']
    expect((await service.getOrders(user.id, { ...query, ownerId: '502' })).items[0].owner?.id).toBe('502')
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query.ownerId).toBe('502')
    await expect(service.getOrders(user.id, { ...query, ownerId: '503' })).rejects.toMatchObject({ status: 403 })
  })

  it.each([{ organization: ref('20') }, { department: ref('999'), departmentPathIds: ['10', '999'] }])('复核组织及部门筛选%j', async patch => {
    const { provider } = setup(row => ({ ...row, ...patch }))
    const permission = await provider.resolvePermissions(identity, own)
    await expect(provider.queryOrders(identity, permission, own, { ...query, departmentId: '400' })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it('复核仓库过滤结果', async () => {
    const { provider } = setup()
    const permission = await provider.resolvePermissions(identity, own)
    await expect(provider.queryOrders(identity, permission, own, { ...query, warehouseCode: 'SZ' })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })
})

import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopIntegrationUnavailableError, FopPermissionDeniedError } from './fop-data.types'
import { FopDataService } from './fop-data.service'
import { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'
import { Logger } from '@nestjs/common'

const identity = { tenantId: 'test-tenant', userId: '100' }
const scope = { role: 'admin' as const, departmentId: null, employeeId: null }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/query', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_TENANT_ID: 'test-tenant', FOP_KINGDEE_USER_ID: '100', FOP_KINGDEE_ORGANIZATION_IDS: '10,20',
  FOP_KINGDEE_ACCESS_TOKEN: 'unit-test-token', FOP_KINGDEE_IDENTITY: 'unit-test-identity', FOP_KINGDEE_OPENAPI_SIGN: 'unit-test-sign',
  FOP_KINGDEE_STOCK_WAREHOUSE_CODE_MAP: 'unused-invalid-stock-config',
}
const ref = (id: string) => ({ id, name: `name-${id}` })
const row = (id: string, owner: string, org = '10') => ({
  id, orderNumber: `ORDER-${id}`, shopifyOrderNumber: `#${id}`, customer: ref('200'), store: ref('300'),
  organization: ref(org), department: ref('400'), owner: ref(owner), warehouse: null,
  amount: '123.45', currency: 'USD', billStatus: 'B', orderStatus: '2',
  createdAt: '2026-10-01T01:00:00Z', paidAt: null,
  items: [{ id: `${id}1`, parentId: '0', rowType: 0, sequence: 1, sku: 'SKU-1', name: 'Product', variant: '', quantity: '2' }],
})
const page = (items: unknown[] = [row('1001', '501'), row('1002', '502', '20')], total = 32) => ({
  subject: identity, organizationIds: ['10', '20'], queue: 'review', basis: 'submitted_paid_active', total, page: 2, pageSize: 10,
  items, totals: { orderCount: total, itemQuantity: '64', amountsByCurrency: [{ currency: 'USD', amount: '3950.40' }] },
})
function setup(transform?: (value: ReturnType<typeof page>, summary: boolean) => unknown) {
  const request = jest.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const summary = String(input).endsWith('/summary')
    const body = JSON.parse(String(init?.body)) as { query: { page: number; pageSize: number } }
    const value = { ...page(summary ? [] : undefined), page: body.query.page, pageSize: body.query.pageSize }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data: transform ? transform(value, summary) : value }))
  })
  const provider = new KingdeeFopDataProvider({ get: key => settings[key] }, request)
  return { provider, request }
}

describe('待采购通过同一个金蝶page查询', () => {
  const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'] as 'review'[], organizationIds: ['10', '20'] } }
  const purchase = { id: '901', number: 'CG901', supplier: ref('71'), purchaseType: 'offline', payment: 'unpaid', placement: 'unknown' }
  const line = { fulfillmentLineId: '10011', sku: 'SKU-1', quantity: '1' }
  const response = (obligations: unknown[]) => ({ queue: 'procurement', basis: 'paid_approved_procurement', schemaVersion: 1,
    procurementSchemaVersion: 1, hasMore: false, items: [{ ...row('1001', '501'), billStatus: 'C', departmentPathIds: ['10', '400'], obligations }] })
  it('同一行部分已建单，剩余一件待申请，两个视图和展开共用实际关联；线下已发保留未知', async () => {
    const data = response([{ purchase, lines: [{ ...line, purchaseLineId: '911' }] },
      { lines: [{ ...line, demandStage: 'application_pending', shippedQuantity: '0' }] }])
    const { provider, request } = setup((value, summary) => summary ? value : { ...value, ...data })
    const user = { id: 'local', role: 'admin', businessRole: 'admin', workbenchRoles: ['procurement'],
      fopTenantId: identity.tenantId, fopUserId: identity.userId, businessDepartmentId: null, businessEmployeeId: null,
      fopBindingDetails: { username: 'offline-user', name: '测试职员', employeeRecordId: identity.userId, employeeMasterId: identity.userId,
        departmentId: '10', organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00Z' } } as User
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService, provider)
    const q = { queue: 'procurement' as const, page: 1, pageSize: 20 }
    expect((await service.getOrders(user.id, q)).items[0].procurementProgress?.pendingStage).toBe('application_pending')
    const groups = await service.getPurchaseGroups(user.id, q)
    expect(groups.items.map(g => g.id)).toEqual(['uncreated', 'purchase:901'])
    expect(groups.items[1]).toMatchObject({ quantity: 1, shippedQuantity: null, pendingQuantity: null })
    expect((await service.getPurchaseGroupDetails(user.id, 'purchase:901', q)).items[0].lines[0]).toMatchObject({ fulfillmentLineId: '10011', shippedQuantity: null })
    expect(request.mock.calls.filter(([url]) => String(url).endsWith('/query')).every(([,init]) => JSON.parse(String(init?.body)).query.queue === 'procurement')).toBe(true)
  })
  it('候选页全部已转待发货时沿金蝶游标继续读取待采购', async () => {
    const data = response([{ lines: [{ ...line, demandStage: 'application_pending', shippedQuantity: '0' }] }])
    const { provider, request } = setup(value => value.page === 1
      ? { ...value, ...data, items: [], hasMore: true, nextAfterOrderId: '899' }
      : { ...value, ...data })
    expect((await provider.readPendingProcurement(identity, grant, scope)).orders.map(o => o.id)).toEqual(['1001'])
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query.afterOrderId).toBe('899')
  })
  it('上游旧版本和错配来源行均拒绝', async () => {
    await expect(setup().provider.readPendingProcurement(identity, grant, scope)).rejects.toBeInstanceOf(FopIntegrationUnavailableError)
    const bad = setup(value => ({ ...value, ...response([{ purchase, lines: [{ ...line, fulfillmentLineId: '123', purchaseLineId: '911' }] }]) }))
    await expect(bad.provider.readPendingProcurement(identity, grant, scope)).rejects.toThrow('Invalid procurement source')
  })
  it('不接受超出授权的组织或线下推测的发货数量', async () => {
    const bad = setup(value => ({ ...value, ...response([{ purchase, lines: [{ ...line, purchaseLineId: '911', shippedQuantity: '0' }] }]) }))
    await expect(bad.provider.readPendingProcurement(identity, grant, scope)).rejects.toThrow('Unverified shipment quantity')
    const denied = setup(value => ({ ...value, ...response([]) }))
    await expect(denied.provider.readPendingProcurement(identity, { ...grant, orderQuery: { ...grant.orderQuery, organizationIds: ['20'] } }, scope)).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })
})

describe('配货与仓库分包接口契约', () => {
  const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review'] as 'review'[], organizationIds: ['10', '20'] } }
  const document = { id: '901', number: 'AO901', packageNo: '1', readyAt: null, wmsCreatedAt: null,
    dispatchComplete: false, lineQuantities: { '10011': '2' } }
  const facts = (queue = 'allocation_review') => ({ ...row('1001', '501'), billStatus: 'C', departmentPathIds: ['10', '400'],
    allocationDocuments: [document], dispatchDocuments: [], dispatchDocumentsComplete: false,
    fulfillmentProgress: { allocationCreated: true, stockReadiness: queue === 'allocation' ? 'incomplete' : 'ready', allocationReview: queue === 'shipping' ? 'approved' : 'pending', outbound: 'pending' } })
  const response = (queue: string) => ({ queue, basis: 'paid_approved_allocation_packages', schemaVersion: 1, allocationSchemaVersion: 1, hasMore: false, items: [facts(queue)] })
  const warehouseUser = { id: 'warehouse-local', role: 'admin', businessRole: 'admin', workbenchRoles: ['warehouse'],
    fopTenantId: identity.tenantId, fopUserId: identity.userId, businessDepartmentId: null, businessEmployeeId: null,
    fopBindingDetails: { username: 'offline-user', name: '测试职员', employeeRecordId: identity.userId, employeeMasterId: identity.userId,
      departmentId: '10', organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00Z' } } as User
  const completedFacts = (at: string) => ({ ...facts('shipping'), outboundCompletedAt: at,
    allocationDocuments: [{ ...document, outbound: 'completed', outboundCompletedAt: at }],
    fulfillmentProgress: { ...facts('shipping').fulfillmentProgress, outbound: 'completed' } })
  const issue = { code: 'ALLOCATION_SKU_MISMATCH', allocationId: '902', allocationNumber: 'AO902',
    sourceEntryId: '10021', allocationSku: 'OLD-SKU', orderSku: 'SKU-1' }
  const broken = () => ({ ...row('1002', '501'), billStatus: 'C', departmentPathIds: ['10', '400'], allocationIssues: [issue] })
  it.each([
    ['allocation', false], ['allocation_review', false], ['shipping', false], ['shipping', true],
  ] as const)('v2原始数量由AutoFlow合并后用于%s清单（完成=%s）', async (queue, completed) => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const base = completed ? completedFacts(at) : facts(queue)
    const item = { ...base,
      items: [{ ...base.items[0], quantity: '5' }, { ...base.items[0], id: '10012', quantity: '7' }],
      allocationDocuments: [
        { ...base.allocationDocuments[0], lineQuantities: { '10011': '1.25' } },
        { ...base.allocationDocuments[0], id: '903', packageNo: '2', lineQuantities: { '10011': '0.75' } },
      ] }
    const { provider, request } = setup(value => ({ ...value, ...response(queue), allocationSchemaVersion: 2,
      ...(completed ? { completed: true, outboundCompletedSchemaVersion: 1 } : {}), items: [item] }))
    const orders = await provider.readAllocationOrders(identity, grant, scope, queue, completed)
    expect(orders[0].items.map(line => [line.id, line.quantity])).toEqual([['10011', 2]])
    expect(orders[0].allocationDocuments).toHaveLength(2)
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query.rawAllocationQuantities).toBe(true)
  })
  it('v2按原始十进制精度合并，仓库清单合计使用合并后的数量', async () => {
    const base = facts('shipping')
    const { provider } = setup((value, summary) => summary ? value : ({ ...value, ...response('shipping'), allocationSchemaVersion: 2, items: [{ ...base,
      items: [{ ...base.items[0], quantity: '0.3' }], allocationDocuments: [
        { ...document, lineQuantities: { '10011': '0.1' } },
        { ...document, id: '903', packageNo: '2', lineQuantities: { '10011': '0.2' } },
      ] }] }))
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    const result = await service.getOrders(warehouseUser.id, { queue: 'shipping', page: 1, pageSize: 1 })
    expect(result.items[0].items[0].quantity).toBe(0.3)
    expect(result.totals.itemQuantity).toBe(0.3)
  })
  it.each([
    {}, { '99999': '1' }, { '10011': '2.00000000000000000001' }, { '10011': '0' }, { '10011': '-1' },
  ])('v2拒绝无来源、超量和非法包裹数量：%j', async lineQuantities => {
    const { provider } = setup(value => ({ ...value, ...response('shipping'), allocationSchemaVersion: 2,
      items: [{ ...facts('shipping'), allocationDocuments: [{ ...document, lineQuantities }] }] }))
    await expect(provider.readAllocationOrders(identity, grant, scope, 'shipping')).rejects.toThrow('Invalid allocation source quantities')
  })
  it('异常订单保留明确提示，正常订单照常返回并独立合计', async () => {
    const { provider } = setup((value, summary) => summary ? value : ({ ...value, ...response('shipping'), items: [facts('shipping'), broken()] }))
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    const result = await service.getOrders(warehouseUser.id, { queue: 'shipping', page: 1, pageSize: 1 })
    expect(result.items.map(o => o.id)).toEqual(['1001'])
    expect(result.total).toBe(1)
    expect(result.totals.itemQuantity).toBe(2)
    expect(result).toMatchObject({ allocationIssues: [{ ...issue, orderId: '1002', orderNumber: 'ORDER-1002' }] })
    const onlyBroken = await service.getOrders(warehouseUser.id, { queue: 'shipping', orderNumber: 'ORDER-1002', page: 1, pageSize: 20 })
    expect(onlyBroken.items).toEqual([])
    expect(onlyBroken).toMatchObject({ allocationIssues: [{ allocationNumber: 'AO902' }] })
    const healthyFilter = await service.getOrders(warehouseUser.id, { queue: 'shipping', search: 'ORDER-1001', page: 1, pageSize: 20 })
    expect(healthyFilter).toMatchObject({ allocationIssues: [] })
    for (const filter of [{ departmentId: '999' }, { ownerId: '999' }, { warehouseCode: 'HZ' as const }]) {
      expect(await service.getOrders(warehouseUser.id, { queue: 'shipping', page: 1, pageSize: 20, ...filter }))
        .toMatchObject({ items: [], allocationIssues: [] })
    }
    expect(await service.getOrders(warehouseUser.id, { queue: 'shipping', search: 'OLD-SKU', page: 1, pageSize: 20 }))
      .toMatchObject({ items: [], allocationIssues: [{ allocationNumber: 'AO902' }] })
  })
  it.each([{ code: 'UNVERIFIED' }, { orderSku: 'WRONG-SKU' }, { sourceEntryId: '999' }])('未确认的诊断仍拒绝，不能掩盖上游错误：%j', async patch => {
    const { provider } = setup(value => ({ ...value, ...response('shipping'), items: [{ ...broken(), allocationIssues: [{ ...issue, ...patch }] }] }))
    await expect(provider.readAllocationOrders(identity, grant, scope, 'shipping')).rejects.toThrow('Invalid allocation source diagnostic')
  })
  it('来源引用失效时继续返回正常订单，并明确保持订单SKU未知', async () => {
    const unresolved = { ...issue, code: 'ALLOCATION_SOURCE_UNRESOLVED', sourceEntryId: 'old-reference', orderSku: null }
    const { provider } = setup((value, summary) => summary ? value : ({ ...value, ...response('shipping'),
      items: [facts('shipping'), { ...broken(), allocationIssues: [unresolved] }] }))
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    expect(await service.getOrders(warehouseUser.id, { queue: 'shipping', page: 1, pageSize: 20 }))
      .toMatchObject({ total: 1, allocationIssues: [{ code: 'ALLOCATION_SOURCE_UNRESOLVED', orderSku: null, sourceEntryId: 'old-reference' }] })
  })
  it('只有异常的候选页仍继续读取，诊断订单不得跳过组织与业务范围校验', async () => {
    const { provider } = setup(value => ({ ...value, ...response('shipping'), ...(value.page === 1
      ? { items: [broken()], hasMore: true, nextAfterOrderId: '1002' }
      : { items: [{ ...facts('shipping'), id: '1003' }] }) }))
    expect((await provider.readAllocationOrders(identity, grant, scope, 'shipping')).map(o => o.id)).toEqual(['1002', '1003'])
    const denied = setup(value => ({ ...value, ...response('shipping'), items: [{ ...broken(), organization: ref('999') }] }))
    await expect(denied.provider.readAllocationOrders(identity, grant, scope, 'shipping')).rejects.toBeInstanceOf(FopPermissionDeniedError)
    const otherOwner = setup(value => ({ ...value, ...response('shipping'), items: [broken()] }))
    await expect(otherOwner.provider.readAllocationOrders(identity, grant, { role: 'salesperson', employeeId: '999', departmentId: '400' }, 'shipping')).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })
  it('已出库经真实适配器传递完成模式，按审核完成时间筛选并保留导出能力', async () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const { provider, request } = setup((value, summary) => summary ? value : { ...value, ...response('shipping'),
      completed: true, outboundCompletedSchemaVersion: 1, items: [completedFacts(at)] })
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    const query = { queue: 'shipping' as const, completed: true, timeRange: '1w' as const, page: 1, pageSize: 20 }
    const result = await service.getOrders(warehouseUser.id, query)
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({ outboundCompletedAt: at, fulfillmentProgress: { outbound: 'completed' } })
    const workbook = await service.exportOrders(warehouseUser.id, { ...query, mode: 'filtered' })
    expect(workbook.byteLength).toBeGreaterThan(100)
    const outboundQueries = request.mock.calls.filter(([url]) => String(url).endsWith('/query')).map(([,init]) => JSON.parse(String(init?.body)).query)
    expect(outboundQueries.every(q => q.queue === 'shipping' && q.completed === true && q.timeRange === '1w')).toBe(true)
  })
  it('已出库旧响应即使空页也不能冒充支持完成模式', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, ...response('shipping'), items: [] })
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    await expect(service.getOrders(warehouseUser.id, { queue: 'shipping', completed: true, page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ response: { code: 'fop_feature_not_configured' } })
  })
  it.each(['partial', 'missing-time', 'wrong-package-time', 'wrong-organization'])('已出库拒绝不完整或错配事实：%s', async kind => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const item = completedFacts(at)
    if (kind === 'partial') item.fulfillmentProgress.outbound = 'partial'
    if (kind === 'missing-time') item.outboundCompletedAt = ''
    if (kind === 'wrong-package-time') item.allocationDocuments[0].outboundCompletedAt = '2020-01-01T00:00:00Z'
    if (kind === 'wrong-organization') item.organization = ref('999')
    const { provider } = setup((value, summary) => summary ? value : { ...value, ...response('shipping'), completed: true,
      outboundCompletedSchemaVersion: 1, items: [item] })
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    await expect(service.getOrders(warehouseUser.id, { queue: 'shipping', completed: true, page: 1, pageSize: 20 })).rejects.toThrow()
  })
  it('已出库空候选页继续读取，时间筛选在分页前执行且不回退创建时间', async () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    const { provider, request } = setup((value, summary) => summary ? value : { ...value, ...response('shipping'), completed: true,
      outboundCompletedSchemaVersion: 1, ...(value.page === 1 ? { items: [], hasMore: true, nextAfterOrderId: '900' }
        : { items: [completedFacts(at)] }) })
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, provider)
    const result = await service.getOrders(warehouseUser.id, { queue: 'shipping', completed: true, timeRange: '1w', page: 1, pageSize: 1 })
    expect(result.items.map(o => o.id)).toEqual(['1001'])
    const continuation = request.mock.calls.filter(([url]) => String(url).endsWith('/query')).map(([,init]) => JSON.parse(String(init?.body)).query)
    expect(continuation[1]).toMatchObject({ completed: true, timeRange: '1w', afterOrderId: '900' })
    const old = setup((value, summary) => summary ? value : { ...value, ...response('shipping'), completed: true,
      outboundCompletedSchemaVersion: 1, items: [completedFacts('2020-01-01T00:00:00Z')] })
    const oldService = new FopDataService({ findById: jest.fn().mockResolvedValue(warehouseUser) } as unknown as UsersService, old.provider)
    expect((await oldService.getOrders(warehouseUser.id, { queue: 'shipping', completed: true, timeRange: '1w', page: 1, pageSize: 1 })).total).toBe(0)
  })
  it('已出库仍要求仓库工作台权限', async () => {
    const { provider } = setup()
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue({ ...warehouseUser, role: 'user', businessRole: 'salesperson', businessEmployeeId: '501', businessDepartmentId: '400', workbenchRoles: ['sales'] }) } as unknown as UsersService, provider)
    await expect(service.getOrders(warehouseUser.id, { queue: 'shipping', completed: true, page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 })
  })
  it('上游业务错误日志保留清单、错误码和TraceId，不泄露响应正文', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      const { provider, request } = setup()
      request.mockResolvedValue(new Response(JSON.stringify({ status: false, errorCode: '400',
        message: 'ORMDesignException: private-customer token=secret-value TraceId：4f760380edfaa2b' })))
      await expect(provider.readAllocationOrders(identity, grant, scope, 'shipping')).rejects.toThrow('Kingdee query business failure')
      const logs = warn.mock.calls.map(args => String(args[0])).join('\n')
      expect(logs).toContain('queue=shipping')
      expect(logs).toContain('code=400')
      expect(logs).toContain('traceId=4f760380edfaa2b')
      expect(logs).toContain('category=ORM_DESIGN_ERROR')
      expect(logs).not.toMatch(/private-customer|secret-value|unit-test-token/)
    } finally { warn.mockRestore() }
  })
  it.each(['allocation', 'allocation_review', 'shipping'] as const)('查询%s保留包裹信息，并只使用上游明确的阶段', async queue => {
    const { provider, request } = setup(value => ({ ...value, ...response(queue) }))
    const orders = await provider.readAllocationOrders(identity, grant, scope, queue)
    expect(orders[0].allocationDocuments?.[0]).toMatchObject({ id: '901', packageNo: '1', dispatchComplete: false })
    expect(orders[0].dispatchDocumentsComplete).toBe(false)
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query.queue).toBe(queue)
  })
  it('空候选页继续游标读取，重复游标失败而非漏单', async () => {
    const { provider, request } = setup(value => ({ ...value, ...response('shipping'), ...(value.page === 1 ? { items: [], hasMore: true, nextAfterOrderId: '900' } : {}) }))
    expect(await provider.readAllocationOrders(identity, grant, scope, 'shipping')).toHaveLength(1)
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query.afterOrderId).toBe('900')
    const broken = setup(value => ({ ...value, ...response('shipping'), items: [], hasMore: true, nextAfterOrderId: '900' }))
    await expect(broken.provider.readAllocationOrders(identity, grant, scope, 'shipping')).rejects.toThrow('Invalid procurement continuation')
  })
  it.each([
    { allocationDocuments: [document, document] },
    { allocationDocuments: [{ ...document, lineQuantities: { '10011': '1' } }] },
    { dispatchDocumentsComplete: true },
    { fulfillmentProgress: { allocationCreated: true, stockReadiness: 'ready', allocationReview: 'approved', outbound: 'completed' } },
  ])('拒绝包裹重复、商品数量不符或错误完成状态 %j', async patch => {
    const { provider } = setup(value => ({ ...value, ...response('shipping'), items: [{ ...facts('shipping'), ...patch }] }))
    await expect(provider.readAllocationOrders(identity, grant, scope, 'shipping')).rejects.toThrow()
  })
  it('已采购待发货需独立版本声明，线下已付不推测已发数量', async () => {
    const data = { queue: 'procurement_shipping', basis: 'paid_approved_procurement', schemaVersion: 1, procurementSchemaVersion: 1,
      procurementShippingSchemaVersion: 1, hasMore: false, items: [{ ...row('1001', '501'), billStatus: 'C', departmentPathIds: ['10', '400'], obligations: [{
        purchase: { id: '901', number: 'CG901', supplier: ref('71'), purchaseType: 'offline', payment: 'paid', placement: 'unknown' },
        lines: [{ fulfillmentLineId: '10011', purchaseLineId: '911', sku: 'SKU-1', quantity: '2' }],
      }] }] }
    const { provider, request } = setup(value => ({ ...value, ...data }))
    const snapshot = await provider.readPendingProcurement(identity, grant, scope, undefined, 'procurement_shipping')
    expect(snapshot.orders).toHaveLength(1)
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query.queue).toBe('procurement_shipping')
    const old = setup(value => ({ ...value, ...data, procurementShippingSchemaVersion: undefined }))
    await expect(old.provider.readPendingProcurement(identity, grant, scope, undefined, 'procurement_shipping')).rejects.toBeInstanceOf(FopIntegrationUnavailableError)
  })
  it('即时库存使用独立接口，精确计算小数余额且上游不完整时拒绝', async () => {
    const value = { subject: identity, organizationIds: ['10'], schemaVersion: 1, complete: true, page: 1, pageSize: 50, total: 1,
      asOf: '2026-11-06T01:00:00Z', items: [{ id: 'pool', sku: 'SKU-1', name: 'Product', warehouseKey: '71', warehouse: '杭州仓', customer: null, onHand: '0.3', occupied: '0.1' }] }
    const request = jest.fn(async () => new Response(JSON.stringify({ status: true, errorCode: '0', data: value })))
    const provider = new KingdeeFopDataProvider({ get: key => ({ ...settings, FOP_KINGDEE_WAREHOUSE_MAP: '{"71":"HZ"}', FOP_KINGDEE_ALLOCATION_INVENTORY_URL: 'https://example.test/inventory' })[key] }, request)
    const query = { mode: 'search' as const, search: 'SKU-1', page: 1, pageSize: 50 }
    expect((await provider.queryAllocationInventory(identity, grant, scope, query)).items[0].free).toBe(0.2)
    value.complete = false
    await expect(provider.queryAllocationInventory(identity, grant, scope, query)).rejects.toThrow('Incomplete inventory response')
  })
  it.each(['network', 'server'] as const)('配货审核发生%s错误只调用一次，不自动重试', async failure => {
    const request = jest.fn(async (): Promise<Response> => { if (failure === 'network') throw new Error('connection reset'); return new Response('', { status: 503 }) })
    const provider = new KingdeeFopDataProvider({ get: key => key === 'FOP_KINGDEE_ALLOCATION_APPROVE_URL' ? 'https://example.test/audit' : settings[key] }, request)
    await expect(provider.approveDocument(identity, { tenantId: identity.tenantId, orderId: '1001', id: '901', number: 'AO901', entity: 'hzkj_alloc_bill', version: 'v1', status: 'B', eligible: true, reason: null,
      operation: 'audit', idempotencyKey: 'key', requestId: 'request', actorAccountId: 'actor' }, scope)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('Kingdee server-paged review integration', () => {
  it.each(['2026-10-02T01:30:00Z', null])('待审核保留源单付款时间%s，不回退创建或收款日期', async consumerPaidAt => {
    const { provider } = setup((value, summary) => summary ? value : { ...value,
      items: [{ ...row('1001', '501'), consumerPaidAt, paidAt: '2026-10-03T00:00:00Z' }] })
    const grant = await provider.resolvePermissions(identity, scope)
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })
    expect(result.items[0]).toMatchObject({ consumerPaidAt, paidAt: '2026-10-03T00:00:00Z', paymentStatus: 'paid', reviewStatus: 'pending' })
  })

  it('待审核源单付款时间排序传给金蝶，在分页前执行', async () => {
    const { provider, request } = setup()
    const grant = await provider.resolvePermissions(identity, scope)
    await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 2, pageSize: 10, sortBy: 'consumerPaidAt', sortOrder: 'desc' })
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query).toMatchObject({ sortBy: 'consumerPaidAt', sortOrder: 'desc' })
  })

  it('待审核页面服务允许源单付款时间排序，并保留金蝶总数与支付审核条件', async () => {
    const { provider, request } = setup((value, summary) => summary ? value : { ...value,
      items: [{ ...row('1001', '501'), consumerPaidAt: '2026-10-02T01:30:00Z' }] })
    const user = { id: 'local-admin', role: 'admin', businessRole: 'admin', workbenchRoles: ['sales'],
      fopTenantId: identity.tenantId, fopUserId: identity.userId, businessDepartmentId: null, businessEmployeeId: null,
      fopBindingDetails: { username: 'offline-user', name: '测试职员', employeeRecordId: identity.userId,
        employeeMasterId: identity.userId, departmentId: '10', organizationId: '10', localEmployeeId: null,
        localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00Z' } } as User
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService, provider)
    const result = await service.getOrders(user.id, { queue: 'review', page: 1, pageSize: 10, sortBy: 'consumerPaidAt', sortOrder: 'desc' })
    expect(result.total).toBe(32)
    expect(result.items[0]).toMatchObject({ consumerPaidAt: '2026-10-02T01:30:00Z', paymentStatus: 'paid', reviewStatus: 'pending' })
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).query).toMatchObject({ sortBy: 'consumerPaidAt', sortOrder: 'desc', scopeRole: 'admin' })
  })

  it('reports a bounded shipment-query overflow without treating it as denied permissions', async () => {
    const { provider, request } = setup()
    request.mockResolvedValue(new Response(JSON.stringify({ status: false, errorCode: '', message: 'FOP_RESULT_TOO_LARGE：待履约读取超过上限' })))
    await expect(provider.resolvePermissions(identity, scope)).rejects.toMatchObject({ code: 'fop_result_too_large' })
  })
  it.each(['A', 'B', 'C'])('待履约限定履约订单已审核，独立于发运单阶段：%s', async billStatus => {
    const { provider, request } = setup((value, summary) => ({ ...value, queue: 'dispatch', basis: 'paid_tracking_pending_active', dispatchSchemaVersion: 1,
      departments: [], salespeople: [], items: summary ? [] : [{ ...row('1001', '501'), billStatus,
        dispatchTaskStatus: 'dispatch_missing', dispatchDocuments: [], logisticsInfo: [], fulfillmentProgress: { shopifySync: 'pending' } }] }))
    const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review', 'dispatch'] as ('review' | 'dispatch')[], organizationIds: ['10', '20'] } }
    if (billStatus !== 'C') {
      await expect(provider.queryOrders(identity, grant, scope, { queue: 'dispatch', page: 1, pageSize: 10 })).rejects.toThrow('Unexpected review order status')
      return
    }
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'dispatch', page: 1, pageSize: 10 })
    expect(result.items[0]?.fulfillmentProgress?.shopifySync).toBe('pending')
    expect(result.items[0]?.reviewStatus).toBe(billStatus === 'C' ? 'approved' : 'pending')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).query.queue).toBe('dispatch')
  })

  it('does not treat an old review response as pending Shopify sync', async () => {
    const { provider } = setup()
    const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['dispatch'] as 'dispatch'[], organizationIds: ['10', '20'] } }
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'dispatch', page: 1, pageSize: 10 })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it('opens only the queues explicitly advertised by the deployed permission endpoint', async () => {
    const provider = new KingdeeFopDataProvider({ get: key => key === 'FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL' ? 'https://example.test/permissions' : settings[key] },
      jest.fn(async () => new Response(JSON.stringify({ status: true, errorCode: '0', data: { subject: identity,
        grants: { orders: ['10'], receipts: [], registrations: [], freight: [] }, orderQueues: ['review', 'dispatch'] } }))))
    expect((await provider.resolvePermissions(identity, scope)).orderQuery?.queues).toEqual(['review', 'dispatch'])
  })

  it.each([0, 32, Number.MAX_SAFE_INTEGER])('accepts safely serialized Long count %s in summaries', async count => {
    const { provider } = setup(value => ({ ...value, total: String(count), items: [],
      totals: { ...value.totals, orderCount: String(count) } }))
    const grant = await provider.resolvePermissions(identity, scope)
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 }, true)
    expect(result.total).toBe(count)
    expect(result.totals.orderCount).toBe(count)
  })

  it('accepts mixed numeric and string counts in an order page', async () => {
    const { provider } = setup(value => ({ ...value, total: '32' }))
    const grant = await provider.resolvePermissions(identity, scope)
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })
    expect(result.total).toBe(32)
    expect(result.items).toHaveLength(2)
  })

  it.each(['', ' ', '01', '-1', '1.5', '1e2', '0x20', '9007199254740992', true, null])(
    'rejects invalid or unsafe serialized count %j', async count => {
      const { provider } = setup((value, summary) => summary ? value : { ...value, total: count })
      const grant = await provider.resolvePermissions(identity, scope)
      await expect(provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })).rejects.toThrow('Invalid Kingdee count')
    })

  it('rejects a total and aggregate count mismatch after string conversion', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, total: '32',
      totals: { ...value.totals, orderCount: '31' } })
    const grant = await provider.resolvePermissions(identity, scope)
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })).rejects.toThrow('Invalid Kingdee totals')
  })

  it('requires real connection credentials and organization scope', () => {
    expect(new KingdeeFopDataProvider({ get: () => undefined }).isConfigured()).toBe(false)
    expect(setup().provider.isConfigured()).toBe(true)
  })

  it('returns the server total and both salespeople to an authorized business admin', async () => {
    const { provider, request } = setup()
    const grant = await provider.resolvePermissions(identity, scope)
    expect(grant.allowedOrderIds).toEqual([])
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 2, pageSize: 10 })
    expect(result.total).toBe(32)
    expect(result.items.map(order => order.owner?.id)).toEqual(['501', '502'])
    expect(result.totals.amountsByCurrency).toEqual([{ currency: 'USD', amount: 3950.4 }])
    expect(result.items[0].procurementStatus).toBe('unknown')
    expect(result.items[0]).not.toHaveProperty('tenantId')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('uses trusted identity, business scope and organization configuration rather than extra browser properties', async () => {
    const { provider, request } = setup()
    const grant = await provider.resolvePermissions(identity, scope)
    const query = Object.assign({ queue: 'review', page: 2, pageSize: 10 }, { userId: '999', organizationIds: ['999'], scopeRole: 'none' })
    await provider.queryOrders(identity, grant, scope, query)
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ query: {
      userId: '100', organizationIds: ['10', '20'], scopeRole: 'admin', page: 2,
    } })
  })

  it.each([
    ['subject', (value: ReturnType<typeof page>) => ({ ...value, subject: { ...identity, userId: '999' } })],
    ['organization', (value: ReturnType<typeof page>) => ({ ...value, items: [row('1001', '501', '99')] })],
    ['duplicate', (value: ReturnType<typeof page>) => ({ ...value, items: [row('1001', '501'), row('1001', '501')] })],
  ])('rejects a response with invalid %s', async (_name, transform) => {
    const { provider } = setup((value, summary) => summary ? value : transform(value))
    const grant = await provider.resolvePermissions(identity, scope)
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'review', page: 2, pageSize: 10 })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it('rejects a different salesperson record before serializing the page', async () => {
    const { provider } = setup()
    const personal = { role: 'salesperson' as const, departmentId: null, employeeId: '501' }
    const grant = await provider.resolvePermissions(identity, personal)
    await expect(provider.queryOrders(identity, grant, personal, { queue: 'review', page: 2, pageSize: 10 })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it('does not treat an unintegrated queue as an empty real queue', async () => {
    const { provider } = setup()
    const grant = await provider.resolvePermissions(identity, scope)
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'shipping', page: 1, pageSize: 10 })).rejects.toBeInstanceOf(FopIntegrationUnavailableError)
    await expect(provider.listOrders()).rejects.toBeInstanceOf(FopIntegrationUnavailableError)
  })

  it('经理不能通过部门祖先链读取子部门订单', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, schemaVersion: 1,
      items: [{ ...row('1001', '501'), department: ref('401'), departmentPathIds: ['10', '400', '401'],
        items: [{ ...row('1001', '501').items[0], rowType: null }] }] })
    const manager = { role: 'department_manager' as const, departmentId: '400', employeeId: '501' }
    const grant = await provider.resolvePermissions(identity, manager)
    await expect(provider.queryOrders(identity, grant, manager, { queue: 'review', page: 2, pageSize: 10 })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it.each([
    undefined, ['10', '400', '400', '401'], ['20', '400', '401'], ['10', '400', '999'], ['10', '500', '401'],
  ])('rejects missing, malformed or sibling ancestry in the employee endpoint: %j', async departmentPathIds => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, schemaVersion: 1,
      items: [{ ...row('1001', '501'), department: ref('401'), departmentPathIds }] })
    const manager = { role: 'department_manager' as const, departmentId: '400', employeeId: '501' }
    const grant = await provider.resolvePermissions(identity, manager)
    await expect(provider.queryOrders(identity, grant, manager, { queue: 'review', page: 2, pageSize: 10 })).rejects.toBeInstanceOf(FopPermissionDeniedError)
  })

  it('accepts omitted nullable fields from the Java JSON serializer only for schema version 1', async () => {
    const { provider } = setup((value, summary) => {
      if (summary) return value
      const item = row('1001', '501') as Record<string, unknown>
      delete item.paidAt; delete item.warehouse; delete item.store
      const line = { ...row('1001', '501').items[0] } as Record<string, unknown>; delete line.rowType
      return { ...value, schemaVersion: 1, items: [{ ...item, departmentPathIds: ['10', '400'], items: [line] }] }
    })
    const grant = await provider.resolvePermissions(identity, scope)
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 2, pageSize: 10 })
    expect(result.items[0]).toMatchObject({ paidAt: null, warehouse: '', storeName: '' })
    expect(result.items[0]?.items[0]?.rowType).toBeUndefined()
  })

  it.each([401, 403, 404])('does not retry HTTP %s', async status => {
    const { provider, request } = setup()
    request.mockResolvedValue(new Response('', { status }))
    await expect(provider.resolvePermissions(identity, scope)).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retries a transient read failure once, with no browser redirect', async () => {
    const { provider, request } = setup()
    request.mockRejectedValueOnce(new Error('offline'))
    await provider.resolvePermissions(identity, scope)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1][1]?.redirect).toBe('error')
  })

  it('rejects unpaid orders from an incorrect published filter', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, items: [{ ...row('1001', '501'), billStatus: 'A', orderStatus: '1' }] })
    const grant = await provider.resolvePermissions(identity, scope)
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'review', page: 2, pageSize: 10 })).rejects.toThrow('status')
  })

  it.each(['A', 'B'])('accepts paid unaudited fulfillment orders with bill status %s', async billStatus => {
    const { provider } = setup((value, summary) => summary ? value : { ...value,
      items: [{ ...row('1001', '501'), billStatus }] })
    const grant = await provider.resolvePermissions(identity, scope)
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })
    expect(result.items[0]?.reviewStatus).toBe('pending')
  })

  it('rejects audited fulfillment orders from the review queue', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value,
      items: [{ ...row('1001', '501'), billStatus: 'C' }] })
    const grant = await provider.resolvePermissions(identity, scope)
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })).rejects.toThrow('status')
  })

  it.each(['2', '3', '4', '5'])('retains paid subsequent order status %s when the fulfillment order is unaudited', async orderStatus => {
    const { provider } = setup((value, summary) => summary ? value : { ...value,
      items: [{ ...row('1001', '501'), orderStatus }] })
    const grant = await provider.resolvePermissions(identity, scope)
    expect((await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })).items).toHaveLength(1)
  })

  it('preserves an upstream product image and supports old responses without it', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value,
      items: [{ ...row('1001', '501'), items: [{ ...row('1001', '501').items[0], imageUrl: 'https://images.example.test/product.jpg' }] }, row('1002', '502')] })
    const grant = await provider.resolvePermissions(identity, scope)
    const result = await provider.queryOrders(identity, grant, scope, { queue: 'review', page: 1, pageSize: 10 })
    expect(result.items[0]?.items[0]?.imageUrl).toBe('https://images.example.test/product.jpg')
    expect(result.items[1]?.items[0]?.imageUrl).toBeNull()
  })

  it('keeps unrelated cards unavailable and uses the upstream count for Dashboard', async () => {
    const { provider } = setup()
    const user = { id: 'local-admin', role: 'admin', businessRole: 'admin', fopTenantId: identity.tenantId, fopUserId: identity.userId,
      businessDepartmentId: null, businessEmployeeId: null, workbenchRoles: ['sales'],
      fopBindingDetails: { username: 'offline-user', name: '测试职员', employeeRecordId: identity.userId, employeeMasterId: identity.userId, departmentId: '10', organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00Z' } } as User
    const users = { findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService
    const service = new FopDataService(users, provider)
    const result = await service.getDashboard(user.id, { from: '2026-10-01', to: '2026-10-22', year: 2026 })
    expect(result.queues).toEqual({ review: 32, procurement: null, allocation: null, dispatch: null, shipping: null })
    expect(result.registrations).toEqual([])
    expect(result.receipts.departments).toEqual([])
    await expect(service.getOrderVolume(user.id, { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_feature_not_configured' } })
  })

  it.each([true, false])('keeps advertised dispatch capability through service permissions, with dispatch role=%s', async dispatchRole => {
    const provider = new KingdeeFopDataProvider({ get: key => key === 'FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL' ? 'https://example.test/permissions' : settings[key] },
      async (input, init) => {
        const query = JSON.parse(String(init?.body)).query
        const data = String(input).endsWith('/permissions')
          ? { subject: identity, grants: { orders: ['10', '20'], receipts: [], registrations: [], freight: [] }, orderQueues: ['review', 'dispatch'] }
          : { ...page(String(input).endsWith('/summary') ? [] : [row('1001', '501')], query.queue === 'dispatch' ? 7 : 32),
              page: query.page, pageSize: query.pageSize,
              ...(query.queue === 'dispatch' ? { queue: 'dispatch', basis: 'paid_tracking_pending_active', dispatchSchemaVersion: 1,
                departments: [], salespeople: [], items: String(input).endsWith('/summary') ? [] : [{ ...row('1001', '501'), billStatus: 'C',
                  dispatchTaskStatus: 'dispatch_missing', dispatchDocuments: [], logisticsInfo: [], fulfillmentProgress: { shopifySync: 'pending' } }] } : {}) }
        return new Response(JSON.stringify({ status: true, errorCode: '0', data }))
      })
    const user = { id: 'local-employee', role: 'user', businessRole: 'salesperson', fopTenantId: identity.tenantId, fopUserId: identity.userId,
      businessDepartmentId: '400', businessEmployeeId: '501', workbenchRoles: dispatchRole ? ['sales', 'dispatch'] : ['sales'],
      fopBindingDetails: { username: 'offline-user', name: '测试职员', employeeRecordId: identity.userId, employeeMasterId: identity.userId, departmentId: '10', organizationId: '10', localEmployeeId: null, localDepartmentId: null, verifiedAt: '2026-10-29T00:00:00Z' } } as User
    const service = new FopDataService({ findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService, provider)
    const result = await service.getDashboard(user.id, { from: '2026-10-01', to: '2026-10-22', year: 2026 })
    expect('integratedQueues' in result && result.integratedQueues).toEqual(dispatchRole ? ['review', 'dispatch'] : ['review'])
    expect(result.queues.dispatch).toBe(dispatchRole ? 7 : null)
    expect(result.tasks.some(task => task.kind === 'dispatch')).toBe(dispatchRole)
    const orders = service.getOrders(user.id, { queue: 'dispatch', workbenchRole: 'dispatch', page: 1, pageSize: 10 })
    if (dispatchRole) expect((await orders).total).toBe(7)
    else await expect(orders).rejects.toMatchObject({ status: 403 })
  })
})

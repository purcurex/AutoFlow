import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopOrder, FopOrderPageQuery } from './fop-data.types'
import { UsersService } from '../users/users.service'
import { User, UserRole } from '../users/user.entity'
import { LocalWorkbenchOrganization } from '../users/local-workbench-organization'
import { matchesBusinessScope } from '../users/business-scope'
import type { FopStockOrderCandidate } from './fop-stock.types'
import * as ExcelJS from 'exceljs'

const directory = (): LocalWorkbenchOrganization => ({
  version: 'v1', employeeIds: null, departmentId: null, employeeId: '101',
  departments: [
    { id: 'marketing', name: '营销中心', parentId: 'root', pathIds: ['root', 'marketing'] },
    { id: 'local-1', name: '业务一部', parentId: 'marketing', pathIds: ['root', 'marketing', 'local-1'] },
    { id: 'empty', name: '业务二部', parentId: 'marketing', pathIds: ['root', 'marketing', 'empty'] },
  ], members: [{ employeeId: '101', localEmployeeId: 'person-1', departmentId: 'local-1', name: 'Wendy' }],
})
function setup() {
  let org = directory()
  const user = { id: 'local-user', role: UserRole.ADMIN, businessRole: 'admin', businessDepartmentId: null,
    fopTenantId: 'tenant', fopUserId: '900', fopBindingDetails: { employeeMasterId: '101', localEmployeeId: 'person-1', departmentId: 'fop-dept', organizationId: '10' } } as User
  const users = { findById: async () => user, localWorkbenchOrganization: async () => structuredClone(org) }
  const row = { id: 'order-1', owner: { id: '101', name: 'FOP旧名' }, salesperson: 'FOP旧名', department: { id: 'fop-dept', name: 'FOP部门' } } as FopOrder
  const grant = { subject: { tenantId: 'tenant', userId: '900' }, allowedOrderIds: [], orderQuery: { queues: ['review', 'dispatch', 'unpaid'], organizationIds: ['10'], employeeFilterVersion: 1 } }
  const queryOrders = jest.fn(async (_identity, _permission, _scope, query: FopOrderPageQuery) => ({
    source: 'fop', items: [row], total: 37, page: query.page, pageSize: query.pageSize,
    departments: [{ id: 'fop-dept', name: 'FOP部门' }], salespeople: [{ id: '999', name: '外部人员' }],
    totals: { orderCount: 37, itemQuantity: 75, amountsByCurrency: [] },
  }))
  const provider = { pagedOrders: true, supportsEmployeeBinding: true, usesLocalWorkbenchOrganization: true,
    source: 'fop', isConfigured: () => true, administratorIdentity: async () => null, resolvePermissions: jest.fn(async () => grant), queryOrders } as unknown as FopDataProvider
  const localCounts: Record<string, number> = { review: 37, dispatch: 37 }
  const local = { enabled: true, getOrders: jest.fn(async (_userId: string, query: { queue: string; projection?: string; page: number; pageSize: number }) => {
    if (localCounts[query.queue] === undefined) throw new ServiceUnavailableException({ code: 'fop_feature_not_configured' })
    return { total: org.employeeIds?.length === 0 ? 0 : localCounts[query.queue] }
  }) }
  return { service: new FopDataService(users as unknown as UsersService, provider), user, users, row, provider, grant, queryOrders, local, localCounts,
    setOrg: (next: LocalWorkbenchOrganization) => { org = next } }
}
const query = { queue: 'review' as const, page: 1, pageSize: 20 }

it('translates a local department before upstream pagination and projects local labels without changing totals', async () => {
  const x = setup()
  const page = await x.service.getOrders('local-user', { ...query, departmentId: 'marketing' })
  expect(x.queryOrders.mock.calls[0][3]).toMatchObject({ employeeFilter: { employeeIds: ['101'], version: 'v1' } })
  expect(x.queryOrders.mock.calls[0][3].departmentId).toBeUndefined()
  expect(page.total).toBe(37)
  expect(page.items[0]).toMatchObject({ department: { id: 'local-1', name: '业务一部' }, salesperson: 'Wendy' })
  expect(page.departments.map(d => d.id)).toEqual(['marketing', 'local-1', 'empty'])
  expect(page.salespeople).toEqual([{ id: '101', name: 'Wendy' }])
})
it('keeps an empty local department empty without making an upstream data request', async () => {
  const x = setup()
  expect(await x.service.getOrders('local-user', { ...query, departmentId: 'empty' })).toMatchObject({ total: 0, items: [], totals: { orderCount: 0, itemQuantity: 0 } })
  expect(x.provider.resolvePermissions).toHaveBeenCalled()
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it.each([{ departmentId: 'fop-dept' }, { ownerId: '999' }])('rejects a forged local filter %j', async filter => {
  const x = setup()
  await expect(x.service.getOrders('local-user', { ...query, ...filter })).rejects.toMatchObject({ status: 403 })
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it('rejects a directory change while an upstream page is being read', async () => {
  const x = setup(), original = x.queryOrders.getMockImplementation()!
  x.queryOrders.mockImplementation(async (...args) => { const result = await original(...args); x.setOrg({ ...directory(), version: 'v2' }); return result })
  await expect(x.service.getOrders('local-user', query)).rejects.toMatchObject({ response: { code: 'fop_binding_changed' } })
})
it('retains an unmapped historical order for admin without displaying the FOP department', async () => {
  const x = setup(); x.row.owner = { id: '202', name: '历史业务员' }
  const result = await x.service.getOrders('local-user', query)
  expect(result.items).toHaveLength(1)
  expect(result.items[0].department).toEqual({ id: 'local:unmapped', name: '未关联本地部门' })
})
it('rejects upstream rows outside the translated member set instead of filtering one page', async () => {
  const x = setup(); x.row.owner = { id: '202', name: 'Other' }
  await expect(x.service.getOrders('local-user', { ...query, departmentId: 'local-1' })).rejects.toMatchObject({ status: 403 })
})
it('uses employee membership rather than a FOP department for local manager scope', () => {
  const scope = { role: 'department_manager' as const, departmentId: 'local-1', employeeId: null, localOrganization: { employeeIds: ['101'], version: 'v1' } }
  expect(matchesBusinessScope(scope, { owner: { id: '101' }, department: { id: 'fop-dept' } })).toBe(true)
  expect(matchesBusinessScope(scope, { owner: { id: '202' }, department: { id: 'local-1' } })).toBe(false)
  expect(matchesBusinessScope({ ...scope, localOrganization: { employeeIds: [], version: 'v1' } }, { owner: { id: '101' } })).toBe(false)
})

function stockRow(): FopStockOrderCandidate {
  return { tenantId: 'tenant', id: 's1', stockNumber: 'BH001', stockType: 'full_payment', storeName: null,
    customerId: 'c1', customerCode: 'C001', customerName: 'Customer', owner: { id: '101', name: 'FOP旧名' },
    department: { id: 'fop-dept', name: 'FOP部门' }, departmentPathIds: ['fop-root', 'fop-dept'],
    items: [{ sku: 'SKU1', name: 'Product', quantity: 2, variant: '', imageUrl: null }],
    amount: 10, currency: 'USD', paidAt: null, createdAt: '2026-11-01T00:00:00Z', cancelled: false,
    paymentStatus: 'unpaid', reviewStatus: 'pending', purchaseStatus: 'unpurchased', warehouseCode: 'HZ', warehouse: '杭州仓' }
}
it('projects stock ownership before department filtering, totals and Excel', async () => {
  const x = setup()
  Object.assign(x.provider, { queriedStock: true, resolveStockPermissions: async () => ({ ...x.grant, stockQuery: { orders: ['10'], inventory: ['10'] } }),
    listStockOrders: async () => [stockRow()] })
  const result = await x.service.getStockOrders('local-user', { departmentId: 'marketing', page: 1, pageSize: 10 })
  expect(result).toMatchObject({ total: 1, totals: { orderCount: 1, itemQuantity: 2 }, items: [{ department: { id: 'local-1' }, owner: { name: 'Wendy' } }] })
  expect(result.departments.map(d => d.id)).toContain('empty')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await x.service.exportStockOrders('local-user', { departmentId: 'marketing', mode: 'filtered' }) as never)
  const values = JSON.stringify(book.getWorksheet('备货清单')!.getSheetValues())
  expect(values).toContain('Wendy'); expect(values).not.toContain('FOP旧名')
})
it('uses the same translated employee range for export manifests and detail batches', async () => {
  const x = setup()
  Object.assign(x.row, { orderNumber: 'TO001', shopifyOrderNumber: '#001', customerName: 'Customer', storeName: '', items: [], amount: 10, currency: 'USD',
    paymentStatus: 'paid', reviewStatus: 'pending', procurementStatus: 'pending', allocationStatus: 'pending', dispatchStatus: 'pending', shippingStatus: 'pending',
    cancelled: false, exception: null, createdAt: '2026-11-01T00:00:00Z', paidAt: null, warehouse: null, carrier: null, trackingNumber: null,
    fulfillmentProgress: { shopifySync: 'pending', supplierShipment: 'unknown', stockReadiness: 'unknown', allocationReview: 'unknown', outbound: 'unknown' } })
  x.queryOrders.mockImplementation(async (_identity, _permission, _scope, q) => ({ source: 'fop', items: q.exportManifest ? [] : [x.row], total: 1,
    page: q.page, pageSize: q.pageSize, orderIds: q.exportManifest ? ['order-1'] : undefined, departments: [], salespeople: [],
    totals: { orderCount: 1, itemQuantity: 0, amountsByCurrency: [] } }))
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await x.service.exportOrders('local-user', { queue: 'dispatch', departmentId: 'marketing', mode: 'filtered' }) as never)
  expect(JSON.stringify(book.getWorksheet('订单清单')!.getSheetValues())).toContain('Wendy')
  expect(x.queryOrders.mock.calls).toHaveLength(4)
  for (const call of x.queryOrders.mock.calls) {
    expect(call[3]).toMatchObject({ employeeFilter: { employeeIds: ['101'], version: 'v1' } })
    expect(call[3].departmentId).toBeUndefined()
  }
})
it('keeps the internal membership snapshot out of the public data access response', async () => {
  const x = setup()
  const access = await x.service.getDataAccess('local-user')
  expect(access.businessScope).toMatchObject({ role: 'admin' })
  expect(access.businessScope).not.toHaveProperty('localOrganization')
})

const dashboardQuery = { from: '2026-01-01', to: '2026-01-01', year: 2026 }
it('uses published local list counts without resolving legacy list grants or calling diagnostic order pages', async () => {
  const x = setup()
  x.user.role = UserRole.USER; x.user.dataDisplayScope = 'department'; x.user.businessRole = 'department_manager'; x.user.businessDepartmentId = 'local-1'; x.user.workbenchRoles = ['sales', 'dispatch']
  x.setOrg({ ...directory(), employeeIds: ['101'], departmentId: 'local-1' })
  x.localCounts.review = 11
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toMatchObject({ review: 11, dispatch: 37 })
  expect(x.local.getOrders).toHaveBeenCalledWith('local-user', { queue: 'review', projection: 'count', page: 1, pageSize: 1 })
  expect(x.queryOrders).not.toHaveBeenCalled()
  expect((x.provider.resolvePermissions as jest.Mock).mock.calls.every(call => call[1].localOrganization === undefined)).toBe(true)
})
it('keeps independent analytics available when the local replica is unavailable', async () => {
  const x = setup()
  x.local.getOrders.mockRejectedValue(new ServiceUnavailableException({ code: 'fop_feature_not_configured' }))
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toMatchObject({ review: null, dispatch: null })
  expect(data).toHaveProperty('integratedQueues', []); expect(data).toHaveProperty('receipts')
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it('does not suppress denied local dashboard access as a missing capability', async () => {
  const x = setup()
  x.local.getOrders.mockRejectedValue(new ForbiddenException('Local replica resource denied'))
  await expect(x.service.getDashboard('local-user', dashboardQuery, x.local as any)).rejects.toMatchObject({ status: 403 })
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it('keeps a successful local review count when dispatch is unavailable', async () => {
  const x = setup(); delete x.localCounts.dispatch
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toMatchObject({ review: 37, dispatch: null })
  expect(data).toHaveProperty('queueStates.review', 'ready'); expect(data).toHaveProperty('queueStates.dispatch', 'not_configured')
})
it('allows a dispatch-only account to read its local dashboard without granting sales data', async () => {
  const x = setup()
  x.user.role = UserRole.USER; x.user.businessRole = 'salesperson'; x.user.workbenchRoles = ['dispatch']; x.user.businessEmployeeId = '101'
  x.setOrg({ ...directory(), employeeIds: ['101'] })
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toMatchObject({ review: null, dispatch: 37 }); expect(data).toHaveProperty('queueStates.review', 'forbidden')
  expect(x.local.getOrders.mock.calls.map(call => call[1].queue)).toEqual(['dispatch'])
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it('counts all five cards from local totals and exposes their separate list entrances', async () => {
  const x = setup()
  Object.assign(x.localCounts, { review: 0, dispatch: 37, procurement: 12, procurement_shipping: 7, allocation: 3, allocation_review: 4, shipping: 8 })
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toEqual({ review: 0, dispatch: 37, procurement: 19, allocation: 7, shipping: 8 })
  expect(data).toHaveProperty('queueBreakdown.procurement', [{ queue: 'procurement', count: 12, state: 'ready' }, { queue: 'procurement_shipping', count: 7, state: 'ready' }])
  expect(data.tasks.map(task => [task.kind, task.count])).toEqual([['dispatch', 37], ['procurement', 19], ['allocation', 7], ['shipping', 8]])
  expect(x.local.getOrders.mock.calls.every(call => call[1].projection === 'count' && call[1].pageSize === 1)).toBe(true)
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it('does not present a partial local combined card as a complete count', async () => {
  const x = setup(); x.localCounts.procurement = 37
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues.procurement).toBeNull()
  expect(data).toHaveProperty('queueBreakdown.procurement', [{ queue: 'procurement', count: 37, state: 'ready' }, { queue: 'procurement_shipping', count: null, state: 'not_configured' }])
  expect(data.tasks.some(task => task.kind === 'procurement')).toBe(false)
})
it('does not turn a local query failure into zero or discard other queues', async () => {
  const x = setup(), original = x.local.getOrders.getMockImplementation()!
  x.local.getOrders.mockImplementation(async (...args) => { if (args[1].queue === 'dispatch') throw new ServiceUnavailableException('local query timeout'); return original(...args) })
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toMatchObject({ review: 37, dispatch: null }); expect(data).toHaveProperty('queueStates.dispatch', 'unavailable')
})
it('propagates a local reader directory-change conflict during dashboard delivery', async () => {
  const x = setup()
  x.local.getOrders.mockRejectedValue(new ConflictException({ code: 'workbench_scope_changed' }))
  await expect(x.service.getDashboard('local-user', dashboardQuery, x.local as any)).rejects.toMatchObject({ response: { code: 'workbench_scope_changed' } })
})
it('keeps an empty local manager membership at zero without wider upstream counts', async () => {
  const x = setup()
  x.user.role = UserRole.USER; x.user.dataDisplayScope = 'department'; x.user.businessRole = 'department_manager'; x.user.businessDepartmentId = 'local-1'; x.user.workbenchRoles = ['sales', 'dispatch']
  x.setOrg({ ...directory(), employeeIds: [], departmentId: 'local-1' })
  const data = await x.service.getDashboard('local-user', dashboardQuery, x.local as any)
  expect(data.queues).toMatchObject({ review: 0, dispatch: 0 }); expect(data.tasks).toEqual([])
  expect(x.queryOrders).not.toHaveBeenCalled()
})
it('rejects the dashboard when a local queue loses authorization', async () => {
  const x = setup(), original = x.local.getOrders.getMockImplementation()!
  x.local.getOrders.mockImplementation(async (...args) => { if (args[1].queue === 'dispatch') throw new ForbiddenException('revoked'); return original(...args) })
  await expect(x.service.getDashboard('local-user', dashboardQuery, x.local as any)).rejects.toMatchObject({ status: 403 })
})
it('does not query local or diagnostic pending queues in analytics-only mode', async () => {
  const x = setup()
  await x.service.getDashboard('local-user', { ...dashboardQuery, includeQueues: false }, x.local as any)
  expect(x.queryOrders).not.toHaveBeenCalled(); expect(x.local.getOrders).not.toHaveBeenCalled()
})
it('uses the verified own identity for manager personal analytics despite a legacy employee assignment', async () => {
  const x = setup()
  Object.assign(x.user, { role: UserRole.USER, businessRole: 'department_manager', businessDepartmentId: 'local-1', businessEmployeeId: 'someone-else', dataDisplayScope: 'self', workbenchRoles: ['sales'] })
  const result = await x.service.getChartAccess('local-user')
  expect(result.businessScope).toMatchObject({ role: 'salesperson', employeeId: '101' })
  expect(result.charts.every(chart => chart.dataScope === 'self' || chart.dataScope === 'none')).toBe(true)
  expect(result.charts.every(chart => chart.summaryDepartments.length === 0)).toBe(true)
})
it('rejects an in-flight page when the manager changes display preference', async () => {
  const x = setup()
  Object.assign(x.user, { role: UserRole.USER, businessRole: 'department_manager', dataDisplayScope: 'department' as const, businessDepartmentId: 'local-1', businessEmployeeId: 'person-1', workbenchRoles: ['sales'] })
  x.setOrg({ ...directory(), employeeIds: ['101'], departmentId: 'local-1' })
  const original = x.queryOrders.getMockImplementation()!
  x.queryOrders.mockImplementation(async (...args) => {
    const result = await original(...args)
    x.user.dataDisplayScope = 'self'
    return result
  })
  await expect(x.service.getOrders('local-user', query)).rejects.toMatchObject({ status: 403 })
})

it('reports an unimplemented adapter queue as not configured, without treating it as revoked access', async () => {
  const x = setup()
  Object.assign(x.provider, { supportedOrderQueues: ['unpaid', 'review', 'dispatch'] })
  await expect(x.service.getOrders('local-user', { queue: 'procurement', page: 1, pageSize: 1 }))
    .rejects.toMatchObject({ status: 503, response: { code: 'fop_feature_not_configured' } })
  expect(x.queryOrders).not.toHaveBeenCalled()
  expect((await x.service.getOrders('local-user', { queue: 'review', page: 1, pageSize: 1 })).total).toBe(37)
})
it('continues denying an implemented queue whose current FOP grant was revoked', async () => {
  const x = setup()
  Object.assign(x.provider, { supportedOrderQueues: ['unpaid', 'review', 'dispatch'] })
  x.grant.orderQuery.queues = ['dispatch']
  await expect(x.service.getOrders('local-user', { queue: 'review', page: 1, pageSize: 1 }))
    .rejects.toMatchObject({ status: 403, response: { code: 'fop_permission_denied' } })
  expect(x.queryOrders).not.toHaveBeenCalled()
})

it('limits business department choices to Marketing and Sales I–IV in business order', async () => {
  const { localDepartments, localEmployeeFilter } = await import('./local-workbench-scope')
  const org = directory()
  org.departments.push({ id: 'ops', name: '物流管理', parentId: 'root', pathIds: ['root','ops'] },
    { id: 'it', name: '信息管理部', parentId: 'root', pathIds: ['root','it'] },
    { id: 'four', name: '业务四部', parentId: 'marketing', pathIds: ['root','marketing','four'] },
    { id: 'three', name: '业务三部', parentId: 'marketing', pathIds: ['root','marketing','three'] })
  expect(localDepartments(org).map(d => d.name)).toEqual(['营销中心','业务一部','业务二部','业务三部','业务四部'])
  expect(() => localEmployeeFilter(org, { departmentId: 'ops' })).toThrow('业务部门不在当前账号范围内')
  expect(localEmployeeFilter(org, {}).employeeIds).toBeNull()
})

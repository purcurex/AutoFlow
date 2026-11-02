import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopIntegrationUnavailableError, FopPermissionDeniedError } from './fop-data.types'
import { FopDataService } from './fop-data.service'
import { UsersService } from '../users/users.service'
import type { User } from '../users/user.entity'

const identity = { tenantId: 'test-tenant', userId: '100' }
const scope = { role: 'admin' as const, departmentId: null, employeeId: null }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://example.test/query', FOP_KINGDEE_SUMMARY_URL: 'https://example.test/summary',
  FOP_KINGDEE_TENANT_ID: 'test-tenant', FOP_KINGDEE_USER_ID: '100', FOP_KINGDEE_ORGANIZATION_IDS: '10,20',
  FOP_KINGDEE_ACCESS_TOKEN: 'unit-test-token', FOP_KINGDEE_IDENTITY: 'unit-test-identity', FOP_KINGDEE_OPENAPI_SIGN: 'unit-test-sign',
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

describe('Kingdee server-paged review integration', () => {
  it('reports a bounded shipment-query overflow without treating it as denied permissions', async () => {
    const { provider, request } = setup()
    request.mockResolvedValue(new Response(JSON.stringify({ status: false, errorCode: '', message: 'FOP_RESULT_TOO_LARGE：待履约读取超过上限' })))
    await expect(provider.resolvePermissions(identity, scope)).rejects.toMatchObject({ code: 'fop_result_too_large' })
  })
  it.each(['A', 'B', 'C'])('reads paid pending Shopify sync without imposing internal audit status %s', async billStatus => {
    const { provider, request } = setup((value, summary) => ({ ...value, queue: 'dispatch', basis: 'paid_tracking_pending_active',
      items: summary ? [] : [{ ...row('1001', '501'), billStatus }] }))
    const grant = { subject: identity, allowedOrderIds: [], orderQuery: { queues: ['review', 'dispatch'] as ('review' | 'dispatch')[], organizationIds: ['10', '20'] } }
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

  it('accepts an authorized child department from the versioned employee endpoint', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, schemaVersion: 1,
      items: [{ ...row('1001', '501'), department: ref('401'), departmentPathIds: ['10', '400', '401'],
        items: [{ ...row('1001', '501').items[0], rowType: null }] }] })
    const manager = { role: 'department_manager' as const, departmentId: '400', employeeId: '501' }
    const grant = await provider.resolvePermissions(identity, manager)
    const result = await provider.queryOrders(identity, grant, manager, { queue: 'review', page: 2, pageSize: 10 })
    expect(result.items[0]?.departmentPathIds).toEqual(['10', '400', '401'])
    expect(result.items[0]?.items[0]?.rowType).toBeUndefined()
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
              ...(query.queue === 'dispatch' ? { queue: 'dispatch', basis: 'paid_tracking_pending_active' } : {}) }
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

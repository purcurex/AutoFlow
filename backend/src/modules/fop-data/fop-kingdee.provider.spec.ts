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

  it('rejects unapproved and unpaid orders from an incorrect published filter', async () => {
    const { provider } = setup((value, summary) => summary ? value : { ...value, items: [{ ...row('1001', '501'), billStatus: 'A', orderStatus: '1' }] })
    const grant = await provider.resolvePermissions(identity, scope)
    await expect(provider.queryOrders(identity, grant, scope, { queue: 'review', page: 2, pageSize: 10 })).rejects.toThrow('status')
  })

  it('keeps unrelated cards unavailable and uses the upstream count for Dashboard', async () => {
    const { provider } = setup()
    const user = { id: 'local-admin', role: 'admin', businessRole: 'admin', fopTenantId: identity.tenantId, fopUserId: identity.userId,
      businessDepartmentId: null, businessEmployeeId: null, workbenchRoles: ['sales'] } as User
    const users = { findById: jest.fn().mockResolvedValue(user) } as unknown as UsersService
    const service = new FopDataService(users, provider)
    const result = await service.getDashboard(user.id, { from: '2026-10-01', to: '2026-10-22', year: 2026 })
    expect(result.queues).toEqual({ review: 32, allocation: null, dispatch: null, shipping: null })
    expect(result.registrations).toEqual([])
    expect(result.receipts.departments).toEqual([])
    await expect(service.getOrderVolume(user.id, { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_feature_not_configured' } })
  })
})

import { KingdeeFopDataProvider } from './fop-kingdee.provider'
import { FopDataService } from './fop-data.service'
import { FopPermissionDeniedError, type FopAnalyticsResource } from './fop-data.types'
import type { User } from '../users/user.entity'
import type { UsersService } from '../users/users.service'

const identity = { tenantId: 'offline-test', userId: '100' }
const scope = { role: 'admin' as const, departmentId: null, employeeId: null }
const at = '2025-10-03T02:00:00Z'
const ref = (id: string, name = `Name-${id}`) => ({ id, name, number: `N-${id}` })
const dimensions = { organization: ref('10'), department: ref('400'), owner: ref('501'), customer: ref('200', 'Customer'), warehouse: ref('600'), carrier: ref('700') }
const items = [{ sku: 'SKU-1', name: 'Product', variant: 'Blue', quantity: '2' }]
const order = { ...dimensions, id: '1001', orderNumber: 'ORDER-1001', shopifyOrderNumber: '#1001', storeName: 'Shop', amount: '100.00', currency: 'USD', createdAt: at, paidAt: at, items }
const receipt = { ...dimensions, id: '2001:1', sourceType: 'fulfillment', documentId: '1001', documentNumber: 'ORDER-1001', amount: '97.00', orderAmount: '100.00', handlingFee: '3.00', currency: 'USD', paidAt: at, items }
const stock = { ...receipt, id: '2002:1', sourceType: 'full_payment_stock', documentId: '1002', documentNumber: 'STOCK-1002', carrier: null, amount: '50.00', orderAmount: '50.00', handlingFee: '0.00' }
const freight = { ...dimensions, id: '3001', documentNumber: 'SHIP-3001', orderNumber: 'ORDER-1001', trackingNumber: 'TRACK-1', channelName: 'Test Channel', originalAmount: '70.00', originalCurrency: 'CNY', fxRateToUsd: '0.14', fxRateDate: '2025-10-03', fxRateSource: 'kingdee_exrate_table:800', amount: '9.80', confirmedAt: at }
const registration = { ...dimensions, id: '4001', registeredAt: at }
const settings: Record<string, string> = {
  FOP_KINGDEE_QUERY_URL: 'https://offline.test/review', FOP_KINGDEE_SUMMARY_URL: 'https://offline.test/summary',
  FOP_KINGDEE_ANALYTICS_PERMISSIONS_URL: 'https://offline.test/permissions', FOP_KINGDEE_ANALYTICS_QUERY_URL: 'https://offline.test/read',
  FOP_KINGDEE_TENANT_ID: identity.tenantId, FOP_KINGDEE_USER_ID: identity.userId, FOP_KINGDEE_ORGANIZATION_IDS: '10,20',
  FOP_KINGDEE_ACCESS_TOKEN: 'offline-only', FOP_KINGDEE_IDENTITY: 'offline-only', FOP_KINGDEE_OPENAPI_SIGN: 'offline-only',
  FOP_KINGDEE_DEPARTMENT_MAP: '{"400":"sales1"}', FOP_KINGDEE_WAREHOUSE_MAP: '{"600":"HZ"}', FOP_KINGDEE_CARRIER_MAP: '{"700":"YT"}', FOP_KINGDEE_EXRATE_TABLE_ID: '800',
}
type Query = { resource: FopAnalyticsResource; from: string; to: string; page: number; pageSize: number; keyword?: string }
type Records = Record<FopAnalyticsResource, unknown[]>
const records = (): Records => ({ orders: [order, { ...order, id: '1003', owner: ref('502') }], receipts: [receipt, stock], registrations: [registration, { ...registration, id: '4002' }], freight: [freight] })
function setup(options: { records?: Records; grants?: Partial<Record<FopAnalyticsResource, string[]>>; transform?: (value: Record<string, unknown>, query: Query) => unknown; config?: Record<string, string> } = {}) {
  const data = options.records ?? records()
  const request = jest.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const { query } = JSON.parse(String(init?.body)) as { query: Query }
    let value: unknown
    if (String(input).endsWith('/permissions')) value = { subject: identity, grants: { orders: ['10', '20'], receipts: ['10', '20'], registrations: ['10', '20'], freight: ['10', '20'], ...options.grants } }
    else if (String(input).endsWith('/summary')) value = { subject: identity, queue: 'review', basis: 'submitted_paid_active', organizationIds: ['10', '20'], page: 1, pageSize: 1, items: [], total: 7, totals: { orderCount: 7, itemQuantity: '14', amountsByCurrency: [{ currency: 'USD', amount: '700' }] } }
    else {
      const selected = data[query.resource].filter(value => {
        const row = value as Record<string, unknown>
        const day = String(row.paidAt ?? row.confirmedAt ?? row.registeredAt).slice(0, 10)
        return day >= query.from && day <= query.to
      })
      const valuePage = { subject: identity, resource: query.resource, organizationIds: ['10', '20'], from: query.from, to: query.to, page: query.page, pageSize: query.pageSize,
        hasMore: query.page * query.pageSize < selected.length, items: selected.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) }
      value = options.transform ? options.transform(valuePage, query) : valuePage
    }
    return new Response(JSON.stringify({ status: true, errorCode: '0', data: value }))
  })
  const config = { ...settings, ...options.config }
  const provider = new KingdeeFopDataProvider({ get: key => config[key] }, request)
  const user = { id: 'local', role: 'admin', businessRole: 'admin', businessDepartmentId: null, businessEmployeeId: null, fopTenantId: identity.tenantId, fopUserId: identity.userId, workbenchRoles: ['sales'] } as User
  const users = { findById: jest.fn().mockResolvedValue(user) }
  const service = new FopDataService(users as unknown as UsersService, provider)
  return { provider, service, request, user, users }
}

describe('Kingdee nine analytics integration, offline transport', () => {
  it('aggregates daily registrations, department and salesperson actual collections, preserving source breakdown', async () => {
    const { service } = setup()
    const dashboard = await service.getDashboard('local', { from: '2025-10-01', to: '2025-10-04', year: 2025 })
    expect('analyticsConfigured' in dashboard && dashboard.analyticsConfigured).toBe(true)
    expect(dashboard.registrations.map(row => row.count)).toEqual([0, 0, 2, 0])
    expect(dashboard.registrationDepartments[0].salespeople[0].counts).toEqual([0, 0, 2, 0])
    expect(dashboard.receipts.marketingCenter!.amounts[9]).toBe(147)
    expect(dashboard.receipts.departments[0].salespeople[0].amounts[9]).toBe(147)
    expect(dashboard.receipts.marketingCenter!.breakdown.fulfillment[9]).toBe(97)
    expect(dashboard.receipts.marketingCenter!.breakdown.fullPaymentStock[9]).toBe(50)
    expect(dashboard.queues).toEqual({ review: 7, allocation: null, dispatch: null, shipping: null })
  })

  it('connects business order volumes, customer ranking, customer search and single customer trend', async () => {
    const { service, request } = setup()
    const base = { grain: 'month' as const, year: 2025, warehouse: 'ALL' as const }
    const volume = await service.getOrderVolume('local', { ...base, category: 'organization' })
    expect(volume.total).toBe(2)
    const ranking = await service.getOrderVolume('local', { ...base, category: 'customer' })
    expect(ranking.series.find(s => s.entityId === '200')?.amounts?.total).toBe(147)
    const search = await service.searchOrderCustomers('local', { keyword: 'Customer', page: 1, pageSize: 10 })
    expect(search.items.map(row => row.id)).toEqual(['200'])
    const trend = await service.getOrderVolume('local', { category: 'customer', customerId: '200', from: '2025-10-01', to: '2025-10-04', warehouse: 'HZ' })
    expect(trend.total).toBe(2)
    expect(trend.series[0].amounts?.total).toBe(147)
    expect(request.mock.calls.some(call => String(call[1]?.body).includes('"keyword":"Customer"'))).toBe(true)
  })

  it('connects actual freight analysis and single carrier trend, keeping historical conversion and prior periods', async () => {
    const { service, request } = setup()
    const freightData = await service.getFreight('local', { grain: 'month', year: 2025, warehouse: 'ALL' })
    expect(freightData.totals.amount).toBe(9.8)
    const carrier = await service.getFreight('local', { grain: 'year', year: 2025, warehouse: 'HZ', carrierCode: 'YT' })
    expect(carrier.billCount).toBe(1)
    expect(carrier.totals.amount).toBe(9.8)
    const bodies = request.mock.calls.map(call => JSON.parse(String(call[1]?.body)) as { query: Query & { exchangeRateTableId?: string } })
    expect(bodies.some(body => body.query.resource === 'freight' && body.query.from === '2024-12-01' && body.query.exchangeRateTableId === '800')).toBe(true)
  })

  it('returns paginated order, receipt and freight details with complete totals rather than page totals', async () => {
    const { service } = setup()
    const query = { category: 'customer' as const, grain: 'month' as const, year: 2025, warehouse: 'ALL' as const, workbenchRole: 'sales' as const, page: 1, pageSize: 1 }
    const orders = await service.getOrderVolumeDetails('local', query)
    expect(orders.total).toBe(2); expect(orders.items).toHaveLength(1)
    expect(orders.totals.orderCount).toBe(2)
    const receipts = await service.getOrderVolumeReceipts('local', query)
    expect(receipts.total).toBe(2); expect(receipts.items).toHaveLength(1)
    expect(receipts.totals.amount).toBe(147)
    const direct = await service.getReceipts('local', { from: '2025-10-01', to: '2025-10-04', warehouse: 'HZ', sourceType: 'full_payment_stock', workbenchRole: 'sales', page: 1, pageSize: 20 })
    expect(direct.totals.amount).toBe(50)
    const costs = await service.getFreightDetails('local', { grain: 'month', year: 2025, warehouse: 'ALL', workbenchRole: 'sales', page: 1, pageSize: 1, periodId: '2025-10' })
    expect(costs.totals).toEqual({ billCount: 1, amount: 9.8, originalAmounts: [{ currency: 'CNY', amount: 70 }] })
    expect(costs.items[0].fxRateDate).toBe('2025-10-03')
    expect(costs.items[0]).not.toHaveProperty('tenantId')
  })

  it('reads every upstream page without truncating the report and rejects duplicate facts across pages', async () => {
    const data = records(); data.orders = Array.from({ length: 101 }, (_, i) => ({ ...order, id: String(5000 + i) }))
    const { service, request } = setup({ records: data })
    expect((await service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).total).toBe(101)
    expect(request.mock.calls.filter(call => String(call[1]?.body).includes('"resource":"orders"'))).toHaveLength(2)
    const invalid = setup({ transform: (value, query) => ({ ...value, items: [order], hasMore: query.page === 1 }) })
    await expect(invalid.service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_unavailable' } })
  })

  it.each(['receipts', 'freight', 'orders'] as const)('does not infer %s access from another resource', async resource => {
    const { provider, request } = setup({ grants: { [resource]: [] } })
    const permission = await provider.resolvePermissions(identity, scope)
    const calls = request.mock.calls.length
    await expect(provider.readAnalytics(identity, permission, scope, resource, { from: '2025-01-01', to: '2025-12-31' })).rejects.toBeInstanceOf(FopPermissionDeniedError)
    expect(request).toHaveBeenCalledTimes(calls)
  })

  it.each([
    ['identity', (value: Record<string, unknown>) => ({ ...value, subject: { ...identity, userId: '999' } })],
    ['organization', (value: Record<string, unknown>) => ({ ...value, items: [{ ...order, organization: ref('99') }] })],
    ['date', (value: Record<string, unknown>) => ({ ...value, items: [{ ...order, paidAt: '2024-01-01T00:00:00Z' }] })],
    ['pagination', (value: Record<string, unknown>) => ({ ...value, page: 8 })],
  ])('rejects incorrect upstream %s without returning partial totals', async (_name, transform) => {
    const { service } = setup({ transform })
    await expect(service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toThrow()
  })

  it('rejects unmapped dimensions, a wrong historical conversion and scope changes during reads', async () => {
    const missing = setup({ config: { FOP_KINGDEE_WAREHOUSE_MAP: '{}' } })
    await expect(missing.service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_mapping_required' } })
    const data = records(); data.freight = [{ ...freight, amount: '10.00' }]
    const wrong = setup({ records: data })
    await expect(wrong.service.getFreight('local', { grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_unavailable' } })
    const changed = setup()
    changed.users.findById.mockImplementation(async () => ({ ...changed.user, fopUserId: changed.request.mock.calls.some(call => String(call[0]).endsWith('/read')) ? '999' : identity.userId }))
    await expect(changed.service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_binding_changed' } })
  })

  it('does not let extra runtime properties in a range replace trusted identity or organizations', async () => {
    const { provider, request } = setup()
    const permission = await provider.resolvePermissions(identity, scope)
    await provider.readAnalytics(identity, permission, scope, 'orders', Object.assign({ from: '2025-01-01', to: '2025-12-31' }, { userId: '999', organizationIds: ['999'], scopeRole: 'none' }))
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ query: { userId: '100', organizationIds: ['10', '20'], scopeRole: 'admin' } })
  })

  it('fails explicitly for an oversized upstream page instead of returning incomplete totals', async () => {
    const { service } = setup({ transform: value => ({ ...value, extra: 'x'.repeat(4 * 1024 * 1024) }) })
    await expect(service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_result_too_large' } })
  })

  it('reports missing historical rates distinctly and does not retry a business failure', async () => {
    const { provider, request } = setup()
    const permission = await provider.resolvePermissions(identity, scope)
    request.mockResolvedValueOnce(new Response(JSON.stringify({ status: false, errorCode: 'failure', message: 'FOP_FX_MISSING: no historical rate' })))
    await expect(provider.readAnalytics(identity, permission, scope, 'freight', { from: '2025-01-01', to: '2025-12-31' })).rejects.toMatchObject({ code: 'fop_fx_missing' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('refuses a report after its total read budget has expired, even on the final page', async () => {
    const started = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(started)
    try {
      const { service } = setup({ transform: value => { clock.mockReturnValue(started + 60_001); return value } })
      await expect(service.getOrderVolume('local', { category: 'organization', grain: 'month', year: 2025, warehouse: 'ALL' })).rejects.toMatchObject({ response: { code: 'fop_result_too_large' } })
    } finally { clock.mockRestore() }
  })
})

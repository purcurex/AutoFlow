import { FopDataService } from './fop-data.service'
import { FopDataProvider } from './fop-data.types'
import { UsersService } from '../users/users.service'
import { businessDate } from './fop-business-time'

describe('scheme 2 receipt-ledger performance', () => {
  const receipt = (id: string, extra = {}) => ({
    id, tenantId: 'tenant', sourceType: 'full_payment_stock', documentId: `doc-${id}`, documentNumber: `ST-${id}`,
    salesDepartmentCode: 'sales1', department: { id: 'd1', name: '业务一部' }, owner: { id: 'e1', name: 'Alice' },
    customerId: 'c1', customerCode: 'C001', customerName: 'Stock only customer', warehouseCode: 'HZ', warehouse: '杭州仓', carrierCode: null,
    amount: 1000, orderAmount: 1000, handlingFee: 0, currency: 'USD', paidAt: '2026-09-15T00:00:00Z',
    reviewStatus: 'approved', receiptReviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, items: [], ...extra,
  })
  const setup = (records: ReturnType<typeof receipt>[], extraGrant = {}, extraUser = {}) => {
    const user = { id: 'user', businessRole: 'admin', workbenchRoles: ['sales'], fopTenantId: 'tenant', fopUserId: 'fop-user', ...extraUser }
    const provider = {
      source: 'mock', isConfigured: () => true,
      resolvePermissions: async () => ({ subject: { tenantId: 'tenant', userId: 'fop-user' }, allowedOrderIds: [], allowedReceiptIds: records.map(r => r.id), analyticsScopes: ['receipts'], ...extraGrant }),
      listOrders: async () => [], listReceipts: jest.fn(async () => records),
      getAnalytics: async () => ({ subject: { tenantId: 'tenant', userId: 'fop-user' }, rates: [], registrations: [] }),
    }
    return { service: new FopDataService({ findById: async () => user } as unknown as UsersService, provider as unknown as FopDataProvider), provider, user }
  }
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-02T00:00:00Z')) })
  afterEach(() => jest.useRealTimers())
  const query = { from: '2026-09-01', to: '2026-11-01', year: 2026 }

  it('counts full-payment stock in payment month and only new fulfillment collections later', async () => {
    const { service } = setup([
      receipt('stock'), receipt('oct', { sourceType: 'fulfillment', amount: 60, orderAmount: 60, carrierCode: 'YT', paidAt: '2026-10-10T00:00:00Z' }),
      receipt('deposit', { sourceType: 'deposit_stock', amount: 9000 }), receipt('pending', { reviewStatus: 'pending', amount: 9000 }),
    ])
    const dashboard = await service.getDashboard('user', query)
    expect(dashboard.receipts.marketingCenter?.amounts.slice(8, 10)).toEqual([1000, 60])
    expect(dashboard.receipts.departments[0].salespeople[0].amounts.slice(8, 10)).toEqual([1000, 60])
  })
  it('uses UTC+8 payment month, including previous December and both approval gates', async () => {
    const { service } = setup([receipt('boundary', { paidAt: '2026-09-30T16:00:00Z' }), receipt('dec', { paidAt: '2025-12-30T00:00:00Z', amount: 50 }), receipt('unapproved', { receiptReviewStatus: 'pending' })])
    const data = await service.getDashboard('user', query)
    expect(data.receipts.marketingCenter?.amounts[9]).toBe(1000)
    expect(data.receipts.marketingCenter?.amounts[8]).toBe(0)
    expect(data.receipts.marketingCenter?.previousAmount).toBe(50)
  })
  it('includes stock-only customers without increasing fulfillment order count', async () => {
    const { service } = setup([receipt('stock')])
    const data = await service.getOrderVolume('user', { category: 'customer', from: '2026-09-01', to: '2026-09-30', warehouse: 'ALL' })
    expect(data.total).toBe(0)
    expect(data.series[0].amounts?.total).toBe(1000)
    expect(data.customerCount).toBe(1)
    expect(data.series.map(s => s.id)).toEqual(['total', 'other'])
    expect(data.series.find(s => s.id === 'other')?.amounts?.total).toBe(1000)
    const selected = await service.getOrderVolume('user', { category: 'customer', customerId: 'c1', from: '2026-09-01', to: '2026-09-30', warehouse: 'ALL' })
    expect(selected.series.map(s => s.id)).toEqual(['total', 'customer:c1'])
    expect((await service.searchOrderCustomers('user', { keyword: 'C001', page: 1, pageSize: 10 })).items[0]?.id).toBe('c1')
  })
  it('intersects receipt allowlist, tenant and employee scope', async () => {
    const allowed = receipt('allowed')
    const { service } = setup([allowed, receipt('other-owner', { owner: { id: 'e2', name: 'Other' } }), receipt('tenant-leak', { tenantId: 'elsewhere' }), receipt('not-granted')], { allowedReceiptIds: ['allowed', 'other-owner', 'tenant-leak'] }, { businessRole: 'salesperson', businessEmployeeId: 'e1' })
    expect((await service.getDashboard('user', query)).receipts.marketingCenter?.amounts[8]).toBe(1000)
  })
  it('rejects duplicate authorized receipt IDs rather than picking an arbitrary amount', async () => {
    const { service } = setup([receipt('duplicate'), receipt('duplicate', { amount: 2000 })])
    await expect(service.getDashboard('user', query)).rejects.toMatchObject({ status: 503 })
  })
  it('does not treat an order grant as a receipt grant', async () => {
    const { service, provider } = setup([receipt('stock')], { allowedReceiptIds: undefined })
    expect((await service.getDashboard('user', query)).receipts.marketingCenter?.amounts[8]).toBe(0)
    expect(provider.listReceipts).not.toHaveBeenCalled()
  })
  it('counts distinct payment lines for the same document once each and preserves all-page source totals', async () => {
    const { service } = setup([receipt('line1', { documentId: 'same', amount: 400 }), receipt('line2', { documentId: 'same', amount: 600 })])
    const page = await service.getReceipts('user', { from: '2026-09-01', to: '2026-09-30', warehouse: 'HZ', workbenchRole: 'sales', page: 2, pageSize: 1 })
    expect(page.total).toBe(2)
    expect(page.items).toHaveLength(1)
    expect(page.totals).toMatchObject({ receiptCount: 2, amount: 1000, fulfillmentAmount: 0, fullPaymentStockAmount: 1000 })
    expect(page.items[0]).not.toHaveProperty('tenantId')
    expect(page.items[0]).not.toHaveProperty('departmentPathIds')
  })
  it('rejects incomplete approved fulfillment logistics instead of counting it as Other', async () => {
    const { service } = setup([receipt('bad', { sourceType: 'fulfillment', carrierCode: null })])
    await expect(service.getDashboard('user', query)).rejects.toMatchObject({ status: 503 })
  })
  it.each([
    { owner: { id: 'e1', name: { privateMetadata: 'must-not-leak' } } },
    { department: { id: 'd1', name: 42 } },
    { organization: { id: 'org', name: { privateMetadata: 'must-not-leak' } } },
    { customerCode: { privateMetadata: 'must-not-leak' } },
    { items: [{ sku: 'SKU', name: 'Product', variant: '', quantity: 1, imageUrl: null, productId: { privateMetadata: 'must-not-leak' } }] },
  ])('rejects malformed authorized reference fields without returning nested provider payloads: %j', async extra => {
    const { service } = setup([receipt('bad-reference', extra)])
    await expect(service.getDashboard('user', query)).rejects.toMatchObject({ status: 503 })
  })
  it('keeps source/warehouse receipt drill totals equal to customer amounts and rejects future date ranges', async () => {
    const { service } = setup([receipt('hz'), receipt('sz', { warehouseCode: 'SZ', warehouse: '深圳仓', amount: 20 })])
    const filters = { category: 'customer' as const, from: '2026-09-01', to: '2026-09-30', warehouse: 'ALL' as const }
    const data = await service.getOrderVolume('user', filters)
    expect(data.series[0].amounts?.total).toBe(1020)
    const page = await service.getOrderVolumeReceipts('user', { ...filters, detailWarehouse: 'SZ', seriesId: 'other', workbenchRole: 'sales', page: 1, pageSize: 20 })
    expect(page.totals.amount).toBe(20)
    await expect(service.getReceipts('user', { from: '2026-11-01', to: '2026-11-30', warehouse: 'ALL', workbenchRole: 'sales', page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 400 })
  })
  it('rejects invalid calendar timestamps and does not default timezone-less data to the machine timezone', () => {
    expect(businessDate('2026-02-30T12:00:00Z')).toBe('')
    expect(businessDate('2026-10-01T12:00:00')).toBe('')
    expect(businessDate('2026-09-30T16:00:00Z')).toBe('2026-10-01')
  })
})

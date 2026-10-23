import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopIdentity, FopOrderCandidate, FopReceiptCandidate } from './fop-data.types'
import { UsersService } from '../users/users.service'
const period = { from: '2026-01-01', to: '2026-01-31', year: 2026 }
const volume = { category: 'customer' as const, grain: 'month' as const, year: 2026, warehouse: 'ALL' as const }
const override = (chartId: string, values = {}) => ({ chartId, visibility: 'inherit', dataScope: 'inherit', summaryMode: 'inherit', summaryDepartments: [], details: 'inherit', export: 'inherit', ...values })
const order = (owner: string, index: number): FopOrderCandidate => ({
  tenantId: 't', id: `${owner}-${index}`, orderNumber: `${owner}-${index}`, shopifyOrderNumber: `#${index}`, customerId: `${owner}-customer-${index}`, customerCode: `${owner}-${index}`, customerName: `${owner} customer ${index}`, storeName: 'Store', items: [],
  organization: { id: 'org', name: 'Org' }, department: { id: owner === 'carol' ? 'd2' : 'd1', name: 'Department' }, departmentPathIds: [owner === 'carol' ? 'd2' : 'd1'], owner: { id: owner, name: owner }, salesDepartmentCode: owner === 'carol' ? 'sales2' : 'sales1',
  amount: 10, currency: 'USD', paymentStatus: 'paid', reviewStatus: 'approved', procurementStatus: 'purchased', allocationStatus: 'allocated', dispatchStatus: 'dispatched', shippingStatus: 'shipped', warehouse: '杭州仓', warehouseCode: 'HZ', carrier: '云途', carrierCode: 'YT', trackingNumber: 'TRACK', salesperson: owner, createdAt: '2026-01-10T08:00:00+08:00', paidAt: '2026-01-10T08:00:00+08:00', cancelled: false, exception: null,
})
const receipt = (o: FopOrderCandidate): FopReceiptCandidate => ({
  tenantId: 't', id: `receipt-${o.id}`, sourceType: 'fulfillment', documentId: o.id, documentNumber: o.orderNumber, customerId: o.customerId!, customerCode: o.customerCode!, customerName: o.customerName, department: o.department, departmentPathIds: o.departmentPathIds, owner: o.owner, salesDepartmentCode: o.salesDepartmentCode, warehouseCode: 'HZ', warehouse: '杭州仓', carrierCode: 'YT', amount: 8, orderAmount: 10, handlingFee: 2, currency: 'USD', paidAt: o.paidAt, reviewStatus: 'approved', receiptReviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, items: [],
})
function setup(changes: object = {}) {
  const account: any = { role: 'user', businessRole: 'department_manager', businessEmployeeId: 'alice', businessDepartmentId: 'd1', fopTenantId: 't', fopUserId: 'fop', workbenchRoles: ['sales'], chartPermissions: [], ...changes }
  const orders = ['alice', 'bob', 'carol'].flatMap(owner => Array.from({ length: 12 }, (_, i) => order(owner, i)))
  const receipts = orders.map(receipt)
  const grant: any = { subject: { tenantId: 't', userId: 'fop' }, allowedOrderIds: orders.map(o => o.id), allowedReceiptIds: receipts.map(r => r.id), analyticsScopes: ['registrations', 'receipts'], organizationSummaries: ['registrations', 'department_receipts', 'order_volume'].map(chartId => ({ chartId, departments: [{ code: 'sales1', departmentId: 'd1', departmentPathIds: ['d1', 'org'] }, { code: 'sales2', departmentId: 'd2', departmentPathIds: ['d2', 'org'] }] })) }
  class Provider extends FopDataProvider {
    readonly customerOwnershipMode = 'legacy_historical' as const
    isConfigured() { return true }
    async resolvePermissions() { return structuredClone(grant) }
    async listOrders() { return orders }
    async listReceipts() { return receipts }
    async getAnalytics(subject: FopIdentity) { return { subject, rates: [], registrations: [], registrationEntries: orders.map((o, i) => ({ date: `2026-01-${String(i % 12 + 1).padStart(2, '0')}`, salesDepartmentCode: o.salesDepartmentCode!, departmentPathIds: o.departmentPathIds, owner: o.owner!, count: 1 })) } }
    async getOrganizationSummary(subject: FopIdentity, _permission: any, query: any): Promise<any> { return { subject, chartId: query.chartId, rows: ['sales1', 'sales2'].map(salesDepartmentCode => ({ date: '2026-01-10', salesDepartmentCode, count: 24, ...(query.chartId === 'department_receipts' ? { amount: 192, currency: 'USD', sourceType: 'fulfillment' } : {}), ...(query.chartId === 'order_volume' ? { warehouseCode: 'HZ' } : {}), owner: { id: 'secret', name: 'secret' }, customerId: 'secret' })) } }
  }
  const provider = new Provider()
  const service = new FopDataService({ findById: async () => structuredClone(account) } as unknown as UsersService, provider)
  return { service, provider, account, orders, receipts, grant }
}
describe('chart authorization and scoped analytics', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-03-15T04:00:00Z')))
  afterEach(() => jest.useRealTimers())
  it('denies direct chart, customer search and detail routes independently of record grants', async () => {
    const { service } = setup({ chartPermissions: [override('customer_orders', { visibility: 'deny' })] })
    await expect(service.getOrderVolume('u', volume)).rejects.toMatchObject({ status: 403 })
    await expect(service.searchOrderCustomers('u', { keyword: 'customer', page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 403 })
    await expect(service.getOrderVolumeDetails('u', { ...volume, workbenchRole: 'sales', page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 403 })
  })
  it('filters self before ranking Top10, other, amount totals, search and detail pagination', async () => {
    const { service } = setup({ chartPermissions: [override('customer_orders', { dataScope: 'self' })] })
    const data = await service.getOrderVolume('u', volume)
    expect(data.total).toBe(12)
    expect(data.series.find(s => s.id === 'total')?.amounts?.total).toBe(96)
    expect(data.series.filter(s => s.kind === 'detail')).toHaveLength(10)
    expect(data.series.find(s => s.id === 'other')?.total).toBe(2)
    expect(data.series.filter(s => s.kind === 'detail').every(s => s.entityId?.startsWith('alice-'))).toBe(true)
    expect((await service.searchOrderCustomers('u', { keyword: 'bob', page: 1, pageSize: 10 })).total).toBe(0)
    expect((await service.getOrderVolumeDetails('u', { ...volume, seriesId: 'other', workbenchRole: 'sales', page: 1, pageSize: 10 })).items.every(o => o.owner?.id === 'alice')).toBe(true)
  })
  it('denies details without disabling summary and refuses another chart as receipt origin', async () => {
    const { service } = setup({ chartPermissions: [override('customer_orders', { details: 'deny' }), override('salesperson_receipts', { details: 'deny' })] })
    expect((await service.getOrderVolume('u', volume)).total).toBe(24)
    await expect(service.getOrderVolumeReceipts('u', { ...volume, workbenchRole: 'sales', page: 1, pageSize: 10 })).rejects.toMatchObject({ status: 403 })
    await expect(service.getReceipts('u', { ...period, chartId: 'department_receipts', warehouse: 'ALL', workbenchRole: 'sales', page: 1, pageSize: 10 } as any)).rejects.toMatchObject({ status: 403 })
  })
  it('omits denied dashboard chart data while keeping independently authorized charts', async () => {
    const { service } = setup({ chartPermissions: [override('registrations', { visibility: 'deny' }), override('salesperson_receipts', { visibility: 'deny' }), override('department_receipts', { visibility: 'deny' })] })
    const dashboard = await service.getDashboard('u', period)
    expect(dashboard.registrations).toEqual([]); expect(dashboard.registrationDepartments).toEqual([])
    expect(dashboard.receipts.months).toEqual([]); expect((dashboard as any).departmentReceipts.months).toEqual([])
  })
  it('uses independent summary grants without domain enumeration or member disclosure', async () => {
    const { service, provider, grant } = setup({ businessRole: 'salesperson', chartPermissions: [override('department_receipts', { visibility: 'allow', summaryMode: 'selected', summaryDepartments: ['sales2'] }), override('registrations', { summaryMode: 'selected', summaryDepartments: ['sales2'] }), override('order_volume', { summaryMode: 'selected', summaryDepartments: ['sales2'] })] })
    grant.allowedOrderIds = []; grant.allowedReceiptIds = []
    provider.listOrders = async () => { throw new Error('No domain rows for summary') }; provider.listReceipts = async () => { throw new Error('No domain rows for summary') }
    const summary = (await service.getDashboard('u', period) as any).departmentReceipts
    expect(summary.departments.map((d: any) => d.id)).toEqual(['sales2'])
    expect(summary.departments[0]).toMatchObject({ salespeople: [], amounts: [192, 0, 0] })
    expect(JSON.stringify(summary)).not.toContain('secret')
    const organizational = await service.getOrderVolume('u', { ...volume, category: 'organization', view: 'summary' } as any)
    expect(organizational).toMatchObject({ total: 24, customerCount: null, options: { objects: [] }, summaryOnly: true })
    await expect(service.getOrderVolumeDetails('u', { ...volume, category: 'organization', view: 'summary', workbenchRole: 'sales', page: 1, pageSize: 10 } as any)).rejects.toMatchObject({ status: 403 })
  })
  it('resolves manager summary departments using independent FOP ancestry and missing grants fail closed', async () => {
    const { service, grant } = setup()
    let access = await (service as any).getChartAccess('u')
    expect(access.charts.find((c: any) => c.chartId === 'department_receipts')).toMatchObject({ visible: true, summaryOnly: true, summaryDepartments: ['sales1'], dataScope: 'none', canViewDetails: false })
    grant.organizationSummaries = []; access = await (service as any).getChartAccess('u')
    expect(access.charts.find((c: any) => c.chartId === 'department_receipts')).toMatchObject({ visible: false, summaryDepartments: [] })
    expect(JSON.stringify(access)).not.toContain('allowedOrderIds')
  })
  it('rejects responses when chart permissions change during provider loading', async () => {
    const { service, provider, account, orders } = setup()
    provider.listOrders = async () => { account.chartPermissions = [override('customer_orders', { visibility: 'deny' })]; return orders }
    await expect(service.getOrderVolume('u', volume)).rejects.toMatchObject({ status: 403, response: { code: 'fop_binding_changed' } })
  })
  it('separates current assignment from historical owner without broadening transferred customer history', async () => {
    const { service, orders, receipts, account } = setup({ businessRole: 'salesperson' })
    for (const row of [...orders, ...receipts]) Object.assign(row, { currentCustomerOwner: { id: 'bob', departmentId: 'd1', departmentPathIds: ['d1'] } })
    expect((await service.getOrderVolume('u', volume)).total).toBe(0)
    account.businessEmployeeId = 'bob'
    const bob = await service.getOrderVolume('u', volume)
    expect(bob.total).toBe(12)
    expect(bob.series.filter(s => s.kind === 'detail').every(s => s.entityId?.startsWith('bob-'))).toBe(true)
    expect(bob).toMatchObject({ customerOwnershipBasis: 'current_assignment' })
    // Customer assignment does not rewrite receipt performance ownership.
    account.businessEmployeeId = 'alice'
    const dashboard = await service.getDashboard('u', period)
    expect(dashboard.receipts.departments[0].salespeople[0].id).toBe('alice')
    expect(dashboard.receipts.departments[0].amounts[0]).toBe(96)
  })
  it('labels legacy attribution and rejects conflicting current assignments for one customer', async () => {
    const { service, orders, receipts } = setup()
    expect(await service.getOrderVolume('u', volume)).toMatchObject({ customerOwnershipBasis: 'historical_attribution' })
    Object.assign(orders[0], { currentCustomerOwner: { id: 'alice', departmentId: 'd1' } })
    Object.assign(receipts[0], { currentCustomerOwner: { id: 'bob', departmentId: 'd1' } })
    await expect(service.getOrderVolume('u', volume)).rejects.toMatchObject({ status: 503 })
  })
  it('keeps manager personal performance unselected without a bound employee', async () => {
    const { service, grant } = setup({ businessEmployeeId: null })
    grant.analyticsScopes.push('sales_profit'); grant.allowedProfitIds = []
    expect(await service.getSalesPerformance('u', { from: period.from, to: period.to, grain: 'month' })).toMatchObject({ selectedOwner: null, canSelectOwner: true, totals: { collectionsAmount: 0 } })
    expect(await service.getSalesPerformance('u', { from: period.from, to: period.to, grain: 'month', ownerId: 'bob' })).toMatchObject({ selectedOwner: { id: 'bob' }, totals: { collectionsAmount: 96 } })
  })

  it('fails closed before a malformed registration ancestry can mimic a manager department', async () => {
    const { service, provider, grant } = setup()
    grant.organizationSummaries = []
    provider.getAnalytics = async subject => ({ subject, rates: [], registrations: [], registrationEntries: [{ date: '2026-01-10', salesDepartmentCode: 'sales1', owner: { id: 'foreign', name: 'Foreign' }, count: 999, departmentPathIds: 'd10' as any }] })
    await expect(service.getDashboard('u', period)).rejects.toMatchObject({ status: 503 })
  })
  it('reports a granted but unconfigured independent organization summary provider explicitly', async () => {
    const { service, provider } = setup()
    provider.getOrganizationSummary = FopDataProvider.prototype.getOrganizationSummary
    await expect(service.getOrderVolume('u', { ...volume, category: 'organization', view: 'summary' })).rejects.toMatchObject({ status: 503, response: { code: 'fop_summary_not_configured' } })
  })

  it('requires current customer assignment for new adapters instead of silently using historical attribution', async () => {
    const { service, provider } = setup()
    Object.defineProperty(provider, 'customerOwnershipMode', { value: 'current_required' })
    await expect(service.getOrderVolume('u', volume)).rejects.toMatchObject({ status: 503 })
  })
  it('rejects duplicate aggregate facts even when unrelated provider fields differ', async () => {
    const { service, provider } = setup()
    provider.getOrganizationSummary = async (subject, _grant, query) => ({ subject, chartId: query.chartId, rows: [
      { date: '2026-01-10', salesDepartmentCode: 'sales1', count: 1, amount: 10, currency: 'USD', sourceType: 'fulfillment', warehouseCode: 'HZ' },
      { date: '2026-01-10', salesDepartmentCode: 'sales1', count: 1, amount: 10, currency: 'USD', sourceType: 'fulfillment', warehouseCode: 'SZ' },
    ] })
    await expect(service.getDashboard('u', period)).rejects.toMatchObject({ status: 503 })
  })

  it('does not advertise chart overrides as a substitute for required workbench jobs', async () => {
    const { service, grant, account } = setup({ workbenchRoles: [], chartPermissions: [override('customer_orders', { visibility: 'allow' }), override('sales_performance', { visibility: 'allow' })] })
    grant.analyticsScopes.push('sales_profit')
    expect((await service.getChartAccess('u')).charts.every(c => !c.visible)).toBe(true)
    account.workbenchRoles = ['dispatch']
    expect((await service.getChartAccess('u')).charts.find(c => c.chartId === 'sales_performance')?.visible).toBe(false)
  })

})

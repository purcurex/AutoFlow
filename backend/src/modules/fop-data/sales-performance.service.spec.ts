import { FopDataService } from './fop-data.service'
import { FopDataProvider, FopReceiptCandidate } from './fop-data.types'
import { FopProfitCandidate, PerformanceQuery } from './sales-performance.types'
import { UsersService } from '../users/users.service'
const query: PerformanceQuery = { from: '2026-01-01', to: '2026-01-31', grain: 'month' }
const profit = (id = 'p1', extra: Partial<FopProfitCandidate> = {}): FopProfitCandidate => ({
  tenantId: 't1', departmentPathIds: ['d1', 'sales'], id, orderId: id, orderNumber: `SO-${id}`, customerCode: 'C1', customerName: 'Customer', owner: { id: 'alice', name: 'Alice' }, department: { id: 'd1', name: 'Sales' }, salesDepartmentCode: 'sales1',
  recognitionMonth: '2026-01', recognitionDate: '2026-01-10', knownAt: '2026-01-11T08:00:00+08:00', status: 'estimated', settlementId: null, version: 'v1', approvedAt: null, cutoffAt: '2026-01-10T23:59:59+08:00', freightBasis: 'estimated',
  incomeAmount: 100, adjustmentIncome: 0, productCost: 30, freightCost: 10, refundCost: 0, returnCost: 0, otherCost: 0, previousRecognizedProfit: 0, roundingAdjustment: 0,
  amount: 60, currency: 'USD', originalAmount: 60, originalCurrency: 'USD', fxRateToUsd: 1, fxRateDate: '2026-01-10', fxRateSource: 'fixture', ...extra,
})
const receipt = (id = 'r1', extra: Partial<FopReceiptCandidate> = {}): FopReceiptCandidate => ({ tenantId: 't1', departmentPathIds: ['d1', 'sales'], id, sourceType: 'fulfillment', documentId: 'so1', documentNumber: 'SO1', customerId: 'c1', customerCode: 'C1', customerName: 'Customer', owner: { id: 'alice', name: 'Alice' }, department: { id: 'd1', name: 'Sales' }, salesDepartmentCode: 'sales1', warehouseCode: 'HZ', warehouse: '杭州仓', carrierCode: 'YT', amount: 80, orderAmount: 100, handlingFee: 20, currency: 'USD', paidAt: '2026-01-10T00:00:00Z', reviewStatus: 'approved', receiptReviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, items: [], ...extra })
function setup(options: { profits?: FopProfitCandidate[]; receipts?: FopReceiptCandidate[]; account?: object; grant?: object } = {}) {
  const account = { businessRole: 'salesperson', businessEmployeeId: 'alice', businessDepartmentId: 'd1', workbenchRoles: ['sales'], fopTenantId: 't1', fopUserId: 'u1', role: 'user', ...options.account }
  const rows = options.profits ?? [profit()], receipts = options.receipts ?? [receipt()]
  const provider = { isConfigured: () => true, resolvePermissions: async (subject: any) => ({ subject, allowedOrderIds: [], allowedProfitIds: rows.map(r => r.id), allowedReceiptIds: receipts.map(r => r.id), analyticsScopes: ['receipts', 'sales_profit'], ...options.grant }), listOrders: async () => { throw new Error('Sales performance must never enumerate orders') }, listProfits: async () => rows, listReceipts: async () => receipts } as unknown as FopDataProvider
  const service = new FopDataService({ findById: async () => structuredClone(account) } as unknown as UsersService, provider)
  return { service, provider, account }
}
describe('independently authorized sales performance', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-03-15T04:00:00Z')))
  afterEach(() => jest.useRealTimers())
  it('uses receipts and profit grants without loading orders and whitelists every detail field', async () => {
    const { service } = setup({ profits: [{ ...profit(), secret: 'hidden' } as FopProfitCandidate] })
    const summary = await service.getSalesPerformance('u', query)
    expect(summary).toMatchObject({ selectedOwner: { id: 'alice' }, canSelectOwner: false, totals: { collectionsAmount: 80, estimatedGrossProfit: 60 } })
    const details = await service.getSalesPerformanceDetails('u', { ...query, kind: 'profit', page: 1, pageSize: 20 })
    expect(details.totals).toEqual(summary.totals)
    expect(details.profits[0]).not.toHaveProperty('tenantId'); expect(details.profits[0]).not.toHaveProperty('departmentPathIds'); expect(details.profits[0]).not.toHaveProperty('secret')
  })
  it.each([{ analyticsScopes: ['receipts'] }, { analyticsScopes: ['sales_profit'] }, { allowedProfitIds: [''] }, { analyticsScopes: ['unknown'] }])('denies missing or malformed independent grants %j', async grant => {
    await expect(setup({ grant }).service.getSalesPerformance('u', query)).rejects.toMatchObject({ status: 403 })
  })
  it('does not let receipt adapter mutation broaden the subsequent profit grant', async () => {
    const { service, provider } = setup({ profits: [profit(), profit('p2')], grant: { allowedProfitIds: ['p1'] } })
    provider.listReceipts = async (_identity, grant) => {
      try { (grant.allowedProfitIds as string[]).push('p2') } catch { /* readonly provider contract */ }
      return [receipt()]
    }
    expect((await service.getSalesPerformance('u', query)).totals.estimatedGrossProfit).toBe(60)
  })
  it('never infers profit resources from receipts when the profit allowlist is absent', async () => {
    const { service, provider } = setup({ grant: { allowedProfitIds: undefined } })
    provider.listProfits = async () => { throw new Error('Missing IDs must not enumerate profit') }
    expect((await service.getSalesPerformance('u', query)).totals).toMatchObject({ collectionsAmount: 80, profitCount: 0, estimatedGrossProfit: 0 })
  })
  it('does not expose an owner from a future economic event even if the provider already knows the plan', async () => {
    const { service } = setup({ account: { businessRole: 'admin' }, profits: [profit(), profit('future', { owner: { id: 'future-owner', name: 'Private future owner' }, recognitionMonth: '2026-04', recognitionDate: '2026-04-01', cutoffAt: '2026-05-01T00:00:00+08:00' })] })
    expect((await service.getSalesPerformance('u', query)).owners.map(row => row.id)).toEqual(['alice'])
    await expect(service.getSalesPerformance('u', { ...query, ownerId: 'future-owner' })).rejects.toMatchObject({ status: 403 })
  })
  it('excludes future FX facts from selectable owners and their totals', async () => {
    const { service } = setup({ account: { businessRole: 'admin' }, profits: [profit(), profit('fx', { owner: { id: 'future-fx', name: 'Future FX owner' }, fxRateDate: '2026-04-01' })] })
    const summary = await service.getSalesPerformance('u', query)
    expect(summary.owners.map(row => row.id)).toEqual(['alice'])
    expect(summary.totals.estimatedGrossProfit).toBe(60)
    await expect(service.getSalesPerformance('u', { ...query, ownerId: 'future-fx' })).rejects.toMatchObject({ status: 403 })
  })
  it('keeps empty resource allowlists empty even for business administrators', async () => {
    const { service, provider } = setup({ account: { businessRole: 'admin' }, grant: { allowedProfitIds: [], allowedReceiptIds: [] } })
    provider.listReceipts = async () => { throw new Error('Must not enumerate empty allowlist') }
    ;(provider as any).listProfits = async () => { throw new Error('Must not enumerate empty allowlist') }
    expect(await service.getSalesPerformance('u', query)).toMatchObject({ owners: [], selectedOwner: null, totals: { receiptCount: 0, profitCount: 0 } })
    await expect(service.getSalesPerformance('u', { ...query, ownerId: 'other' })).rejects.toMatchObject({ status: 403 })
  })
  it.each([{ workbenchRoles: ['dispatch'] }, { role: 'admin', businessRole: 'none' }, { businessEmployeeId: null }])('requires sales workbench and business identity %j', async account => await expect(setup({ account }).service.getSalesPerformance('u', query)).rejects.toMatchObject({ status: 403 }))
  it('intersects tenant, allowlist and business owner before validating or enumerating owners', async () => {
    const { service } = setup({ profits: [profit(), profit('other', { owner: { id: 'bob', name: 'Private' }, amount: NaN }), profit('foreign', { tenantId: 't2', amount: NaN }), profit('outside', { amount: NaN })], grant: { allowedProfitIds: ['p1', 'other', 'foreign'] } })
    const result = await service.getSalesPerformance('u', query)
    expect(result.owners.map((p: any) => p.id)).toEqual(['alice']); expect(result.totals.estimatedGrossProfit).toBe(60)
    await expect(service.getSalesPerformance('u', { ...query, ownerId: 'bob' })).rejects.toMatchObject({ status: 403 })
  })
  it('suppresses an old estimate before owner selection when the authorized settlement freezes another owner', async () => {
    const frozen = profit('frozen', { orderId: 'same-order', status: 'settled', settlementId: 'bill', version: 'settled1', freightBasis: 'frozen', approvedAt: '2026-02-02T00:00:00Z', knownAt: '2026-02-02T00:00:00Z' })
    const estimated = profit('estimate', { orderId: 'same-order', owner: { id: 'bob', name: 'Bob' } })
    const { service } = setup({ account: { businessRole: 'admin' }, profits: [frozen, estimated], receipts: [receipt('bob-receipt', { owner: { id: 'bob', name: 'Bob' } })] })
    expect((await service.getSalesPerformance('u', { ...query, ownerId: 'bob' })).totals).toMatchObject({ collectionsAmount: 80, estimatedGrossProfit: 0, settledGrossProfit: 0 })
    expect((await service.getSalesPerformance('u', { ...query, ownerId: 'alice' })).totals.settledGrossProfit).toBe(60)
  })
  it('lets managers select only authorized department owners, defaulting to their binding and never silently selecting a colleague', async () => {
    const rows = [profit('a'), profit('b', { owner: { id: 'bob', name: 'Bob' } }), profit('outside', { department: { id: 'd2', name: 'Private' }, departmentPathIds: ['d2'] })]
    const { service, account } = setup({ profits: rows, account: { businessRole: 'department_manager', businessDepartmentId: 'sales', businessEmployeeId: 'bob' } })
    expect(await service.getSalesPerformance('u', query)).toMatchObject({ canSelectOwner: true, selectedOwner: { id: 'bob' }, totals: { collectionsAmount: 0, estimatedGrossProfit: 60 } })
    expect((await service.getSalesPerformance('u', { ...query, ownerId: 'alice' })).totals.collectionsAmount).toBe(80)
    account.businessEmployeeId = 'not-present'
    expect((await service.getSalesPerformance('u', query)).selectedOwner).toBeNull()
    await expect(service.getSalesPerformance('u', { ...query, ownerId: 'not-present' })).rejects.toMatchObject({ status: 403 })
  })
  it.each(['profit', 'receipt'])('rejects duplicate or malformed authorized %s ancestry before scope matching', async kind => {
    const options = kind === 'profit' ? { profits: [profit('bad', { departmentPathIds: 'sales' as any })] } : { receipts: [receipt('bad', { departmentPathIds: 'sales' as any })] }
    await expect(setup(options).service.getSalesPerformance('u', query)).rejects.toMatchObject({ status: 503 })
    const duplicate = kind === 'profit' ? { profits: [profit(), profit()] } : { receipts: [receipt(), receipt()] }
    await expect(setup(duplicate).service.getSalesPerformance('u', query)).rejects.toMatchObject({ status: 503 })
  })
  it.each(['binding', 'employee', 'role'])('discards results after %s changes while provider is loading', async field => {
    const { service, provider, account } = setup()
    ;(provider as any).listProfits = async () => { if (field === 'binding') account.fopUserId = 'replacement'; if (field === 'employee') account.businessEmployeeId = 'bob'; if (field === 'role') account.workbenchRoles = []; return [profit()] }
    await expect(service.getSalesPerformance('u', query)).rejects.toMatchObject({ status: 403, response: { code: 'fop_binding_changed' } })
  })
  it('sanitizes provider diagnostics and validates date filters before data work', async () => {
    const { service, provider } = setup()
    ;(provider as any).listProfits = async () => { throw new Error('secret source diagnostics') }
    await expect(service.getSalesPerformance('u', query)).rejects.toMatchObject({ status: 503, response: { code: 'fop_unavailable' } })
    await expect(service.getSalesPerformance('u', { ...query, to: '2026-02-30' })).rejects.toMatchObject({ status: 400 })
  })
})

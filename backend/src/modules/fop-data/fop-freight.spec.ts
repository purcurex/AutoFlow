import { aggregateFreight, freightDetails, publicFreight } from './fop-freight'
import { FopDataService } from './fop-data.service'
import { UsersService } from '../users/users.service'
import { FopDataProvider } from './fop-data.types'
import { FopFreightCandidate, FreightQuery } from './fop-freight.types'

const row = (id: string, extra: Partial<FopFreightCandidate> = {}): FopFreightCandidate => ({
  id, tenantId: 'tenant', documentNumber: `DL-${id}`, orderNumber: `SO-${id}`, trackingNumber: `YT-${id}`,
  carrierCode: 'YT', carrierName: '云途', channelName: '标准专线', warehouseCode: 'HZ', warehouse: '杭州仓',
  customerId: 'c1', customerCode: 'C001', customerName: 'Customer', department: { id: 'd1', name: '业务一部' }, owner: { id: 'e1', name: 'Ruth' },
  originalAmount: 700, originalCurrency: 'CNY', fxRateToUsd: 1 / 7, fxRateDate: '2026-01-01', fxRateSource: 'fixture', amount: 100, currency: 'USD',
  confirmedAt: '2026-01-15T01:00:00Z', reviewStatus: 'approved', costStatus: 'confirmed', ...extra,
})
const query: FreightQuery = { grain: 'month', year: 2026, warehouse: 'ALL' }
const now = new Date('2026-10-22T04:00:00Z')

describe('actual confirmed carrier freight', () => {
  it('uses original currency with explicit FX and strips unreviewed provider metadata', () => {
    const value = publicFreight({ ...row('a'), secret: 'private', owner: { id: 'e1', name: 'Ruth', secret: 'private' } } as FopFreightCandidate)
    expect(value.amount).toBe(100)
    expect(value).not.toHaveProperty('tenantId')
    expect(value).not.toHaveProperty('secret')
    expect(value.owner).toEqual({ id: 'e1', name: 'Ruth' })
  })
  it('rounds exact decimal currency products HALF_UP instead of rounding a binary intermediate', () => {
    expect(publicFreight(row('half-cent', { originalAmount: 1.5, fxRateToUsd: 0.15, amount: 0.23 })).amount).toBe(0.23)
    expect(() => publicFreight(row('wrong-rounding', { originalAmount: 1.5, fxRateToUsd: 0.15, amount: 0.22 }))).toThrow()
  })
  it.each([
    { originalCurrency: '' }, { fxRateToUsd: 0 }, { amount: 99 }, { amount: Infinity },
    { confirmedAt: '2026-02-30T00:00:00Z' }, { confirmedAt: '2026-01-01T00:00:00' },
    { carrierCode: 'UNKNOWN' }, { warehouseCode: '' }, { fxRateDate: '2026-02-30' },
    { customerName: { secret: true } }, { owner: { id: 'e1', name: {} } },
  ])('rejects unusable authorized cost snapshots: %j', bad => {
    expect(() => publicFreight({ ...row('a'), ...bad } as FopFreightCandidate)).toThrow()
  })
  it('groups UTC+8 cross-year confirmation and uses prior December as January baseline', () => {
    const data = aggregateFreight([row('dec', { amount: 50, originalAmount: 350, confirmedAt: '2025-12-15T00:00:00Z' }), row('jan', { confirmedAt: '2025-12-31T16:00:00Z' })], query, now)
    expect(data.periods).toHaveLength(10)
    expect(data.periods[9].partial).toBe(true)
    expect(data.series.map(s => s.id)).toEqual(['total', 'carrier:YT', 'carrier:4PX', 'carrier:WB', 'carrier:YW', 'carrier:JS', 'carrier:OTHER'])
    expect(data.series[0].values[0]).toEqual({ amount: 100, previousAmount: 50, delta: 50, percent: 100 })
    expect(data.totals.amount).toBe(100)
  })
  it('does not infer free cost from pending/zero costs or count unapproved and future facts', () => {
    const data = aggregateFreight([row('good'), row('pending', { costStatus: 'pending', amount: 0, originalAmount: 0, confirmedAt: null }), row('review', { reviewStatus: 'pending' }), row('future', { confirmedAt: '2026-10-23T00:00:00Z' })], query, now)
    expect(data.totals.amount).toBe(100)
    expect(data.billCount).toBe(1)
    expect(data.series[0].values[0].percent).toBeNull()
    expect(data.series[0].values[2].percent).toBe(0)
  })
  it('uses four Monday weeks including cross-year baselines and five year buckets', () => {
    const weeks = aggregateFreight([], { grain: 'week', year: 2026, weekOf: '2026-01-02', warehouse: 'ALL' }, now)
    expect(weeks.periods).toHaveLength(4)
    expect(weeks.periods[3]).toMatchObject({ id: '2025-12-29', from: '2025-12-29', to: '2026-01-04', previousFrom: '2025-12-22', previousTo: '2025-12-28' })
    const years = aggregateFreight([], { ...query, grain: 'year' }, now)
    expect(years.periods.map(p => p.id)).toEqual(['2022', '2023', '2024', '2025', '2026'])
    expect(years.periods[0].previousFrom).toBe('2021-01-01')
  })
  it('reconciles carrier/warehouse totals and all-page drill amounts, including baseline drill', () => {
    const records = [row('a'), row('b', { carrierCode: '4PX', warehouseCode: 'SZ' }), row('c'), row('prior', { confirmedAt: '2025-12-15T00:00:00Z' })]
    const data = aggregateFreight(records, query, now)
    expect(data.series.slice(1).reduce((sum, s) => sum + s.totals.amount, 0)).toBe(data.totals.amount)
    const detail = freightDetails(records, { ...query, carrierCode: 'YT', periodId: '2026-01', workbenchRole: 'dispatch', page: 2, pageSize: 1 }, now)
    expect(detail.items).toHaveLength(1)
    expect(detail.total).toBe(2)
    expect(detail.totals).toEqual({ billCount: 2, amount: 200, originalAmounts: [{ currency: 'CNY', amount: 1400 }] })
    expect(freightDetails(records, { ...query, periodId: '2026-01', comparisonPeriod: 'previous', workbenchRole: 'dispatch', page: 1, pageSize: 20 }, now).totals.amount).toBe(100)
    expect(aggregateFreight(records, { ...query, warehouse: 'SZ' }, now).totals.amount).toBe(100)
  })
  it.each([{ year: 2027 }, { grain: 'week', weekOf: '2026-02-30' }, { grain: 'week', weekOf: '2027-01-01' }, { grain: 'week', weekOf: '2025-01-01' }])('rejects invalid/future or inconsistent period queries: %j', patch => {
    expect(() => aggregateFreight([], { ...query, ...patch } as FreightQuery, now)).toThrow()
  })
  it('rejects a period ID outside the returned window rather than broadening the detail query', () => {
    expect(() => freightDetails([], { ...query, periodId: '2026-12', workbenchRole: 'sales', page: 1, pageSize: 20 }, now)).toThrow()
  })
})

describe('independent freight resource authorization', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now) })
  afterEach(() => jest.useRealTimers())
  const setup = (records = [row('a')], extraGrant = {}, extraUser = {}) => {
    const user = { id: 'u', businessRole: 'admin', workbenchRoles: ['dispatch'], fopTenantId: 'tenant', fopUserId: 'fop-user', ...extraUser }
    const provider = { source: 'mock', isConfigured: () => true,
      resolvePermissions: async () => ({ subject: { tenantId: 'tenant', userId: 'fop-user' }, allowedOrderIds: [], allowedFreightIds: records.map(r => r.id), analyticsScopes: ['freight'], ...extraGrant }),
      listFreight: jest.fn(async () => records), listOrders: jest.fn(async () => { throw new Error('Orders not needed') }),
    }
    return { user, provider, service: new FopDataService({ findById: async () => user } as unknown as UsersService, provider as unknown as FopDataProvider) }
  }
  it('queries freight independently from order access, with no implicit order data fetch', async () => {
    const { service, provider } = setup()
    expect((await service.getFreight('u', query)).totals.amount).toBe(100)
    expect(provider.listOrders).not.toHaveBeenCalled()
  })
  it('denies missing cost scope; empty/missing cost IDs never fetch data', async () => {
    const { service, provider } = setup(undefined, { analyticsScopes: ['receipts'] })
    await expect(service.getFreight('u', query)).rejects.toMatchObject({ status: 403 })
    expect(provider.listFreight).not.toHaveBeenCalled()
    const empty = setup(undefined, { allowedFreightIds: undefined })
    expect((await empty.service.getFreight('u', query)).billCount).toBe(0)
    expect(empty.provider.listFreight).not.toHaveBeenCalled()
  })
  it('intersects tenant, allowed IDs and employee scope before computing amounts', async () => {
    const { service } = setup([row('good'), row('other', { owner: { id: 'e2', name: 'Other' } }), row('cross', { tenantId: 'elsewhere' }), row('not-granted')], { allowedFreightIds: ['good', 'other', 'cross'] }, { businessRole: 'salesperson', businessEmployeeId: 'e1' })
    expect((await service.getFreight('u', query)).totals.amount).toBe(100)
  })
  it('checks department descendants and blocks management-only accounts', async () => {
    const scoped = setup([row('good', { departmentPathIds: ['d1', 'parent'] }), row('other', { department: { id: 'd2', name: 'Other' } })], {}, { businessRole: 'department_manager', businessDepartmentId: 'parent' })
    expect((await scoped.service.getFreight('u', query)).billCount).toBe(1)
    await expect(setup(undefined, {}, { role: 'admin', businessRole: 'none' }).service.getFreight('u', query)).rejects.toMatchObject({ status: 403 })
  })
  it('rejects malformed ancestry before a string substring can satisfy a department scope', async () => {
    const candidate = row('bad-path', { department: { id: 'd10', name: 'Other department' } })
    Object.assign(candidate, { departmentPathIds: 'd10' })
    const scoped = setup([candidate], {}, { businessRole: 'department_manager', businessDepartmentId: 'd1' })
    await expect(scoped.service.getFreight('u', query)).rejects.toMatchObject({ status: 503 })
  })
  it('rejects duplicate authorized delivery facts and sanitized malformed cost errors', async () => {
    await expect(setup([row('same'), row('same')]).service.getFreight('u', query)).rejects.toMatchObject({ status: 503 })
    await expect(setup([row('bad', { fxRateToUsd: 0 })]).service.getFreight('u', query)).rejects.toMatchObject({ status: 503 })
  })
  it('discards data when business authorization changes while fetching costs', async () => {
    const s = setup()
    s.provider.listFreight.mockImplementation(async () => { s.user.businessRole = 'none'; return [row('a')] })
    await expect(s.service.getFreight('u', query)).rejects.toMatchObject({ status: 403 })
  })
  it('requires an authorized workbench role for paginated detail', async () => {
    const s = setup(undefined, {}, { businessRole: 'salesperson', businessEmployeeId: 'e1' })
    await expect(s.service.getFreightDetails('u', { ...query, workbenchRole: 'sales', page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 })
    expect((await s.service.getFreightDetails('u', { ...query, workbenchRole: 'dispatch', page: 1, pageSize: 20 })).totals.amount).toBe(100)
  })
})

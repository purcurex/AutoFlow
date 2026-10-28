import { aggregateSalesPerformance, performanceDetails, performancePeriods, publicProfit } from './sales-performance'
import { FopReceipt } from './fop-data.types'
import { FopProfit, PerformanceQuery } from './sales-performance.types'
const now = new Date('2026-03-15T04:00:00Z')
const query: PerformanceQuery = { from: '2026-01-01', to: '2026-01-31', grain: 'month' }
const profitFixture = (id: string, extra: Partial<FopProfit> = {}): FopProfit => ({
  id, orderId: id, orderNumber: `SO-${id}`, customerCode: 'C1', customerName: 'Customer', owner: { id: 'alice', name: 'Alice' }, department: { id: 'd1', name: 'Sales' }, salesDepartmentCode: 'sales1',
  recognitionMonth: '2026-01', recognitionDate: '2026-01-10', knownAt: '2026-01-11T08:00:00+08:00', status: 'estimated', settlementId: null, version: 'v1', approvedAt: null, cutoffAt: '2026-01-10T23:59:59+08:00', freightBasis: 'estimated',
  incomeAmount: 100, adjustmentIncome: 5, productCost: 30, freightCost: 10, refundCost: 5, returnCost: 2, otherCost: 3, previousRecognizedProfit: 15, roundingAdjustment: 0,
  amount: 40, currency: 'USD', originalAmount: 40, originalCurrency: 'USD', fxRateToUsd: 1, fxRateDate: '2026-01-10', fxRateSource: 'fixture', ...extra,
})
const profit = profitFixture
const receipt = (id: string, extra: Partial<FopReceipt> = {}): FopReceipt => ({ id, sourceType: 'fulfillment', documentId: id, documentNumber: id, customerId: 'c1', customerCode: 'C1', customerName: 'Customer', owner: { id: 'alice', name: 'Alice' }, department: { id: 'd1', name: 'Sales' }, salesDepartmentCode: 'sales1', warehouseCode: 'HZ', warehouse: '杭州仓', carrierCode: 'YT', amount: 80, orderAmount: 100, handlingFee: 20, currency: 'USD', paidAt: '2026-01-10T00:00:00Z', reviewStatus: 'approved', receiptReviewStatus: 'approved', paymentStatus: 'paid', cancelled: false, items: [], ...extra })
const settled = (id: string, extra: Partial<FopProfit> = {}) => profit(id, { status: 'settled', settlementId: 'bill-1', version: 's1', approvedAt: '2026-02-02T08:00:00+08:00', knownAt: '2026-02-02T08:00:00+08:00', freightBasis: 'frozen', cutoffAt: '2026-01-31T23:59:59+08:00', ...extra })
describe('sales performance period contributions', () => {
  it('keeps the settlement bill number separate from the internal ID and never invents one', () => {
    expect(publicProfit(settled('number', { settlementNumber: 'GP202601000001' }))).toMatchObject({ settlementId: 'bill-1', settlementNumber: 'GP202601000001' })
    expect(publicProfit(settled('legacy')).settlementNumber).toBeNull()
    expect(publicProfit(profit('estimate')).settlementNumber).toBeNull()
    expect(() => publicProfit(settled('invalid', { settlementNumber: ' ' }))).toThrow()
    expect(() => publicProfit(profit('invalid', { settlementNumber: 'GP202601000001' }))).toThrow()
  })
  it('uses UTC+8 and clips Monday-start weeks and months to the selected range', () => {
    expect(performancePeriods({ from: '2026-01-31', to: '2026-02-03', grain: 'week' }, now)).toEqual([
      { id: '2026-01-26', label: '01-31 — 02-01', from: '2026-01-31', to: '2026-02-01' }, { id: '2026-02-02', label: '02-02 — 02-03', from: '2026-02-02', to: '2026-02-03' },
    ])
    const summary = aggregateSalesPerformance([receipt('utc8', { paidAt: '2026-01-31T16:00:00Z' })], [], { from: '2026-01-31', to: '2026-02-01', grain: 'month' }, now)
    expect(summary.periods.map(p => p.collectionsAmount)).toEqual([0, 80])
    expect(summary.periods.map(p => [p.from, p.to])).toEqual([['2026-01-31', '2026-01-31'], ['2026-02-01', '2026-02-01']])
  })
  it.each([{ from: '2026-02-30' }, { from: '2019-12-31' }, { to: '2026-03-16' }, { from: '2026-02-01' }, { grain: 'year' }, { from: '2024-01-01', to: '2025-01-01' }])('rejects invalid or oversized ranges %j', extra => expect(() => performancePeriods({ ...query, ...extra } as PerformanceQuery, now)).toThrow())
  it('counts actual receipts by source without recreating stock product receipts on fulfillment', () => {
    const rows = [receipt('fulfillment', { amount: 60, orderAmount: 1000 }), receipt('stock', { sourceType: 'full_payment_stock', carrierCode: null, paidAt: '2025-12-10T00:00:00Z', amount: 1000 }), receipt('deposit', { sourceType: 'deposit_stock', carrierCode: null, amount: 9000 }), receipt('pending', { receiptReviewStatus: 'pending' })]
    expect(aggregateSalesPerformance(rows, [], query, now).totals).toMatchObject({ orderAmount: 60, stockAmount: 0, collectionsAmount: 60, receiptCount: 1 })
    expect(aggregateSalesPerformance(rows, [], { ...query, from: '2025-12-01' }, now).totals).toMatchObject({ orderAmount: 60, stockAmount: 1000, collectionsAmount: 1060, receiptCount: 2 })
  })
  it('rejects non-USD and subcent receipts and sums cents exactly', () => {
    expect(() => aggregateSalesPerformance([receipt('fx', { currency: 'CNY' })], [], query, now)).toThrow()
    expect(() => aggregateSalesPerformance([receipt('precision', { amount: .001 })], [], query, now)).toThrow()
    expect(aggregateSalesPerformance([receipt('a', { amount: .1 }), receipt('b', { amount: .2 })], [], query, now).totals.collectionsAmount).toBe(.3)
  })
  it('replaces estimates with approved frozen settlement contributions and allows later-known historical backfills', () => {
    const records = [profit('estimate', { orderId: 'order' }), settled('frozen', { orderId: 'order' }), profit('other')]
    expect(aggregateSalesPerformance([], records, query, now).totals).toMatchObject({ settledGrossProfit: 40, estimatedGrossProfit: 40, profitCount: 2 })
    expect(aggregateSalesPerformance([], records, query, now).periods[0].profitStatus).toBe('mixed')
    expect(performanceDetails([], records, { ...query, kind: 'profit', page: 1, pageSize: 10 }, now).profits.map(p => p.id)).toEqual(['frozen', 'other'])
  })
  it('keeps undated monthly settlements as references for daily, weekly and partial-month views', () => {
    const records = [settled('month', { recognitionDate: null }), settled('dated')]
    expect(aggregateSalesPerformance([], records, query, now).totals).toMatchObject({ settledGrossProfit: 80, unallocatedCount: 0 })
    for (const grain of ['week', 'day', 'month'] as const) {
      const selected = { ...query, from: '2026-01-10', to: '2026-01-11', grain }
      const summary = aggregateSalesPerformance([], records, selected, now)
      expect(summary.totals).toMatchObject({ settledGrossProfit: null, unallocatedCount: 1, profitCount: 2 })
      expect(summary.unallocatedSettlements).toEqual([{ month: '2026-01', amount: 40, count: 1 }])
      const detail = performanceDetails([], records, { ...selected, kind: 'profit', page: 1, pageSize: 1 }, now)
      expect(detail.total).toBe(2); expect(detail.totals).toEqual(summary.totals); expect(detail.unallocatedSettlements).toEqual(summary.unallocatedSettlements)
    }
  })
  it('excludes future receipt/knowledge/approval events but allows a future cutoff boundary', () => {
    const current = { from: '2026-03-15', to: '2026-03-15', grain: 'day' as const }
    const base = profit('current', { recognitionMonth: '2026-03', recognitionDate: '2026-03-15', knownAt: now.toISOString(), cutoffAt: now.toISOString() })
    const records = [base, { ...base, id: 'known', orderId: 'known', knownAt: '2026-03-15T04:00:01Z' }, { ...base, id: 'cutoff', orderId: 'cutoff', cutoffAt: '2026-03-15T04:00:01Z' }, settled('approved', { recognitionMonth: '2026-03', recognitionDate: '2026-03-15', cutoffAt: now.toISOString(), knownAt: now.toISOString(), approvedAt: '2026-03-15T04:00:01Z' })]
    expect(aggregateSalesPerformance([receipt('now', { paidAt: now.toISOString() }), receipt('future', { paidAt: '2026-03-15T04:00:01Z' })], records, current, now).totals).toMatchObject({ collectionsAmount: 80, estimatedGrossProfit: 80, settledGrossProfit: 0, profitCount: 2, receiptCount: 1 })
  })
  it('excludes a contribution whose FX observation date is still in the future', () => {
    expect(aggregateSalesPerformance([], [profit('future-fx', { fxRateDate: '2026-04-01' })], query, now).totals).toMatchObject({ estimatedGrossProfit: 0, profitCount: 0 })
  })
  it('rejects duplicate IDs, ambiguous settlements, and repeated estimated versions for one event date', () => {
    for (const records of [[profit('same'), profit('same')], [settled('a', { orderId: 'x' }), settled('b', { orderId: 'x', version: 's2' })], [profit('a', { orderId: 'x' }), profit('b', { orderId: 'x', version: 'v2' })]]) expect(() => aggregateSalesPerformance([], records, query, now)).toThrow()
  })
  it('returns deterministic detail pages with pre-pagination totals and validates period membership', () => {
    const records = [profit('b'), profit('a'), profit('feb', { recognitionMonth: '2026-02', recognitionDate: '2026-02-03', cutoffAt: '2026-02-03T23:59:59+08:00' })]
    const q = { ...query, to: '2026-02-28', kind: 'profit' as const, page: 1, pageSize: 1, periodId: '2026-01' }
    const first = performanceDetails([], records, q, now), second = performanceDetails([], records, { ...q, page: 2 }, now)
    expect(first.profits.map(p => p.id)).toEqual(['a']); expect(second.profits.map(p => p.id)).toEqual(['b'])
    expect(first).toMatchObject({ total: 2, range: { from: '2026-01-01', to: '2026-01-31' }, totals: { estimatedGrossProfit: 80 } }); expect(second.totals).toEqual(first.totals)
    expect(() => performanceDetails([], records, { ...q, periodId: '2025-01' }, now)).toThrow(); expect(() => performanceDetails([], records, { ...q, page: 0 }, now)).toThrow()
  })
})
describe('profit provider contract', () => {
  it('validates signed USD net contribution components, rounding adjustment, and exact signed FX conversion', () => {
    expect(publicProfit(profit('normal')).amount).toBe(40)
    expect(publicProfit(profit('negative', { adjustmentIncome: -45, amount: -10, originalAmount: -70, originalCurrency: 'CNY', fxRateToUsd: 1 / 7 })).amount).toBe(-10)
    expect(publicProfit(profit('rounding', { roundingAdjustment: .01, amount: 40.01, originalAmount: 40.01 })).amount).toBe(40.01)
    const output = publicProfit({ ...profit('safe'), tenantId: 'private', token: 'secret', owner: { id: 'alice', name: 'Alice', token: 'hidden' } } as FopProfit)
    expect(output).not.toHaveProperty('tenantId'); expect(output).not.toHaveProperty('token'); expect(output.owner).toEqual({ id: 'alice', name: 'Alice' })
  })
  it.each([{ amount: 41 }, { productCost: '30' }, { refundCost: null }, { previousRecognizedProfit: '15' }, { incomeAmount: .001 }, { amount: NaN }, { currency: 'CNY' }, { fxRateToUsd: 2 }, { originalAmount: 41 }, { recognitionDate: null }, { recognitionDate: '2026-02-10' }, { recognitionDate: '2026-01-11' }, { cutoffAt: '2026-01-10T00:00:00+08:00' }, { knownAt: '2026-01-11 12:00:00' }, { approvedAt: '2026-01-11T00:00:00Z' }, { status: 'settled' }, { freightBasis: 'frozen' }, { recognitionMonth: '2026-13' }, { fxRateDate: '2026-02-30' }, { incomeAmount: Number.MAX_SAFE_INTEGER }, { roundingAdjustment: .11, amount: 40.11, originalAmount: 40.11 }])('rejects malformed or contradictory facts %j', extra => expect(() => publicProfit(profit('bad', extra as Partial<FopProfit>))).toThrow())
  it('detects aggregate overflow instead of emitting an unsafe total', () => {
    const huge = 50_000_000_000_000
    const row = (id: string) => profit(id, { incomeAmount: huge, adjustmentIncome: 0, productCost: 0, freightCost: 0, refundCost: 0, returnCost: 0, otherCost: 0, previousRecognizedProfit: 0, amount: huge, originalAmount: huge })
    expect(() => aggregateSalesPerformance([], [row('a'), row('b')], query, now)).toThrow()
  })
})

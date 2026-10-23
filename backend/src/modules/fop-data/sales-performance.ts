import { BadRequestException } from '@nestjs/common'
import { businessDate, BUSINESS_TIME_ZONE, DAY_MS, validBusinessDay } from './fop-business-time'
import { FopReceipt, SALES_DEPARTMENTS } from './fop-data.types'
import { convertFreightAmount } from './fop-freight'
import { moneyToCents } from './fop-order-totals'
import { eligibleReceipts } from './fop-receipts'
import type { FopProfit, PerformanceData, PerformanceDetailsQuery, PerformanceMetrics, PerformancePage, PerformancePeriod, PerformanceQuery, PerformanceUnallocated } from './sales-performance.types'

type Summary = Omit<PerformanceData, 'source' | 'owners' | 'selectedOwner' | 'canSelectOwner'>
type Period = Pick<PerformancePeriod, 'id' | 'label' | 'from' | 'to'>
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)
const lastOfMonth = (month: string) => iso(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
const inRange = (date: string, range: { from: string; to: string }) => date >= range.from && date <= range.to
function cents(value: number): number {
  const result = moneyToCents(value)
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(result) || result / 100 !== value) throw new Error('Invalid performance monetary precision')
  return result
}
function sum(values: readonly number[]): number {
  const total = values.reduce((result, value) => result + BigInt(cents(value)), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Performance total exceeds safe precision')
  return Number(total) / 100
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid profit text field')
}
function timestamp(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !businessDate(value)) throw new Error('Invalid profit timestamp')
}
function reference(value: { id: string; name: string }) {
  if (!value || typeof value !== 'object') throw new Error('Invalid profit reference')
  text(value.id); text(value.name)
  return { id: value.id, name: value.name }
}

/** Validate only after tenant, resource allowlist and business-scope intersection. */
export function publicProfit(row: FopProfit): FopProfit {
  for (const value of [row.id, row.orderId, row.orderNumber, row.customerCode, row.customerName, row.version, row.fxRateSource]) text(value)
  const owner = reference(row.owner), department = reference(row.department)
  if (!SALES_DEPARTMENTS.some(d => d.id === row.salesDepartmentCode) || !['estimated', 'settled'].includes(row.status)
    || !/^\d{4}-\d{2}$/.test(row.recognitionMonth) || !validBusinessDay(`${row.recognitionMonth}-01`)) throw new Error('Invalid profit dimension')
  timestamp(row.knownAt); timestamp(row.cutoffAt)
  if (row.recognitionDate !== null && (!validBusinessDay(row.recognitionDate) || row.recognitionDate.slice(0, 7) !== row.recognitionMonth || Date.parse(`${row.recognitionDate}T00:00:00+08:00`) >= Date.parse(row.cutoffAt))) throw new Error('Invalid profit recognition date')
  if (row.recognitionMonth > businessDate(row.cutoffAt).slice(0, 7)) throw new Error('Profit month exceeds its cutoff')
  if (row.status === 'settled') {
    text(row.settlementId); timestamp(row.approvedAt)
    if (row.freightBasis !== 'frozen') throw new Error('Settlement requires frozen costs')
  } else if (row.settlementId !== null || row.approvedAt !== null || row.freightBasis !== 'estimated' || row.recognitionDate === null) throw new Error('Estimate requires dated event contribution and estimated freight')
  for (const value of [row.incomeAmount, row.adjustmentIncome, row.productCost, row.freightCost, row.refundCost, row.returnCost, row.otherCost, row.previousRecognizedProfit, row.roundingAdjustment]) cents(value)
  const components = [row.incomeAmount, row.adjustmentIncome, -row.productCost, -row.freightCost, -row.refundCost, -row.returnCost, -row.otherCost, -row.previousRecognizedProfit, row.roundingAdjustment]
  cents(row.amount); cents(row.originalAmount)
  if (Math.abs(row.roundingAdjustment) > .10 || sum(components) !== row.amount) throw new Error('Profit components do not reconcile')
  if (row.currency !== 'USD' || typeof row.originalCurrency !== 'string' || !/^[A-Z]{3}$/.test(row.originalCurrency)
    || !Number.isFinite(row.fxRateToUsd) || row.fxRateToUsd <= 0 || (row.originalCurrency === 'USD' && row.fxRateToUsd !== 1)
    || !validBusinessDay(row.fxRateDate)
    || Math.sign(row.originalAmount) * convertFreightAmount(Math.abs(row.originalAmount), row.fxRateToUsd) !== row.amount) throw new Error('Invalid profit currency conversion')
  return {
    id: row.id, orderId: row.orderId, orderNumber: row.orderNumber, customerCode: row.customerCode, customerName: row.customerName, owner, department, salesDepartmentCode: row.salesDepartmentCode,
    recognitionMonth: row.recognitionMonth, recognitionDate: row.recognitionDate, knownAt: row.knownAt, status: row.status, settlementId: row.settlementId, version: row.version,
    approvedAt: row.approvedAt, cutoffAt: row.cutoffAt, freightBasis: row.freightBasis,
    incomeAmount: row.incomeAmount, adjustmentIncome: row.adjustmentIncome, productCost: row.productCost, freightCost: row.freightCost, refundCost: row.refundCost, returnCost: row.returnCost,
    otherCost: row.otherCost, previousRecognizedProfit: row.previousRecognizedProfit, roundingAdjustment: row.roundingAdjustment, amount: row.amount, currency: 'USD',
    originalAmount: row.originalAmount, originalCurrency: row.originalCurrency, fxRateToUsd: row.fxRateToUsd, fxRateDate: row.fxRateDate, fxRateSource: row.fxRateSource,
  }
}

export function performancePeriods(query: PerformanceQuery, now = new Date()): Period[] {
  if (!validBusinessDay(query.from) || !validBusinessDay(query.to) || query.from < '2020-01-01' || query.from > query.to
    || query.to > businessDate(now) || time(query.to) - time(query.from) > 365 * DAY_MS || !['month', 'week', 'day'].includes(query.grain)
    || (query.ownerId !== undefined && (typeof query.ownerId !== 'string' || !query.ownerId.trim() || query.ownerId.length > 128))) throw new BadRequestException('Invalid sales performance query')
  const periods: Period[] = []
  let start = time(query.from)
  if (query.grain === 'month') start = time(query.from.slice(0, 7) + '-01')
  if (query.grain === 'week') start -= (new Date(start).getUTCDay() + 6) % 7 * DAY_MS
  while (start <= time(query.to)) {
    const anchor = iso(start)
    const next = query.grain === 'month' ? time(lastOfMonth(anchor.slice(0, 7))) + DAY_MS : start + (query.grain === 'week' ? 7 : 1) * DAY_MS
    const from = anchor < query.from ? query.from : anchor, to = iso(next - DAY_MS) > query.to ? query.to : iso(next - DAY_MS)
    const id = query.grain === 'month' ? anchor.slice(0, 7) : anchor
    periods.push({ id, label: query.grain === 'week' ? `${from.slice(5)} — ${to.slice(5)}` : id, from, to })
    start = next
  }
  return periods
}

export function effectiveProfits(records: readonly FopProfit[], now: Date): FopProfit[] {
  const seen = new Set<string>()
  const rows = records.map(publicProfit).filter(row => {
    if (seen.has(row.id)) throw new Error('Duplicate profit ID')
    seen.add(row.id)
    return Date.parse(row.knownAt) <= now.getTime() && row.fxRateDate <= businessDate(now)
      && (row.approvedAt === null || Date.parse(row.approvedAt) <= now.getTime())
      && (row.recognitionDate === null || row.recognitionDate <= businessDate(now))
  })
  const groups = new Map<string, FopProfit[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.orderId, row.recognitionMonth])
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()].flatMap(group => {
    const settled = group.filter(row => row.status === 'settled')
    if (settled.length > 1) throw new Error('Ambiguous settlement versions for order and month')
    if (settled.length) return settled
    const dates = new Set<string>(), versions = new Set<string>()
    for (const row of group) {
      if (dates.has(row.recognitionDate!) || versions.has(row.version)) throw new Error('Repeated estimated snapshot')
      dates.add(row.recognitionDate!); versions.add(row.version)
    }
    return group
  })
}

/** Range selection never uses approval/known dates as the economic recognition day. */
function selectedRows(receipts: readonly FopReceipt[], profits: readonly FopProfit[], query: PerformanceQuery, now: Date) {
  const seen = new Set<string>()
  for (const row of receipts) {
    if (seen.has(row.id)) throw new Error('Duplicate receipt ID')
    seen.add(row.id)
  }
  const selectedReceipts = eligibleReceipts(receipts, now).filter(row => inRange(businessDate(row.paidAt!), query))
  for (const row of selectedReceipts) {
    if (row.currency !== 'USD' || row.amount < 0) throw new Error('Performance receipts require explicit USD amounts')
    cents(row.amount)
  }
  const selectedProfits = effectiveProfits(profits, now).filter(row => row.recognitionDate ? inRange(row.recognitionDate, query) : row.recognitionMonth >= query.from.slice(0, 7) && row.recognitionMonth <= query.to.slice(0, 7))
  return { receipts: selectedReceipts, profits: selectedProfits }
}
function isUnallocated(row: FopProfit, query: PerformanceQuery) {
  return row.recognitionDate === null && !(query.grain === 'month' && query.from <= `${row.recognitionMonth}-01` && query.to >= lastOfMonth(row.recognitionMonth))
}
function metrics(receipts: readonly FopReceipt[], profits: readonly FopProfit[], query: PerformanceQuery): PerformanceMetrics {
  const unallocatedCount = profits.filter(p => isUnallocated(p, query)).length
  return {
    orderAmount: sum(receipts.filter(r => r.sourceType === 'fulfillment').map(r => r.amount)), stockAmount: sum(receipts.filter(r => r.sourceType === 'full_payment_stock').map(r => r.amount)), collectionsAmount: sum(receipts.map(r => r.amount)),
    settledGrossProfit: unallocatedCount ? null : sum(profits.filter(p => p.status === 'settled').map(p => p.amount)), estimatedGrossProfit: sum(profits.filter(p => p.status === 'estimated').map(p => p.amount)),
    unallocatedCount, receiptCount: receipts.length, profitCount: profits.length,
  }
}
function unallocatedSettlements(profits: readonly FopProfit[], query: PerformanceQuery): PerformanceUnallocated[] {
  const groups = new Map<string, FopProfit[]>()
  for (const row of profits.filter(p => isUnallocated(p, query))) groups.set(row.recognitionMonth, [...(groups.get(row.recognitionMonth) ?? []), row])
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, rows]) => ({ month, amount: sum(rows.map(row => row.amount)), count: rows.length }))
}
export function aggregateSalesPerformance(receipts: readonly FopReceipt[], profits: readonly FopProfit[], query: PerformanceQuery, now = new Date()): Summary {
  const ranges = performancePeriods(query, now)
  const rows = selectedRows(receipts, profits, query, now)
  const periods = ranges.map(range => {
    const periodQuery = { ...query, from: range.from, to: range.to }
    const periodReceipts = rows.receipts.filter(r => inRange(businessDate(r.paidAt!), range))
    const periodProfits = rows.profits.filter(r => r.recognitionDate ? inRange(r.recognitionDate, range) : r.recognitionMonth >= range.from.slice(0, 7) && r.recognitionMonth <= range.to.slice(0, 7))
    const totals = metrics(periodReceipts, periodProfits, periodQuery)
    const hasSettled = periodProfits.some(p => p.status === 'settled'), hasEstimated = periodProfits.some(p => p.status === 'estimated')
    const profitStatus: PerformancePeriod['profitStatus'] = totals.unallocatedCount ? 'unallocated' : hasSettled && hasEstimated ? 'mixed' : hasSettled ? 'settled' : hasEstimated ? 'estimated' : 'none'
    return { ...range, ...totals, profitStatus }
  })
  return { query: { from: query.from, to: query.to, grain: query.grain, ...(query.ownerId ? { ownerId: query.ownerId } : {}) }, timeZone: BUSINESS_TIME_ZONE, currency: 'USD', asOf: now.toISOString(), periods,
    totals: metrics(rows.receipts, rows.profits, query), unallocatedSettlements: unallocatedSettlements(rows.profits, query) }
}
export function performanceDetails(receipts: readonly FopReceipt[], profits: readonly FopProfit[], query: PerformanceDetailsQuery, now = new Date()): Omit<PerformancePage, 'source'> {
  const periods = performancePeriods(query, now)
  if (!['receipts', 'profit'].includes(query.kind) || !Number.isInteger(query.page) || query.page < 1 || query.page > 1_000_000 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) throw new BadRequestException('Invalid performance detail filters')
  const period = query.periodId === undefined ? undefined : periods.find(p => p.id === query.periodId)
  if (query.periodId !== undefined && !period) throw new BadRequestException('Performance period is outside the selected range')
  const range = { from: period?.from ?? query.from, to: period?.to ?? query.to }
  const selected = { ...query, ...range }, rows = selectedRows(receipts, profits, selected, now)
  rows.receipts.sort((a, b) => Date.parse(b.paidAt!) - Date.parse(a.paidAt!) || a.id.localeCompare(b.id))
  rows.profits.sort((a, b) => (b.recognitionDate ?? lastOfMonth(b.recognitionMonth)).localeCompare(a.recognitionDate ?? lastOfMonth(a.recognitionMonth)) || a.id.localeCompare(b.id))
  const start = (query.page - 1) * query.pageSize
  return { timeZone: BUSINESS_TIME_ZONE, currency: 'USD', asOf: now.toISOString(), kind: query.kind, total: rows[query.kind === 'receipts' ? 'receipts' : 'profits'].length, page: query.page, pageSize: query.pageSize,
    receipts: query.kind === 'receipts' ? rows.receipts.slice(start, start + query.pageSize) : [], profits: query.kind === 'profit' ? rows.profits.slice(start, start + query.pageSize) : [],
    totals: metrics(rows.receipts, rows.profits, selected), range, unallocatedSettlements: unallocatedSettlements(rows.profits, selected) }
}

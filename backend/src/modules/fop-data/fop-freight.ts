import { BadRequestException } from '@nestjs/common'
import { businessDate, BUSINESS_TIME_ZONE, DAY_MS, validBusinessDay } from './fop-business-time'
import { FOP_CARRIERS } from './fop-carriers'
import { moneyToCents } from './fop-order-totals'
import { FopFreight, FreightDetailsQuery, FreightPeriod, FreightQuery, FreightSeries, FreightValue } from './fop-freight.types'

function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid freight text field')
}
function money(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(moneyToCents(value)) || Math.abs(moneyToCents(value) / 100 - value) > 1e-8) throw new Error('Invalid freight monetary amount')
}
/** Exact decimal multiplication at the contract boundary, rounded HALF_UP to USD cents. */
export function convertFreightAmount(originalAmount: number, rate: number): number {
  money(originalAmount)
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid freight FX rate')
  const [mantissa, exponent = '0'] = rate.toString().split('e')
  const fractionDigits = mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0
  const scale = fractionDigits - Number(exponent)
  const coefficient = BigInt(mantissa.replace('.', '')) * (scale < 0 ? BigInt(10) ** BigInt(-scale) : BigInt(1))
  const denominator = scale > 0 ? BigInt(10) ** BigInt(scale) : BigInt(1)
  const cents = (BigInt(moneyToCents(originalAmount)) * coefficient + denominator / BigInt(2)) / denominator
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Converted freight exceeds safe precision')
  return Number(cents) / 100
}
function reference(value: { id: string; name: string } | undefined) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Invalid freight reference')
  text(value.id); text(value.name)
  return { id: value.id, name: value.name }
}
/** Whitelist provider output; refuse missing currency/FX and mixed-currency sums. */
export function publicFreight(row: FopFreight): FopFreight {
  for (const value of [row.id, row.documentNumber, row.orderNumber, row.carrierName, row.channelName, row.warehouse, row.customerId, row.customerCode, row.customerName, row.fxRateSource]) text(value)
  if (row.trackingNumber !== null) text(row.trackingNumber)
  if (!FOP_CARRIERS.some(c => c.id === row.carrierCode) || !['HZ', 'SZ'].includes(row.warehouseCode)
    || !['approved', 'pending'].includes(row.reviewStatus) || !['confirmed', 'pending'].includes(row.costStatus)
    || (row.salesDepartmentCode !== undefined && !['sales1', 'sales2', 'sales3', 'sales4'].includes(row.salesDepartmentCode))) throw new Error('Invalid freight dimension')
  money(row.originalAmount); money(row.amount)
  if (typeof row.originalCurrency !== 'string' || !/^[A-Z]{3}$/.test(row.originalCurrency) || row.currency !== 'USD'
    || !Number.isFinite(row.fxRateToUsd) || row.fxRateToUsd <= 0 || (row.originalCurrency === 'USD' && row.fxRateToUsd !== 1)
    || !validBusinessDay(row.fxRateDate) || convertFreightAmount(row.originalAmount, row.fxRateToUsd) !== row.amount) throw new Error('Invalid freight currency conversion')
  if ((row.confirmedAt !== null && (typeof row.confirmedAt !== 'string' || !businessDate(row.confirmedAt))) || (row.costStatus === 'confirmed' && !row.confirmedAt)) throw new Error('Missing or invalid freight confirmation timestamp')
  return {
    id: row.id, documentNumber: row.documentNumber, orderNumber: row.orderNumber, trackingNumber: row.trackingNumber,
    carrierCode: row.carrierCode, carrierName: row.carrierName, channelName: row.channelName, warehouseCode: row.warehouseCode, warehouse: row.warehouse,
    customerId: row.customerId, customerCode: row.customerCode, customerName: row.customerName,
    ...(row.organization ? { organization: reference(row.organization) } : {}), ...(row.department ? { department: reference(row.department) } : {}), ...(row.owner ? { owner: reference(row.owner) } : {}),
    ...(row.salesDepartmentCode ? { salesDepartmentCode: row.salesDepartmentCode } : {}),
    originalAmount: row.originalAmount, originalCurrency: row.originalCurrency, fxRateToUsd: row.fxRateToUsd,
    fxRateDate: row.fxRateDate, fxRateSource: row.fxRateSource, amount: row.amount, currency: 'USD',
    confirmedAt: row.confirmedAt, reviewStatus: row.reviewStatus, costStatus: row.costStatus,
  }
}
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
const time = (date: string) => Date.parse(`${date}T00:00:00Z`)
function monthRange(year: number, month: number): [string, string] { return [iso(Date.UTC(year, month, 1)), iso(Date.UTC(year, month + 1, 0))] }
export function freightPeriods(query: FreightQuery, now = new Date()): { query: FreightQuery; periods: FreightPeriod[] } {
  const today = businessDate(now), currentYear = Number(today.slice(0, 4))
  if (!['month', 'week', 'year'].includes(query.grain) || !Number.isInteger(query.year) || query.year < 2020 || query.year > currentYear
    || !['ALL', 'HZ', 'SZ'].includes(query.warehouse) || (query.carrierCode && !FOP_CARRIERS.some(c => c.id === query.carrierCode))
    || (query.weekOf !== undefined && query.grain !== 'week')) throw new BadRequestException('Invalid freight query')
  const normalized = { ...query }, periods: FreightPeriod[] = []
  const push = (id: string, label: string, range: [string, string], previous: [string, string]) => {
    const [from, end] = range
    periods.push({ id, label, from, to: end > today ? today : end, partial: end > today || today === end, previousFrom: previous[0], previousTo: previous[1] })
  }
  if (query.grain === 'month') {
    const count = query.year === currentYear ? Number(today.slice(5, 7)) : 12
    for (let month = 0; month < count; month++) {
      const range = monthRange(query.year, month)
      push(range[0].slice(0, 7), range[0].slice(0, 7), range, monthRange(query.year, month - 1))
    }
  } else if (query.grain === 'week') {
    const anchor = query.weekOf ?? (query.year === currentYear ? today : `${query.year}-12-31`)
    if (!validBusinessDay(anchor) || anchor > today || Number(anchor.slice(0, 4)) !== query.year) throw new BadRequestException('Invalid freight week anchor')
    normalized.weekOf = anchor
    const monday = time(anchor) - ((new Date(time(anchor)).getUTCDay() + 6) % 7) * DAY_MS
    for (let i = 3; i >= 0; i--) {
      const start = monday - i * 7 * DAY_MS
      push(iso(start), `${iso(start).slice(5)} — ${iso(start + 6 * DAY_MS).slice(5)}`, [iso(start), iso(start + 6 * DAY_MS)], [iso(start - 7 * DAY_MS), iso(start - DAY_MS)])
    }
  } else {
    for (let year = Math.max(2020, query.year - 4); year <= query.year; year++) push(String(year), String(year), [`${year}-01-01`, `${year}-12-31`], [`${year - 1}-01-01`, `${year - 1}-12-31`])
  }
  return { query: normalized, periods }
}
function eligible(records: readonly FopFreight[], query: FreightQuery, now: Date) {
  return records.filter(r => r.reviewStatus === 'approved' && r.costStatus === 'confirmed' && r.amount > 0 && r.originalAmount > 0 && r.confirmedAt && businessDate(r.confirmedAt)
    && Date.parse(r.confirmedAt) <= now.getTime() && (query.warehouse === 'ALL' || r.warehouseCode === query.warehouse) && (!query.carrierCode || r.carrierCode === query.carrierCode))
}
function sum(values: number[]) {
  let cents = 0
  for (const value of values) {
    cents += moneyToCents(value)
    if (!Number.isSafeInteger(cents)) throw new Error('Freight aggregate exceeds safe precision')
  }
  return cents / 100
}
function comparison(amount: number, previousAmount: number): FreightValue {
  const delta = sum([amount, -previousAmount])
  return { amount, previousAmount, delta, percent: previousAmount === 0 ? (delta === 0 ? 0 : null) : delta / previousAmount * 100 }
}
const inRange = (r: FopFreight, from: string, to: string) => { const date = businessDate(r.confirmedAt!); return date >= from && date <= to }
export function aggregateFreight(records: readonly FopFreight[], input: FreightQuery, now = new Date()) {
  const { query, periods } = freightPeriods(input, now), rows = eligible(records, query, now)
  const definitions = [{ id: 'total', label: '物流运费合计', kind: 'total' as const }, ...FOP_CARRIERS.filter(c => !query.carrierCode || c.id === query.carrierCode).map(c => ({ id: `carrier:${c.id}`, label: c.label, kind: 'detail' as const, carrierCode: c.id }))]
  const series: FreightSeries[] = definitions.map(definition => {
    const matching = definition.kind === 'total' ? rows : rows.filter(r => r.carrierCode === definition.carrierCode)
    const values = periods.map(p => comparison(sum(matching.filter(r => inRange(r, p.from, p.to)).map(r => r.amount)), sum(matching.filter(r => inRange(r, p.previousFrom, p.previousTo)).map(r => r.amount))))
    return { ...definition, values, totals: comparison(sum(values.map(v => v.amount)), sum(values.map(v => v.previousAmount))), billCount: matching.filter(r => periods.some(p => inRange(r, p.from, p.to))).length }
  })
  return { query, timeZone: BUSINESS_TIME_ZONE, currency: 'USD' as const, dateBasis: 'freight_confirmed_at' as const, asOf: now.toISOString(), periods, series, totals: series[0].totals, billCount: series[0].billCount }
}
export function freightDetails(records: readonly FopFreight[], query: FreightDetailsQuery, now = new Date()) {
  const { periods } = freightPeriods(query, now)
  const period = query.periodId ? periods.find(p => p.id === query.periodId) : undefined
  if ((query.periodId && !period) || !['current', 'previous'].includes(query.comparisonPeriod ?? 'current') || !Number.isInteger(query.page) || query.page < 1 || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) throw new BadRequestException('Invalid freight details query')
  const selected = period ? [period] : periods
  const previous = query.comparisonPeriod === 'previous'
  const range = { from: previous ? selected[0].previousFrom : selected[0].from, to: previous ? selected[selected.length - 1].previousTo : selected[selected.length - 1].to }
  const rows = eligible(records, query, now).filter(r => selected.some(p => inRange(r, previous ? p.previousFrom : p.from, previous ? p.previousTo : p.to)))
    .sort((a, b) => Date.parse(b.confirmedAt!) - Date.parse(a.confirmedAt!) || a.id.localeCompare(b.id))
  const original = [...new Set(rows.map(r => r.originalCurrency))].sort().map(currency => ({ currency, amount: sum(rows.filter(r => r.originalCurrency === currency).map(r => r.originalAmount)) }))
  return { timeZone: BUSINESS_TIME_ZONE, currency: 'USD' as const, dateBasis: 'freight_confirmed_at' as const, total: rows.length, page: query.page, pageSize: query.pageSize, items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), totals: { billCount: rows.length, amount: sum(rows.map(r => r.amount)), originalAmounts: original }, range }
}

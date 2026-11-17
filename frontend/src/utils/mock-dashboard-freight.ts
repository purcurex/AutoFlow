import { FIRST_BUSINESS_YEAR, BUSINESS_START_DATE } from './business-years'
import type { EffectiveChartAccess } from '@/api/fop-chart-access'
import type { FreightData, FreightPeriod, FreightQuery, FreightSeries, FreightValue } from '@/api/fop-freight'
import { freightCarrierName, freightCarriers } from './freight'

const DAY = 86_400_000
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`)
const sum = (values: number[]) => values.reduce((total, value) => total + Math.round(value * 100), 0) / 100
function comparison(amount: number, previousAmount: number): FreightValue {
  const delta = sum([amount, -previousAmount])
  return { amount, previousAmount, delta, percent: previousAmount ? delta / previousAmount * 100 : amount ? null : 0 }
}

/** Dashboard-only synthetic aggregates. No source documents, API calls, or persistence. */
export function mockDashboardFreight(query: FreightQuery, access: EffectiveChartAccess, now = new Date()): FreightData {
  const today = iso(now.getTime() + 8 * 3600_000), currentYear = Number(today.slice(0, 4))
  if (!Number.isInteger(query.year) || query.year < FIRST_BUSINESS_YEAR || query.year > currentYear
    || !['month', 'week', 'year'].includes(query.grain) || !['ALL', 'HZ', 'SZ'].includes(query.warehouse)) throw new Error('Invalid mock freight range')
  const periods: FreightPeriod[] = []
  const push = (id: string, label: string, from: string, end: string, previousFrom: string, previousTo: string) => {
    if (end < BUSINESS_START_DATE) return
    if (from < BUSINESS_START_DATE) { from = BUSINESS_START_DATE; id = from; label = `${from.slice(5)} — ${end.slice(5)}` }
    periods.push({ id, label, from, to: end > today ? today : end, partial: end >= today, previousFrom, previousTo })
  }
  if (query.grain === 'month') {
    const count = query.year === currentYear ? Number(today.slice(5, 7)) : 12
    for (let month = 0; month < count; month++) {
      const from = iso(Date.UTC(query.year, month, 1))
      push(from.slice(0, 7), from.slice(0, 7), from, iso(Date.UTC(query.year, month + 1, 0)), iso(Date.UTC(query.year, month - 1, 1)), iso(Date.UTC(query.year, month, 0)))
    }
  } else if (query.grain === 'week') {
    const anchor = query.weekOf ?? (query.year === currentYear ? today : `${query.year}-12-31`)
    const date = midnight(anchor)
    if (!Number.isFinite(date) || iso(date) !== anchor || anchor > today || Number(anchor.slice(0, 4)) !== query.year) throw new Error('Invalid mock freight week')
    const monday = date - (new Date(date).getUTCDay() + 6) % 7 * DAY
    for (let i = 3; i >= 0; i--) {
      const from = monday - i * 7 * DAY
      push(iso(from), `${iso(from).slice(5)} — ${iso(from + 6 * DAY).slice(5)}`, iso(from), iso(from + 6 * DAY), iso(from - 7 * DAY), iso(from - DAY))
    }
  } else {
    for (let year = Math.max(FIRST_BUSINESS_YEAR, query.year - 4); year <= query.year; year++) {
      push(String(year), String(year), `${year}-01-01`, `${year}-12-31`, `${year - 1}-01-01`, `${year - 1}-12-31`)
    }
  }
  // The same deterministic daily facts feed every grain and warehouse selection.
  const range = (from: string, to: string, carrier: number) => {
    let cents = 0, bills = 0
    for (let day = midnight(from < BUSINESS_START_DATE ? BUSINESS_START_DATE : from); day <= midnight(to); day += DAY) {
      for (const warehouse of query.warehouse === 'ALL' ? [0, 1] : [query.warehouse === 'HZ' ? 0 : 1]) {
        const date = new Date(day), serial = Math.floor(day / DAY)
        const count = 8 + (serial * 7 + carrier * 13 + warehouse * 11) % 23
        const price = 390 + carrier * 87 + warehouse * 45 + date.getUTCMonth() * 12 + serial % 71
        cents += count * price
        bills += count
      }
    }
    return { amount: cents / 100, bills }
  }
  const details: FreightSeries[] = freightCarriers.filter(code => !query.carrierCode || code === query.carrierCode).map(code => {
    const carrier = freightCarriers.indexOf(code)
    const current = periods.map(period => range(period.from, period.to, carrier))
    const values = periods.map((period, index) => comparison(current[index]!.amount, range(period.previousFrom, period.previousTo, carrier).amount))
    return { id: `mock:${code}`, label: freightCarrierName(code), kind: 'detail', carrierCode: code, values,
      totals: comparison(sum(values.map(value => value.amount)), sum(values.map(value => value.previousAmount))),
      billCount: current.reduce((total, value) => total + value.bills, 0) }
  })
  const total: FreightSeries = { id: 'mock:total', label: '合计', kind: 'total',
    values: periods.map((_, index) => comparison(sum(details.map(row => row.values[index]!.amount)), sum(details.map(row => row.values[index]!.previousAmount)))),
    totals: comparison(sum(details.map(row => row.totals.amount)), sum(details.map(row => row.totals.previousAmount))),
    billCount: details.reduce((count, row) => count + row.billCount, 0) }
  return { source: 'mock', chartAccess: { ...access, canViewDetails: false, canExport: false, summaryOnly: true },
    query: { ...query }, timeZone: 'UTC+8', currency: 'USD', dateBasis: 'freight_confirmed_at', asOf: now.toISOString(),
    periods, series: [total, ...details], totals: total.totals, billCount: total.billCount }
}

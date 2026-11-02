import { FopOrganizationSummaryRow, SALES_DEPARTMENTS, SalesDepartmentCode } from './fop-data.types'
import { businessDate, BUSINESS_TIME_ZONE } from './fop-business-time'
import { monthlyReceipts, sumReceiptCents } from './fop-receipts'
import { orderVolumePeriods, VolumeSeries } from './order-volume'
import { OrderVolumeQueryDto } from './order-volume.dto'

export function summaryRegistrations(rows: FopOrganizationSummaryRow[], departments: readonly SalesDepartmentCode[], from: string, to: string) {
  const dates: string[] = []
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86_400_000) dates.push(new Date(at).toISOString().slice(0, 10))
  const registrationDepartments = SALES_DEPARTMENTS.filter(d => departments.includes(d.id)).map(d => ({ ...d, counts: dates.map(date => rows.filter(r => r.date === date && r.salesDepartmentCode === d.id).reduce((sum, row) => sum + row.count, 0)), salespeople: [] as { id: string; name: string; counts: number[] }[] }))
  const registrations = dates.map((date, i) => ({ date, count: registrationDepartments.reduce((sum, d) => sum + d.counts[i], 0) }))
  if (registrations.some(r => !Number.isSafeInteger(r.count))) throw new Error('Registration summary overflow')
  return { registrations, registrationDepartments }
}

/** Never constructs synthetic receipts or mixes aggregate grants with record grants. */
export function summaryReceipts(rows: FopOrganizationSummaryRow[], departments: readonly SalesDepartmentCode[], year: number, now: Date): ReturnType<typeof monthlyReceipts> {
  const base = monthlyReceipts([], year, departments.length > 0, now)
  const amount = (selected: FopOrganizationSummaryRow[]) => sumReceiptCents(selected.map(r => r.amount!)) / 100
  const series = (id: string, name: string, selected: FopOrganizationSummaryRow[]) => {
    const at = (month: string) => selected.filter(row => row.date.slice(0, 7) === month)
    const monthly = base.months.map(at), previous = at(base.previousMonth!)
    return { id, name, amounts: monthly.map(amount), previousAmount: amount(previous), breakdown: { fulfillment: monthly.map(rs => amount(rs.filter(r => r.sourceType === 'fulfillment'))), fullPaymentStock: monthly.map(rs => amount(rs.filter(r => r.sourceType === 'full_payment_stock'))) }, previousBreakdown: { fulfillment: amount(previous.filter(r => r.sourceType === 'fulfillment')), fullPaymentStock: amount(previous.filter(r => r.sourceType === 'full_payment_stock')) } }
  }
  return { ...base, marketingCenter: departments.length ? series('marketing', '统计部门合计', rows) : null,
    departments: SALES_DEPARTMENTS.filter(d => departments.includes(d.id)).map(d => ({ ...series(d.id, d.name, rows.filter(r => r.salesDepartmentCode === d.id)), salespeople: [] })) }
}

export function summaryOrderVolume(rows: FopOrganizationSummaryRow[], departments: readonly SalesDepartmentCode[], query: OrderVolumeQueryDto, now: Date) {
  const periods = orderVolumePeriods(query, now), today = businessDate(now)
  const selected = rows.filter(r => r.date <= today && (!query.department || r.salesDepartmentCode === query.department) && (query.warehouse === 'ALL' || r.warehouseCode === query.warehouse))
  const values = (list: FopOrganizationSummaryRow[]) => periods.map(period => {
    if (period.future) return null
    const value = list.filter(r => r.date >= period.from && r.date <= period.to).reduce((sum, r) => sum + r.count, 0)
    if (!Number.isSafeInteger(value)) throw new Error('Order summary overflow')
    return value
  })
  const series = (id: string, label: string, kind: 'total' | 'detail', list: FopOrganizationSummaryRow[], entityId?: string): VolumeSeries => {
    const counts = values(list), total = counts.reduce<number>((sum, n) => sum + (n ?? 0), 0)
    if (!Number.isSafeInteger(total)) throw new Error('Order summary overflow')
    return { id, label, kind, ...(entityId ? { entityId } : {}), total, values: counts, warehouses: { HZ: values(list.filter(r => r.warehouseCode === 'HZ')), SZ: values(list.filter(r => r.warehouseCode === 'SZ')), UNASSIGNED: values(list.filter(r => r.warehouseCode === 'UNASSIGNED')) } }
  }
  const total = series('total', '统计部门合计', 'total', selected)
  return { query: { ...query }, timeZone: BUSINESS_TIME_ZONE, asOf: now.toISOString(), total: total.total, customerCount: null, periods,
    series: [total, ...SALES_DEPARTMENTS.filter(d => departments.includes(d.id) && (!query.department || query.department === d.id)).map(d => series(`department:${d.id}`, d.name, 'detail', selected.filter(r => r.salesDepartmentCode === d.id), d.id))],
    options: { departments: SALES_DEPARTMENTS.filter(d => departments.includes(d.id)).map(d => ({ id: d.id, label: d.name })), objects: [] as { id: string; label: string }[] }, summaryOnly: true }
}

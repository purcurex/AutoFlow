import { BadRequestException } from '@nestjs/common'
import { FopOrder, FopReceipt, SALES_DEPARTMENTS } from './fop-data.types'
import { OrderVolumeQueryDto, OrderCustomerSearchDto } from './order-volume.dto'
import { FOP_CARRIERS as VOLUME_CARRIERS, normalizeCarrierCode } from './fop-carriers'
import { moneyToCents } from './fop-order-totals'
import { businessDate as dateOf, BUSINESS_TIME_ZONE } from './fop-business-time'
import { eligibleReceipts, summarizeReceipts, sumReceiptCents } from './fop-receipts'

const DAY = 86_400_000
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
export type VolumeWarehouse = 'HZ' | 'SZ' | 'UNASSIGNED'
export interface VolumePeriod { id: string; label: string; from: string; to: string; future: boolean }
export interface VolumeSeries {
  id: string; label: string; kind: 'total' | 'detail' | 'other' | 'unassigned'; entityId?: string; code?: string
  total: number; values: (number | null)[]; warehouses: Record<VolumeWarehouse, (number | null)[]>
  amounts?: { currency: 'USD'; total: number; values: (number | null)[]; warehouses: Record<VolumeWarehouse, (number | null)[]>; excludedOrderCount: number; breakdown: { fulfillment: number; fullPaymentStock: number } }
}
const warehouseOf = (o: FopOrder | FopReceipt): VolumeWarehouse => o.warehouseCode === 'HZ' || o.warehouseCode === 'SZ' ? o.warehouseCode : 'UNASSIGNED'
const carrierOf = (o: FopOrder) => normalizeCarrierCode(o.carrierCode)
const valid = (orders: FopOrder[]) => [...new Map(orders.filter(o => !o.cancelled && o.paymentStatus !== 'refunded' && o.reviewStatus === 'approved').map(o => [o.id, o])).values()]

export function orderVolumePeriods(query: OrderVolumeQueryDto, now = new Date()): VolumePeriod[] {
  const today = dateOf(now), year = Number(today.slice(0, 4))
  if (query.customerId && query.category !== 'customer') throw new BadRequestException('customerId requires customer category')
  if (query.objectId && !['carrier', 'salesperson'].includes(query.category)) throw new BadRequestException('Invalid object selection')
  const period = (from: string, to: string, label: string, id = from): VolumePeriod => ({ id, from, to, label, future: from > today })
  if (query.from !== undefined || query.to !== undefined) {
    const start = Date.parse(`${query.from}T00:00:00Z`), end = Date.parse(`${query.to}T00:00:00Z`)
    if (query.category !== 'customer' || query.grain !== undefined || query.year !== undefined || query.month !== undefined || query.weekOf !== undefined
      || !query.from || !query.to || !Number.isFinite(start) || !Number.isFinite(end)
      || iso(start) !== query.from || iso(end) !== query.to || query.from < '2020-01-01' || query.to > today || start > end) {
      throw new BadRequestException('Provide a valid customer date range without timeline parameters')
    }
    return Array.from({ length: (end - start) / DAY + 1 }, (_, index) => {
      const date = iso(start + index * DAY)
      return period(date, date, date)
    })
  }
  const selectedYear = query.year
  if (!selectedYear || !Number.isInteger(selectedYear) || selectedYear > year || selectedYear < 2020 || !['month', 'week', 'day'].includes(query.grain ?? '')) throw new BadRequestException('Invalid statistics year or timeline')
  if (query.grain === 'month') return Array.from({ length: selectedYear === year ? Number(today.slice(5, 7)) : 12 }, (_, i) => {
    const from = iso(Date.UTC(selectedYear, i, 1)), to = iso(Date.UTC(selectedYear, i + 1, 0))
    return period(from, to, `${i + 1}月`, from.slice(0, 7))
  })
  if (query.grain === 'day') {
    if (!query.month || query.month < 1 || query.month > 12) throw new BadRequestException('month is required for daily statistics')
    return Array.from({ length: new Date(Date.UTC(selectedYear, query.month, 0)).getUTCDate() }, (_, i) => {
      const date = iso(Date.UTC(selectedYear, query.month! - 1, i + 1))
      return period(date, date, date.slice(5))
    })
  }
  const anchor = query.weekOf ?? today, at = Date.parse(`${anchor}T00:00:00Z`)
  if (!Number.isFinite(at) || iso(at) !== anchor || anchor > today || anchor < '2020-01-01') throw new BadRequestException('Invalid week date')
  const monday = at - (new Date(at).getUTCDay() + 6) % 7 * DAY
  return Array.from({ length: 4 }, (_, i) => {
    const start = monday - (3 - i) * 7 * DAY, from = iso(start), to = iso(start + 6 * DAY)
    return period(from, to, `${from.slice(5)}—${to.slice(5)}`)
  })
}

function prepare(orders: FopOrder[], query: OrderVolumeQueryDto, now: Date, receipts: readonly FopReceipt[] = []) {
  const periods = orderVolumePeriods(query, now), today = dateOf(now)
  const authorized = valid(orders).filter(o => query.category === 'carrier' || !!o.salesDepartmentCode)
  const receiptCandidates = query.category === 'customer' ? eligibleReceipts(receipts, now).filter(r => !!r.salesDepartmentCode) : []
  const departments = SALES_DEPARTMENTS.filter(d => [...authorized, ...receiptCandidates].some(o => o.salesDepartmentCode === d.id)).map(d => ({ id: d.id, label: d.name }))
  const filterDept = (o: FopOrder | FopReceipt) => !query.department || o.salesDepartmentCode === query.department
  const options = {
    departments,
    objects: query.category === 'carrier' ? [...VOLUME_CARRIERS]
      : [...new Map([...authorized, ...receiptCandidates].filter(filterDept).filter(o => o.owner).map(o => [o.owner!.id, { id: o.owner!.id, label: o.owner!.name }])).values()].sort((a, b) => a.label.localeCompare(b.label)),
  }
  const rows = authorized.filter(o => {
    if (o.paymentStatus !== 'paid' || !o.paidAt) return false
    const date = dateOf(o.paidAt)
    return date && date <= today && new Date(o.paidAt).getTime() <= now.getTime()
      && date >= periods[0].from && date <= periods[periods.length - 1].to
      && filterDept(o) && (query.warehouse === 'ALL' || warehouseOf(o) === query.warehouse)
      && (!query.customerId || o.customerId === query.customerId)
      && (!query.objectId || (query.category === 'carrier' ? carrierOf(o as FopOrder) === query.objectId : o.owner?.id === query.objectId))
      && (query.category !== 'organization' || !!o.salesDepartmentCode)
  })
  const receiptRows = receiptCandidates.filter(r => dateOf(r.paidAt!) >= periods[0].from && dateOf(r.paidAt!) <= periods[periods.length - 1].to
    && filterDept(r) && (query.warehouse === 'ALL' || warehouseOf(r) === query.warehouse) && (!query.customerId || r.customerId === query.customerId))
  const groupFor = (o: FopOrder | FopReceipt) => {
    if (query.category === 'carrier') return { id: `carrier:${carrierOf(o as FopOrder)}`, label: VOLUME_CARRIERS.find(c => c.id === carrierOf(o as FopOrder))!.label, entityId: carrierOf(o as FopOrder) }
    if (query.category === 'customer') return { id: `customer:${o.customerId ?? 'unassigned'}`, label: o.customerName || '未关联客户', entityId: o.customerId, code: o.customerCode }
    if (query.category === 'organization' && !query.department) return { id: `department:${o.salesDepartmentCode}`, label: SALES_DEPARTMENTS.find(d => d.id === o.salesDepartmentCode)!.name, entityId: o.salesDepartmentCode }
    return { id: `employee:${o.owner?.id ?? 'unassigned'}`, label: o.owner?.name || '未关联业务员', entityId: o.owner?.id }
  }
  const groups = new Map<string, { id: string; label: string; entityId?: string; code?: string; count: number }>()
  if (query.category === 'carrier') {
    for (const carrier of VOLUME_CARRIERS) {
      if (!query.objectId || query.objectId === carrier.id) groups.set(`carrier:${carrier.id}`, { id: `carrier:${carrier.id}`, label: carrier.label, entityId: carrier.id, count: 0 })
    }
  }
  for (const o of [...rows, ...receiptRows]) {
    const group = groupFor(o), previous = groups.get(group.id)
    groups.set(group.id, { ...group, count: (previous?.count ?? 0) + ('sourceType' in o ? 0 : 1) })
  }
  const sorted = [...groups.values()].sort((a, b) => query.category === 'carrier'
    ? VOLUME_CARRIERS.findIndex(c => c.id === a.entityId) - VOLUME_CARRIERS.findIndex(c => c.id === b.entityId)
    : b.count - a.count || a.id.localeCompare(b.id))
  const limit = query.category === 'customer' ? 10 : query.category === 'salesperson' ? 5 : Infinity
  const top = sorted.filter(g => query.category !== 'customer' || (g.entityId && (query.customerId || g.count > 0))).slice(0, limit)
  const topIds = new Set(top.map(g => g.id))
  const hasOther = sorted.some(g => !topIds.has(g.id))
  const totalLabel = query.customerId ? '客户合计' : query.objectId ? '所选对象合计' : query.category === 'organization'
    ? `${SALES_DEPARTMENTS.find(d => d.id === query.department)?.name ?? '营销中心'}合计` : query.department ? `${SALES_DEPARTMENTS.find(d => d.id === query.department)?.name}合计` : '订单合计'
  const definitions = [
    { id: 'total', label: totalLabel, kind: 'total' as const },
    ...top.map(({ count: _count, ...g }) => ({ ...g, kind: (g.id.endsWith(':unassigned') ? 'unassigned' : 'detail') as VolumeSeries['kind'] })),
    ...(hasOther ? [{ id: 'other', label: query.category === 'customer' ? '其他客户' : '其他业务员', kind: 'other' as const }] : []),
  ]
  const matches = (o: FopOrder | FopReceipt, seriesId = 'total') => seriesId === 'total' || (seriesId === 'other' ? !topIds.has(groupFor(o).id) : groupFor(o).id === seriesId)
  return { rows, receiptRows, periods, definitions, options, matches }
}

export function aggregateOrderVolume(orders: FopOrder[], query: OrderVolumeQueryDto, now = new Date(), receipts?: readonly FopReceipt[]) {
  const { rows, receiptRows, periods, definitions, options, matches } = prepare(orders, query, now, receipts)
  const bucketByDate = new Map<string, number>()
  periods.forEach((period, index) => {
    for (let time = Date.parse(`${period.from}T00:00:00Z`); time <= Date.parse(`${period.to}T00:00:00Z`); time += DAY) bucketByDate.set(iso(time), index)
  })
  const values = (list: (FopOrder | FopReceipt)[], monetary = false) => {
    const counts = periods.map(p => p.future ? null : 0)
    for (const order of list) {
      const index = bucketByDate.get(dateOf(order.paidAt!))
      if (index !== undefined && counts[index] !== null) {
        counts[index]! += monetary ? moneyToCents(order.amount) : 1
        if (!Number.isSafeInteger(counts[index])) throw new Error('Statistics total exceeds safe precision')
      }
    }
    return monetary ? counts.map(value => value === null ? null : value / 100) : counts
  }
  const amounts = (list: FopReceipt[]): NonNullable<VolumeSeries['amounts']> => {
    const usd = list.filter(o => o.currency === 'USD')
    const totals = summarizeReceipts(usd)
    return { currency: 'USD', total: sumReceiptCents(usd.map(r => r.amount)) / 100, values: values(usd, true),
      warehouses: { HZ: values(usd.filter(o => warehouseOf(o) === 'HZ'), true), SZ: values(usd.filter(o => warehouseOf(o) === 'SZ'), true), UNASSIGNED: values([], true) }, excludedOrderCount: list.length - usd.length,
      breakdown: { fulfillment: totals.fulfillmentAmount, fullPaymentStock: totals.fullPaymentStockAmount } }
  }
  const series: VolumeSeries[] = definitions.map(def => {
    const list = rows.filter(o => matches(o, def.id))
    return { ...def, total: list.length, values: values(list), warehouses: { HZ: values(list.filter(o => warehouseOf(o) === 'HZ')), SZ: values(list.filter(o => warehouseOf(o) === 'SZ')), UNASSIGNED: values(list.filter(o => warehouseOf(o) === 'UNASSIGNED')) }, ...(query.category === 'customer' && receipts !== undefined ? { amounts: amounts(receiptRows.filter(r => matches(r, def.id))) } : {}) }
  })
  return { query: { ...query }, timeZone: BUSINESS_TIME_ZONE, asOf: now.toISOString(), total: rows.length, customerCount: new Set([...rows, ...receiptRows].map(o => o.customerId).filter(Boolean)).size, periods, series, options }
}

/** Rebuild ranking before narrowing the period, so “other” always matches the chart. */
export function orderVolumeDetails(orders: FopOrder[], query: OrderVolumeQueryDto & { seriesId?: string; periodId?: string; detailWarehouse?: VolumeWarehouse }, now = new Date(), receipts: readonly FopReceipt[] = []) {
  const { rows, periods, definitions, matches } = prepare(orders, query, now, receipts)
  if (query.seriesId && !definitions.some(d => d.id === query.seriesId)) return []
  const period = query.periodId ? periods.find(p => p.id === query.periodId) : undefined
  if (query.periodId && !period) throw new BadRequestException('Period is outside this query')
  return rows.filter(o => matches(o, query.seriesId) && (!query.detailWarehouse || warehouseOf(o) === query.detailWarehouse) && (!period || dateOf(o.paidAt!) >= period.from && dateOf(o.paidAt!) <= period.to))
    .sort((a, b) => Date.parse(b.paidAt!) - Date.parse(a.paidAt!) || a.id.localeCompare(b.id))
}

export function orderVolumeReceiptDetails(orders: FopOrder[], receipts: readonly FopReceipt[], query: OrderVolumeQueryDto & { seriesId?: string; periodId?: string; detailWarehouse?: VolumeWarehouse }, now = new Date()) {
  const { receiptRows, periods, definitions, matches } = prepare(orders, query, now, receipts)
  if (query.seriesId && !definitions.some(d => d.id === query.seriesId)) return []
  const period = query.periodId ? periods.find(p => p.id === query.periodId) : undefined
  if (query.periodId && !period) throw new BadRequestException('Period is outside this query')
  return receiptRows.filter(r => matches(r, query.seriesId) && (!query.detailWarehouse || warehouseOf(r) === query.detailWarehouse)
    && (!period || dateOf(r.paidAt!) >= period.from && dateOf(r.paidAt!) <= period.to))
}

export function searchOrderCustomers(orders: FopOrder[], query: OrderCustomerSearchDto, receipts: readonly FopReceipt[] = []) {
  const keyword = query.keyword.trim().toLowerCase()
  const customers = new Map<string, { id: string; code: string; name: string; departments: string[] }>()
  for (const o of [...valid(orders), ...eligibleReceipts(receipts)]) {
    if (!o.salesDepartmentCode || !o.customerId || query.department && o.salesDepartmentCode !== query.department) continue
    const entry = customers.get(o.customerId) ?? { id: o.customerId, code: o.customerCode ?? '', name: o.customerName, departments: [] }
    const dept = SALES_DEPARTMENTS.find(d => d.id === o.salesDepartmentCode)?.name ?? o.department?.name
    if (dept && !entry.departments.includes(dept)) entry.departments.push(dept)
    customers.set(o.customerId, entry)
  }
  const all = keyword ? [...customers.values()].filter(c => c.name.toLowerCase().includes(keyword) || c.code.toLowerCase().includes(keyword))
    .sort((a, b) => Number(b.code.toLowerCase() === keyword) - Number(a.code.toLowerCase() === keyword) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id)) : []
  return { items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: all.length, page: query.page, pageSize: query.pageSize }
}

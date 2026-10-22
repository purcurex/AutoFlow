import { aggregateOrderVolume, orderVolumeDetails, orderVolumePeriods, searchOrderCustomers } from './order-volume'
import { FopOrder } from './fop-data.types'
const now = new Date('2026-10-22T10:00:00Z')
const query = { category: 'customer', grain: 'month', year: 2026, warehouse: 'ALL' } as const
const order = (id: number, extra = {}) => ({ id: String(id), customerId: `c${id % 12}`, customerCode: `C${id % 12}`, customerName: `Customer ${id % 12}`, owner: { id: 'u1', name: '曹可滢 (Ruth)' }, salesDepartmentCode: 'sales1', warehouseCode: id % 2 ? 'SZ' : 'HZ', carrierCode: 'YT', paymentStatus: 'paid', cancelled: false, createdAt: '2026-10-10T00:00:00Z', paidAt: '2026-10-10T00:15:00Z', ...extra }) as FopOrder

describe('authorized order volume aggregation', () => {
  it('reconciles customer amounts across periods, warehouses and Top 10 plus Other without duplicating orders or mixing currencies', () => {
    const orders = Array.from({ length: 12 }, (_, i) => order(i, { amount: i === 0 ? 0.1 : 0.2, currency: 'USD' }))
    orders.push(order(20, { customerId: 'c0', warehouseCode: 'SZ', paidAt: '2026-09-30T16:00:00Z', amount: 0.2, currency: '' }))
    orders.push(order(21, { customerId: 'c0', warehouseCode: 'HZ', amount: 999, currency: 'EUR' }))
    const rows = [...orders, orders[0], order(30, { amount: 999, currency: 'USD', cancelled: true })]
    const result = aggregateOrderVolume(rows, query, now)
    expect(result.total).toBe(14)
    expect(result.series[0].amounts).toMatchObject({ currency: 'USD', total: 2.5, excludedOrderCount: 1 })
    expect(result.series[0].amounts!.values[9]).toBe(2.5)
    const customer = result.series.find(s => s.id === 'customer:c0')!
    expect(customer.total).toBe(3)
    expect(customer.amounts).toMatchObject({ total: 0.3, excludedOrderCount: 1 })
    expect(customer.amounts!.warehouses.HZ[9]).toBe(0.1)
    expect(customer.amounts!.warehouses.SZ[9]).toBe(0.2)
    expect(result.series.filter(s => s.kind !== 'total').reduce((cents, s) => cents + Math.round(s.amounts!.total * 100), 0)).toBe(250)
    for (const series of result.series) {
      const warehouseCents = Object.values(series.amounts!.warehouses).flat().reduce<number>((cents, n) => cents + Math.round((n ?? 0) * 100), 0)
      expect(warehouseCents).toBe(Math.round(series.amounts!.total * 100))
    }
    const other = result.series.find(s => s.id === 'other')!
    expect(other.amounts!.total).toBe(0.4)
    expect(orderVolumeDetails(rows, { ...query, seriesId: 'other' }, now).reduce((sum, o) => sum + o.amount, 0)).toBe(0.4)
    expect(aggregateOrderVolume(rows, { ...query, customerId: 'c0', warehouse: 'SZ' }, now).series[0].amounts!.total).toBe(0.2)
  })
  it('uses payment time consistently for totals, date buckets and detail ordering without falling back to creation time', () => {
    const rows = [
      order(1, { createdAt: '2026-08-01T00:00:00Z', paidAt: '2026-09-30T16:00:00Z' }),
      order(2, { createdAt: '2026-09-01T00:00:00Z', paidAt: '2026-09-30T15:59:59Z' }),
      order(3, { paidAt: null }), order(4, { paidAt: 'invalid' }),
      order(5, { paidAt: '2026-10-22T10:00:01Z' }),
      order(6, { paymentStatus: 'unpaid' }), order(7, { paymentStatus: 'refunded' }),
      order(8, { cancelled: true }),
      order(9, { createdAt: '2026-07-01T00:00:00Z', paidAt: '2026-10-22T18:00:00+08:00' }),
    ]
    const range = { category: 'customer', from: '2026-10-01', to: '2026-10-22', warehouse: 'ALL' } as const
    const result = aggregateOrderVolume(rows, range, now)
    expect(result.total).toBe(2)
    expect(result.series[0].values[0]).toBe(1)
    expect(result.series[0].values[21]).toBe(1)
    expect(orderVolumeDetails(rows, range, now).map(o => o.id)).toEqual(['9', '1'])
    expect(orderVolumeDetails(rows, { ...range, periodId: '2026-10-01' }, now).map(o => o.id)).toEqual(['1'])
    expect(aggregateOrderVolume(rows, { ...query, category: 'carrier' }, now).total).toBe(3)
  })

  it('keeps the six carriers in business order and reconciles missing and unknown carriers under Other', () => {
    const carrierQuery = { ...query, category: 'carrier' as const }
    const codes = ['YT', '4PX', 'WB', 'YW', 'JS', 'OTHER']
    const labels = ['云途YT', '4PX', '万邦WB', '燕文YW', '极速JS', '其他']
    const rows = ['JS', 'YW', 'WB', '4PX', 'YT', 'OTHER', 'UNASSIGNED', 'CUSTOM', undefined].map((carrierCode, i) => order(i, { carrierCode }))
    const result = aggregateOrderVolume(rows, carrierQuery, now)
    expect(result.options.objects).toEqual(codes.map((id, i) => ({ id, label: labels[i] })))
    expect(result.series.map(s => s.label)).toEqual(['订单合计', ...labels])
    expect(result.series.map(s => s.total)).toEqual([9, 1, 1, 1, 1, 1, 4])
    expect(orderVolumeDetails(rows, { ...carrierQuery, seriesId: 'carrier:OTHER' }, now).map(o => o.id).sort()).toEqual(['5', '6', '7', '8'])
    expect(aggregateOrderVolume(rows, { ...carrierQuery, objectId: 'OTHER' }, now).total).toBe(4)
    const empty = aggregateOrderVolume([], carrierQuery, now)
    expect(empty.series.slice(1).map(s => s.entityId)).toEqual(codes)
    expect(empty.series.every(s => s.total === 0)).toBe(true)
  })
  it('filters customer date ranges inclusively in Shanghai time and carries the same range into details', () => {
    const range = { category: 'customer', from: '2025-12-31', to: '2026-01-02', warehouse: 'ALL' } as const
    const rows = [
      order(1, { paidAt: '2025-12-30T15:59:59Z' }),
      order(2, { paidAt: '2025-12-30T16:00:00Z' }),
      order(3, { paidAt: '2026-01-02T15:59:59Z' }),
      order(4, { paidAt: '2026-01-02T16:00:00Z' }),
    ]
    const result = aggregateOrderVolume(rows, range, now)
    expect(result.periods.map(p => p.id)).toEqual(['2025-12-31', '2026-01-01', '2026-01-02'])
    expect(result.series[0].values).toEqual([1, 0, 1])
    expect(result.total).toBe(2)
    expect(result.query).toEqual(range)
    expect(orderVolumeDetails(rows, { ...range, periodId: '2026-01-02' }, now).map(o => o.id)).toEqual(['3'])
  })
  it('rejects incomplete, impossible, reversed, future and ambiguous customer ranges', () => {
    const range = { category: 'customer', from: '2026-01-01', to: '2026-10-22', warehouse: 'ALL' } as const
    for (const extra of [{ to: undefined }, { from: '2026-02-30' }, { from: '2026-10-23' }, { to: '2026-10-23' }, { grain: 'month', year: 2026 }, { category: 'carrier' }] as const) {
      expect(() => orderVolumePeriods({ ...range, ...extra }, now)).toThrow()
    }
  })
  it('keeps ten customers plus other, counts orders once and drills into the same remainder', () => {
    const orders = Array.from({ length: 78 }, (_, i) => order(i))
    const result = aggregateOrderVolume([...orders, orders[0], order(100, { cancelled: true }), order(101, { paymentStatus: 'refunded' })], query, now)
    expect(result.total).toBe(78)
    expect(result.series.filter(s => s.kind === 'detail')).toHaveLength(10)
    expect(result.series.filter(s => s.kind !== 'total').reduce((sum, s) => sum + s.total, 0)).toBe(78)
    const other = result.series.find(s => s.id === 'other')!
    expect(other.total).toBeGreaterThan(0)
    const szOther = orderVolumeDetails(orders, { ...query, seriesId: 'other', detailWarehouse: 'SZ' }, now)
    expect(szOther.length).toBe(other.warehouses.SZ.reduce<number>((s, n) => s + (n ?? 0), 0))
    expect(orderVolumeDetails(orders, { ...query, seriesId: 'other' }, now).length).toBe(other.total)
    for (const row of result.series) expect(Object.values(row.warehouses).flat().reduce<number>((s, n) => s + (n ?? 0), 0)).toBe(row.total)
  })
  it('returns current months, cross-year Monday weeks, leap days, and null future dates', () => {
    expect(orderVolumePeriods(query, now)).toHaveLength(10)
    const weeks = orderVolumePeriods({ ...query, grain: 'week', weekOf: '2026-01-01' }, now)
    expect(weeks).toHaveLength(4)
    expect(weeks[3].from).toBe('2025-12-29')
    expect(weeks[3].to).toBe('2026-01-04')
    expect(orderVolumePeriods({ ...query, grain: 'day', year: 2024, month: 2 }, now)).toHaveLength(29)
    const daily = aggregateOrderVolume([order(1)], { ...query, grain: 'day', month: 10 }, now)
    expect(daily.periods).toHaveLength(31)
    expect(daily.series[0].values[22]).toBeNull()
    expect(daily.series[0].values[21]).toBe(0)
  })
  it('uses UTC+8 payment dates and rejects invalid calendar queries', () => {
    const r = aggregateOrderVolume([order(1, { createdAt: '2026-08-01T00:00:00Z', paidAt: '2026-09-30T17:00:00Z' })], query, now)
    expect(r.series[0].values[9]).toBe(1)
    expect(() => orderVolumePeriods({ ...query, grain: 'day' }, now)).toThrow()
    expect(() => orderVolumePeriods({ ...query, grain: 'week', weekOf: '2026-02-30' }, now)).toThrow()
  })
  it('keeps same-name customers separate, requires a search and never substitutes all customers for an unknown ID', () => {
    const orders = [order(1, { customerName: 'Same' }), order(2, { customerName: 'Same' })]
    expect(searchOrderCustomers(orders, { keyword: 'Same', page: 1, pageSize: 1 }).total).toBe(2)
    expect(searchOrderCustomers(orders, { keyword: 'C2', page: 1, pageSize: 10 }).items[0].id).toBe('c2')
    expect(searchOrderCustomers(orders, { keyword: ' ', page: 1, pageSize: 10 }).items).toEqual([])
    expect(aggregateOrderVolume(orders, { ...query, customerId: 'secret' }, now).total).toBe(0)
  })
  it('keeps marketing totals equal to departments and a selected department equal to its people', () => {
    const orders = [order(1), order(2, { salesDepartmentCode: 'sales2' }), order(3, { salesDepartmentCode: undefined })]
    const center = aggregateOrderVolume(orders, { ...query, category: 'organization' }, now)
    expect(center.total).toBe(2)
    expect(center.series.slice(1).reduce((s, r) => s + r.total, 0)).toBe(2)
    const dept = aggregateOrderVolume(orders, { ...query, category: 'organization', department: 'sales1' }, now)
    expect(dept.total).toBe(1)
    expect(dept.series[1].label).toBe('曹可滢 (Ruth)')
  })
})

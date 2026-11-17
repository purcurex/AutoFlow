import { describe, expect, it } from 'vitest'
import { mockDashboardFreight } from '@/utils/mock-dashboard-freight'
import { chartAccessFixture } from './chart-access-fixtures'
import type { FreightQuery } from '@/api/fop-freight'

const access = chartAccessFixture().charts.find(chart => chart.chartId === 'freight')!
const now = new Date('2026-11-16T20:00:00Z')
const query: FreightQuery = { grain: 'month', year: 2026, warehouse: 'ALL' }
const mock = (changes: Partial<FreightQuery> = {}) => mockDashboardFreight({ ...query, ...changes }, access, now)
const cents = (amount: number) => Math.round(amount * 100)

describe('isolated dashboard freight mock', () => {
  it('uses reproducible synthetic data with no document or export capability', () => {
    const data = mock()
    expect(data).toEqual(mock())
    expect(data.source).toBe('mock')
    expect(data.chartAccess).toMatchObject({ visible: true, canViewDetails: false, canExport: false })
    expect(access.canViewDetails).toBe(true)
    expect(data.series).toHaveLength(7)
    expect(data.periods.at(-1)).toMatchObject({ to: '2026-11-17', partial: true })
    expect(mockDashboardFreight(query, { ...access, visible: false }, now).chartAccess.visible).toBe(false)
  })
  it.each(['month', 'week', 'year'] as const)('keeps %s warehouse, carrier and total amounts consistent', grain => {
    const all = mock({ grain }), hz = mock({ grain, warehouse: 'HZ' }), sz = mock({ grain, warehouse: 'SZ' })
    expect(cents(all.totals.amount)).toBe(cents(hz.totals.amount) + cents(sz.totals.amount))
    expect(all.billCount).toBe(hz.billCount + sz.billCount)
    expect(all.billCount).toBe(all.series.slice(1).reduce((total, row) => total + row.billCount, 0))
    for (let i = 0; i < all.periods.length; i++) {
      const total = all.series[0]!.values[i]!
      expect(cents(total.amount)).toBe(all.series.slice(1).reduce((sum, row) => sum + cents(row.values[i]!.amount), 0))
      expect(cents(total.previousAmount)).toBe(all.series.slice(1).reduce((sum, row) => sum + cents(row.values[i]!.previousAmount), 0))
      expect(cents(total.delta)).toBe(cents(total.amount) - cents(total.previousAmount))
    }
  })
  it('rolls the same daily facts into monthly and annual totals, including previous periods', () => {
    expect(mock().totals.amount).toBe(mock({ grain: 'year' }).series[0]!.values.at(-1)!.amount)
    expect(mock({grain:'year'}).periods.map(p=>p.id)).toEqual(['2026'])
    expect(mock().series[0]!.values[0]!.previousAmount).toBe(0)
    expect(()=>mock({year:2025})).toThrow()
    const next=mockDashboardFreight({...query,grain:'year',year:2027},access,new Date('2027-11-01T00:00:00Z'))
    expect(next.periods.map(p=>p.id)).toEqual(['2026','2027'])
  })
  it('handles a week crossing the year and rejects invalid dates', () => {
    expect(mock({ grain: 'week', weekOf: '2026-01-01' }).periods.at(-1)).toMatchObject({ from: '2026-01-01', to: '2026-01-04' })
    expect(() => mock({ grain: 'week', weekOf: '2026-02-30' })).toThrow()
    expect(() => mock({ grain: 'week', weekOf: '2026-12-31' })).toThrow()
  })
})

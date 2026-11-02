import { chartAccessFixture } from './chart-access-fixtures'
import type { FreightData, FreightPage, FreightQuery, FreightValue } from '@/api/fop-freight'

const value = (amount: number, previousAmount: number): FreightValue => ({ amount, previousAmount, delta: amount - previousAmount, percent: previousAmount ? (amount - previousAmount) / previousAmount * 100 : amount ? null : 0 })
export function freightData(query: FreightQuery = { grain: 'month', year: 2026, warehouse: 'ALL' }): FreightData {
  const carriers = [['YT', '云途YT'], ['4PX', '4PX'], ['WB', '万邦WB'], ['YW', '燕文YW'], ['JS', '极速JS'], ['OTHER', '其他']] as const
  const total = { id: 'total', label: '合计', kind: 'total' as const, totals: value(60, 30), values: [value(20, 10), value(40, 20)], billCount: 3 }
  return { chartAccess: chartAccessFixture().charts.find(item => item.chartId === 'freight')!, source: 'mock', query, timeZone: 'UTC+8', currency: 'USD', dateBasis: 'freight_confirmed_at', asOf: '2026-10-22T00:00:00Z', billCount: 3, totals: total.totals,
    periods: [{ id: '2026-09', label: '9月', from: '2026-09-01', to: '2026-09-30', previousFrom: '2026-08-01', previousTo: '2026-08-31', partial: false }, { id: '2026-10', label: '10月', from: '2026-10-01', to: '2026-10-31', previousFrom: '2026-09-01', previousTo: '2026-09-30', partial: true }],
    series: [total, ...carriers.map(([carrierCode, label], i) => ({ id: carrierCode, label, kind: 'detail' as const, carrierCode, totals: value(i === 0 ? 60 : 0, i === 0 ? 30 : 0), values: i === 0 ? total.values : [value(0, 0), value(0, 0)], billCount: i === 0 ? 3 : 0 }))] }
}
export const freightPage: FreightPage = {
  source: 'fop', timeZone: 'UTC+8', currency: 'USD', dateBasis: 'freight_confirmed_at', total: 21, page: 1, pageSize: 20,
  totals: { billCount: 21, amount: 600, originalAmounts: [{ currency: 'CNY', amount: 1400 }, { currency: 'USD', amount: 400 }] }, range: { from: '2026-10-01', to: '2026-10-31' },
  items: [{ id: 'freight-1', documentNumber: 'DEL-001', orderNumber: 'ORDER-001', trackingNumber: 'TRACK-001', carrierCode: 'YT', carrierName: '云途YT', channelName: 'YT standard', warehouseCode: 'HZ', warehouse: '杭州仓', customerId: 'c1', customerCode: 'C001', customerName: 'Freight Customer', organization: { id: 'org', name: 'HyperZone' }, department: { id: 'dept', name: '业务一部' }, owner: { id: 'owner', name: 'Alice' }, originalAmount: 140, originalCurrency: 'CNY', fxRateToUsd: 1 / 7, fxRateDate: '2026-10-01', fxRateSource: 'FOP daily USD rate', amount: 20, currency: 'USD', confirmedAt: '2026-09-30T16:05:00Z', reviewStatus: 'approved', costStatus: 'confirmed' }],
}

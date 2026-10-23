import type { SalesDepartmentCode } from './fop-data.types'
export type FreightCarrier = 'YT' | '4PX' | 'WB' | 'YW' | 'JS' | 'OTHER'
export type FreightGrain = 'month' | 'week' | 'year'
export interface FreightQuery {
  grain: FreightGrain; year: number; weekOf?: string
  warehouse: 'ALL' | 'HZ' | 'SZ'; carrierCode?: FreightCarrier
}
/** One current, confirmed actual-cost snapshot per delivery bill, NOT customer freight. */
export interface FopFreight {
  id: string; documentNumber: string; orderNumber: string; trackingNumber: string | null
  carrierCode: FreightCarrier; carrierName: string; channelName: string
  warehouseCode: 'HZ' | 'SZ'; warehouse: string
  customerId: string; customerCode: string; customerName: string
  organization?: { id: string; name: string }; department?: { id: string; name: string }; owner?: { id: string; name: string }
  salesDepartmentCode?: SalesDepartmentCode
  originalAmount: number; originalCurrency: string
  /** USD per one original currency unit. Required even when currency = USD (rate = 1). */
  fxRateToUsd: number; fxRateDate: string; fxRateSource: string
  amount: number; currency: 'USD'
  confirmedAt: string | null; reviewStatus: 'approved' | 'pending'; costStatus: 'confirmed' | 'pending'
}
export interface FopFreightCandidate extends FopFreight { tenantId: string; departmentPathIds?: string[] }
export interface FreightPeriod {
  id: string; label: string; from: string; to: string; partial: boolean
  previousFrom: string; previousTo: string
}
export interface FreightValue {
  amount: number; previousAmount: number; delta: number; percent: number | null
}
export interface FreightSeries {
  id: string; label: string; kind: 'total' | 'detail'; carrierCode?: FreightCarrier
  totals: FreightValue; values: FreightValue[]; billCount: number
}
export interface FreightData {
  source: 'mock' | 'fop'; query: FreightQuery; timeZone: 'UTC+8'; currency: 'USD'; dateBasis: 'freight_confirmed_at'; asOf: string
  periods: FreightPeriod[]; series: FreightSeries[]; totals: FreightValue; billCount: number
}
export interface FreightDetailsQuery extends FreightQuery {
  periodId?: string; comparisonPeriod?: 'current' | 'previous'; workbenchRole: 'sales' | 'procurement' | 'allocation' | 'dispatch' | 'warehouse'; page: number; pageSize: number
}
export interface FreightPage {
  source: 'mock' | 'fop'; timeZone: 'UTC+8'; currency: 'USD'; dateBasis: 'freight_confirmed_at'
  total: number; page: number; pageSize: number; items: FopFreight[]
  totals: { billCount: number; amount: number; originalAmounts: { currency: string; amount: number }[] }
  range: { from: string; to: string }
}

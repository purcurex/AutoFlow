import type { EffectiveChartAccess } from '../users/chart-permissions'
import type { FopReceipt, SalesDepartmentCode } from './fop-data.types'
export type PerformanceGrain = 'month' | 'week' | 'day'
export interface PerformanceQuery { from: string; to: string; grain: PerformanceGrain; ownerId?: string }
export interface PerformanceOwner { id: string; name: string; department: { id: string; name: string } }
/** A period contribution, NEVER a cumulative order profit to be summed repeatedly. */
export interface FopProfit {
  id: string; orderId: string; orderNumber: string; customerCode: string; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }; salesDepartmentCode: SalesDepartmentCode
  /** knownAt covers every constituent fact. cutoffAt is an exclusive boundary, not knowledge time. */
  recognitionMonth: string; recognitionDate: string | null; knownAt: string
  status: 'estimated' | 'settled'; settlementId: string | null; version: string
  /** Approved timestamp is required for settled rows; not an economic recognition date. */
  approvedAt: string | null; cutoffAt: string; freightBasis: 'estimated' | 'frozen'
  incomeAmount: number; adjustmentIncome: number; productCost: number; freightCost: number; refundCost: number; returnCost: number; otherCost: number; previousRecognizedProfit: number; roundingAdjustment: number
  /** USD period delta = income + adjustment - all costs - prior recognized profit + roundingAdjustment.
   * roundingAdjustment is an explicit FX rounding remainder, in cents, with abs <= 0.10 USD. */
  amount: number; currency: 'USD'
  originalAmount: number; originalCurrency: string; fxRateToUsd: number; fxRateDate: string; fxRateSource: string
}
export interface FopProfitCandidate extends FopProfit { tenantId: string; departmentPathIds?: string[] }
export interface PerformanceMetrics {
  orderAmount: number; stockAmount: number; collectionsAmount: number
  settledGrossProfit: number | null; estimatedGrossProfit: number; unallocatedCount: number
  receiptCount: number; profitCount: number
}
export interface PerformancePeriod extends PerformanceMetrics { id: string; label: string; from: string; to: string; profitStatus: 'none' | 'estimated' | 'settled' | 'mixed' | 'unallocated' }
export interface PerformanceUnallocated { month: string; amount: number; count: number }
export interface PerformanceData {
  chartAccess?: EffectiveChartAccess
  source: 'mock' | 'fop'; query: PerformanceQuery; timeZone: 'UTC+8'; currency: 'USD'; asOf: string
  owners: PerformanceOwner[]; selectedOwner: PerformanceOwner | null; canSelectOwner: boolean
  periods: PerformancePeriod[]; totals: PerformanceMetrics; unallocatedSettlements: PerformanceUnallocated[]
}
export interface PerformanceDetailsQuery extends PerformanceQuery { kind: 'receipts' | 'profit'; periodId?: string; page: number; pageSize: number }
export interface PerformancePage {
  chartAccess?: EffectiveChartAccess
  source: 'mock' | 'fop'; timeZone: 'UTC+8'; currency: 'USD'; asOf: string
  kind: 'receipts' | 'profit'; total: number; page: number; pageSize: number
  receipts: FopReceipt[]; profits: FopProfit[]; totals: PerformanceMetrics
  range: { from: string; to: string }; unallocatedSettlements: PerformanceUnallocated[]
}

import api from './index'
import type { FopReceipt } from './fop-receipts'

export type PerformanceGrain = 'month' | 'week' | 'day'
export interface PerformanceQuery { from: string; to: string; grain: PerformanceGrain; ownerId?: string }
export interface PerformanceOwner { id: string; name: string; department: { id: string; name: string } }
/** One period's net profit contribution, never a cumulative order balance. */
export interface FopProfit {
  id: string; orderId: string; orderNumber: string; customerCode: string; customerName: string
  owner: { id: string; name: string }; department: { id: string; name: string }; salesDepartmentCode: 'sales1' | 'sales2' | 'sales3' | 'sales4'
  recognitionMonth: string; recognitionDate: string | null; knownAt: string
  status: 'estimated' | 'settled'; settlementId: string | null; version: string
  approvedAt: string | null; cutoffAt: string; freightBasis: 'estimated' | 'frozen'
  incomeAmount: number; adjustmentIncome: number; productCost: number; freightCost: number; refundCost: number; returnCost: number; otherCost: number; previousRecognizedProfit: number; roundingAdjustment: number
  amount: number; currency: 'USD'
  originalAmount: number; originalCurrency: string; fxRateToUsd: number; fxRateDate: string; fxRateSource: string
}
export interface PerformanceMetrics {
  orderAmount: number; stockAmount: number; collectionsAmount: number
  settledGrossProfit: number | null; estimatedGrossProfit: number; unallocatedCount: number
  receiptCount: number; profitCount: number
}
export interface PerformancePeriod extends PerformanceMetrics { id: string; label: string; from: string; to: string; profitStatus: 'none' | 'estimated' | 'settled' | 'mixed' | 'unallocated' }
export interface PerformanceUnallocated { month: string; amount: number; count: number }
export interface PerformanceData {
  source: 'mock' | 'fop'; query: PerformanceQuery; timeZone: 'UTC+8'; currency: 'USD'; asOf: string
  owners: PerformanceOwner[]; selectedOwner: PerformanceOwner | null; canSelectOwner: boolean
  periods: PerformancePeriod[]; totals: PerformanceMetrics; unallocatedSettlements: PerformanceUnallocated[]
}
export interface PerformanceDetailsQuery extends PerformanceQuery { kind: 'receipts' | 'profit'; periodId?: string; page: number; pageSize: number }
export interface PerformancePage {
  source: 'mock' | 'fop'; timeZone: 'UTC+8'; currency: 'USD'; asOf: string
  kind: 'receipts' | 'profit'; total: number; page: number; pageSize: number
  receipts: FopReceipt[]; profits: FopProfit[]; totals: PerformanceMetrics
  range: { from: string; to: string }; unallocatedSettlements: PerformanceUnallocated[]
}
export const getSalesPerformance = (query: PerformanceQuery): Promise<PerformanceData> => api.get('/autoflow/integrations/fop/sales-performance', { params: query })
export const getSalesPerformanceDetails = (query: PerformanceDetailsQuery): Promise<PerformancePage> => api.get('/autoflow/integrations/fop/sales-performance/details', { params: query })

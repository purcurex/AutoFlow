import { analyticsQuery, type AnalyticsQueryOptions } from '@/utils/analytics-cache'
import api from './index'
import { assertCurrentSession, captureSession } from '@/utils/session'
export type LocalChartId = 'registrations'|'department_receipts'|'salesperson_receipts'|'order_volume'|'customer_orders'
export interface LocalAnalyticsQuery {chartId:LocalChartId;from:string;to:string;comparison?:'week'|'month';departmentId?:string;warehouseCode?:string;currency?:string;entityType?:'fulfillment'|'stock'}
export interface AnalyticsRow {dimension:string;id:string;label:string;currency:string|null;orderCount:number;amount:string|null;quantity:string|null;registrationCount?:number;customerOwnerName?:string|null;customerDepartmentName?:string|null;departmentId?:string|null;departmentName?:string|null;englishName?:string|null}
export interface LocalAnalyticsResult {
 customerContributionTargets?:{dimension:ContributionTarget['dimension'];id:string}[]
 comparison?:{mode:'week'|'month';available:boolean;current:{from:string;to:string;start:string;end:string};previous:{from:string;to:string;start:string;end:string};previousData:LocalAnalyticsResult|null;metrics:ComparisonMetric[];departmentMetrics?:ComparisonMetric[]}
 personalDepartmentId?:string
 departmentSummary?:LocalAnalyticsResult
 totalQuantity?:string|null
 defaultDepartmentId?:string|null
 selectedDepartmentId?:string|null
 registrationCount?:number;missingCreatedAtCount?:number;unmatchedOwnerCount?:number
 amountsByCurrency?:{currency:string;amount:string;orderCount:number}[]
 source:'local';chartId:LocalChartId;asOf:string;summaryOnly:boolean;rows:AnalyticsRow[];orderCount:number
 missingCurrencyCount:number;missingAmountCount:number;missingPaidAtCount:number
 /** No receipt date: current non-date filters apply; these records cannot be assigned to a payment period. */
 missingPaidAtBreakdown?:{unpaid:number;paid:number;unknown:number}
 currencies:string[];departments:{id:string;name:string}[];warehouses:{id:string;name:string}[]
}
export interface ComparisonMetric {key:string;current:number|null;previous:number|null;delta:number|null;percent:number|null;status:string}
export async function getLocalDashboardAnalytics(query:LocalAnalyticsQuery, options?:AnalyticsQueryOptions, workbench=false):Promise<LocalAnalyticsResult>{
 const session=captureSession()
 const endpoint=workbench?'/workbench/analytics/workbench':'/workbench/analytics/dashboard'
 const result=await analyticsQuery(endpoint,query,()=>api.get<LocalAnalyticsResult,LocalAnalyticsResult>(endpoint,{params:query}),options)
 assertCurrentSession(session)
 return result
}

export interface TrendTarget {dimension:'department'|'person'|'customer'|'country'|'warehouse';id:string;name:string}
export interface DashboardTrendQuery extends Omit<LocalAnalyticsQuery,'comparison'> {dimension:TrendTarget['dimension'];id:string;grain:'day'|'month'}
export interface TrendPoint {period:string;orderCount:number;registrationCount?:number;quantity:string|null;amount:string|null}
export interface DashboardTrendResult {
 source:'local';chartId:LocalChartId;dimension:TrendTarget['dimension'];id:string;grain:'day'|'month';from:string;to:string;asOf:string;summaryOnly:boolean;timeBasis:string
 orderCount:number;registrationCount?:number;totalQuantity:string|null;amount:string|null;currency:string|null;missingAmountCount:number;missingPaidAtCount:number;points:TrendPoint[]
}
export async function getLocalDashboardTrend(query:DashboardTrendQuery,options?:AnalyticsQueryOptions):Promise<DashboardTrendResult>{
 const session=captureSession(),endpoint='/workbench/analytics/dashboard/trend'
 const result=await analyticsQuery(endpoint,query,()=>api.get<DashboardTrendResult,DashboardTrendResult>(endpoint,{params:query}),options)
 assertCurrentSession(session);return result
}

export interface ContributionTarget {dimension:'department'|'person';id:string;name:string}
export interface CustomerContributionQuery extends Omit<LocalAnalyticsQuery,'comparison'> {dimension:ContributionTarget['dimension'];id:string}
export interface CustomerContributionResult {
 source:'local';dimension:ContributionTarget['dimension'];id:string;limit:5|10;from:string;to:string;asOf:string
 currency:'USD';amount:string|null;orderCount:number;customerCount:number;missingAmountCount:number;rows:AnalyticsRow[]
}
export async function getCustomerContribution(query:CustomerContributionQuery,options?:AnalyticsQueryOptions):Promise<CustomerContributionResult>{
 const session=captureSession(),endpoint='/workbench/analytics/dashboard/customer-contribution'
 const result=await analyticsQuery(endpoint,query,()=>api.get<CustomerContributionResult,CustomerContributionResult>(endpoint,{params:query}),options)
 assertCurrentSession(session);return result
}

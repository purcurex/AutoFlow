import api from './index'
import { analyticsQuery, peekAnalyticsQuery, type AnalyticsQueryOptions } from '@/utils/analytics-cache'
export type FreightDimension='carrier'|'channel'|'warehouse'|'country'|'customer'|'owner'|'department'
export interface LocalFreightQuery {grain:'week'|'month'|'year';year:number;weekOf?:string;monthOf?:string;range?:'last6months';warehouse?:string;currency:string;dimension:FreightDimension;departmentId?:string;ownerId?:string}
export interface FreightMeasure {amount:string;previousAmount:string|null;delta:string|null;percent:number|null}
export interface FreightSeries {id:string;label:string;totals:FreightMeasure;values:FreightMeasure[];billCount:number;departmentId?:string|null;departmentName?:string|null;englishName?:string|null}
export interface LocalFreightResult {
 source:'local';currency:string;asOf:string;query:LocalFreightQuery;canViewDetails?:boolean;canExport?:boolean
 periods:{id:string;label:string;from:string;to:string;previousFrom:string;previousTo:string;partial:boolean}[]
 totals:FreightMeasure;values:FreightMeasure[];billCount:number;averagePerBill:string|null;averagePerBillUsd?:string|null;weightKg:string;weightBillCount:number;costPerKg:string|null
 series:FreightSeries[];departmentSeries?:FreightSeries[]
 quality:{missingCurrencyCount:number;missingDateCount:number};currencies:string[];warehouses:string[];warehouseOptions?:{id:string;name:string}[]
}
export function peekLocalFreight(query:LocalFreightQuery):LocalFreightResult|undefined {
 const params={...query,currency:'CNY',dimension:'carrier' as const,allDimensions:true}
 const result=peekAnalyticsQuery<LocalFreightResult & {dimensionSeries:Record<FreightDimension,{series:FreightSeries[];departmentSeries?:FreightSeries[]}>}>('/workbench/analytics/freight:dimensions-v1',params)
 const view=result?.dimensionSeries?.[query.dimension]
 return result&&view?{...result,...view,query:{...query,currency:'CNY'}}:undefined
}
/** All dimension summaries share the same scope, source revision and expiry. */
export async function getLocalFreight(query:LocalFreightQuery,options?:AnalyticsQueryOptions):Promise<LocalFreightResult>{
 const params={...query,currency:'CNY',dimension:'carrier' as const,allDimensions:true}
 const result=await analyticsQuery<LocalFreightResult & {dimensionSeries:Record<FreightDimension,{series:FreightSeries[];departmentSeries?:FreightSeries[]}>}>('/workbench/analytics/freight:dimensions-v1',params,()=>api.get('/workbench/analytics/freight',{params}),options)
 const view=result.dimensionSeries?.[query.dimension]
 if(!view)throw new Error('Freight dimension summary unavailable')
 // Mutate this isolated cache clone to preserve its query-time metadata.
 result.series=view.series;result.departmentSeries=view.departmentSeries
 result.query={...query,currency:'CNY'}
 return result
}
export interface LocalFreightDetailsQuery extends LocalFreightQuery {dimensionId?:string;periodId?:string;page?:number;pageSize?:number}
export interface FreightDocument {id:string;documentNumber:string;confirmedAt:string;businessDay:string;amount:string;currency:'CNY';weightKg:string|null;orderNumber:string|null;trackingNumber:string|null;carrierName:string|null;channelName:string|null;ownerName:string|null;departmentName:string|null;country:string|null;warehouseName:string|null;customerName:string|null}
export interface LocalFreightDetailsResult {source:'local';currency:'CNY';asOf:string;from:string;to:string;items:FreightDocument[];total:number;amount:string;page:number;pageSize:number;canExport:boolean}
/** Source records never use the aggregate cache; every request rechecks authorization. */
export function getLocalFreightDetails(query:LocalFreightDetailsQuery):Promise<LocalFreightDetailsResult>{return api.get('/workbench/analytics/freight/details',{params:{...query,currency:'CNY'}})}
export function exportLocalFreightDetails(query:LocalFreightDetailsQuery):Promise<Blob>{return api.get('/workbench/analytics/freight/export',{params:{...query,currency:'CNY',page:undefined,pageSize:undefined},responseType:'blob',timeout:30000})}

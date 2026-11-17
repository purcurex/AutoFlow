import api from './index'
import { analyticsQuery, type AnalyticsQueryOptions } from '@/utils/analytics-cache'
export type FreightDimension='carrier'|'channel'|'warehouse'|'country'|'customer'|'owner'|'department'
export interface LocalFreightQuery {grain:'week'|'month'|'year';year:number;weekOf?:string;warehouse?:string;currency:string;dimension:FreightDimension}
export interface FreightMeasure {amount:string;previousAmount:string|null;delta:string|null;percent:number|null}
export interface FreightSeries {id:string;label:string;totals:FreightMeasure;values:FreightMeasure[];billCount:number;departmentId?:string|null;departmentName?:string|null;englishName?:string|null}
export interface LocalFreightResult {
 source:'local';currency:string;asOf:string;query:LocalFreightQuery
 periods:{id:string;label:string;from:string;to:string;previousFrom:string;previousTo:string;partial:boolean}[]
 totals:FreightMeasure;values:FreightMeasure[];billCount:number;averagePerBill:string|null;weightKg:string;weightBillCount:number;costPerKg:string|null
 series:FreightSeries[];departmentSeries?:FreightSeries[]
 quality:{missingCurrencyCount:number;missingDateCount:number};currencies:string[];warehouses:string[];warehouseOptions?:{id:string;name:string}[]
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

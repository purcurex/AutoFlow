import { BadRequestException } from '@nestjs/common'
import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { dimensions, freightRefs, freightWarehouseLabel, localFreightPeriods, localFreightSourceSql, LocalFreightQueryDto } from './local-freight'

export class LocalFreightDetailsDto extends LocalFreightQueryDto {
 @IsOptional() @IsString() @MaxLength(128) dimensionId?:string
 @IsOptional() @IsString() @MaxLength(32) periodId?:string
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) page=1
 @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(1000) pageSize=50
}
/** The aggregate and detail routes use the same native dispatch source and eligibility CTE. */
export function localFreightDetailsQuery(batchId:string,companyId:string,employeeIds:readonly string[],query:LocalFreightDetailsDto,now=new Date(),excludedIds?:string[],exportAll=false){
 const page=query.page??1,pageSize=query.pageSize??50
 if(query.currency!=='CNY'||!dimensions.includes(query.dimension)||!Number.isInteger(page)||page<1||!Number.isSafeInteger((page-1)*pageSize)||!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw new BadRequestException('Invalid freight details query')
 const periods=localFreightPeriods(query,now),period=query.periodId?periods.find(p=>p.id===query.periodId):undefined
 if(query.periodId&&!period)throw new BadRequestException('Period outside current freight timeline')
 if(query.dimensionId==='__others'&&!excludedIds)throw new BadRequestException('Other groups require verified chart scope')
 const from=period?.from??periods[0].from,to=period?.to??periods[periods.length-1].to
 const dimension=`coalesce(nullif(nullif(raw->>'${freightRefs[query.dimension][0]}',''),'0'),'unknown')`
 const params:unknown[]=[batchId,companyId,employeeIds,from,to,query.warehouse||null,'CNY',query.dimensionId==='__others'?null:query.dimensionId??null,excludedIds??null,exportAll?10001:pageSize,exportAll?0:(page-1)*pageSize]
 const sql=`${localFreightSourceSql}, matching AS MATERIALIZED (
 SELECT * FROM selected WHERE currency=$7 AND ($8::text IS NULL OR ${dimension}=$8) AND ($9::text[] IS NULL OR NOT (${dimension}=ANY($9::text[])))
 ), page AS (SELECT source_id AS id,document_number AS "documentNumber",occurred_at AS "confirmedAt",business_day::text AS "businessDay",amount::text AS amount,currency,kg::text AS "weightKg",
 nullif(raw->>'hzkj_order_no','') AS "orderNumber",nullif(raw->>'hzkj_logistics_orderno','') AS "trackingNumber",
 nullif(raw->>'hzkj_logistics_providers_name','') AS "carrierName",nullif(raw->>'hzkj_logistics_channel1_name','') AS "channelName",
 nullif(raw->>'hzkj_bizoperator_name','') AS "ownerName",nullif(raw->>'hzkj_sale_org_name','') AS "departmentName",
 nullif(raw->>'hzkj_country','') AS country,${freightWarehouseLabel} AS "warehouseName",nullif(raw->>'hzkj_customer_name','') AS "customerName"
 FROM matching ORDER BY occurred_at DESC,source_id LIMIT $10 OFFSET $11)
 SELECT (SELECT count(*)::int FROM matching) total,(SELECT coalesce(sum(amount),0)::text FROM matching) amount,
 (SELECT coalesce(jsonb_agg(page),'[]') FROM page) items`
 return {sql,params,from,to,page,pageSize}
}

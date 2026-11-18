import { BadRequestException } from '@nestjs/common'
import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator'
import DecimalJs from 'decimal.js'
const Decimal=DecimalJs.clone({precision:80})
type Decimal=DecimalJs
import { freightPeriods } from '../fop-data/fop-freight'
import { DAY_MS } from '../fop-data/fop-business-time'

export const dimensions = ['carrier','channel','warehouse','country','customer','owner','department'] as const
export class LocalFreightQueryDto {
 @IsIn(['week','month','year']) grain: 'week'|'month'|'year' = 'week'
 @Type(()=>Number) @IsInt() @Min(2026) year: number
 @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) weekOf?: string
 @IsOptional() @IsString() @MaxLength(128) warehouse?: string
 @IsOptional() @Matches(/^[A-Z]{3}$/) currency = 'CNY'
 @IsOptional() @IsIn(dimensions) dimension: typeof dimensions[number] = 'carrier'
 @IsOptional() @IsString() @MaxLength(128) departmentId?: string
 @IsOptional() @IsString() @MaxLength(128) ownerId?: string
 @IsOptional() @Transform(({value})=>value==='true'?true:value==='false'?false:value) @IsBoolean() allDimensions?: boolean
}
export const FREIGHT_START_DATE = '2026-06-01'
const isoDay=(time:number)=>new Date(time).toISOString().slice(0,10)
export function localFreightPeriods(query: LocalFreightQueryDto, now = new Date()) {
 // Keep shared validation, but freight displays the full selected-year timeline.
 const {periods:base} = freightPeriods({grain:query.grain,year:query.year,weekOf:query.weekOf,warehouse:'ALL'},now)
 let periods:typeof base
 if(query.grain==='week'){
  const end=base[base.length-1].to
  if(end<FREIGHT_START_DATE||(query.weekOf&&query.weekOf<FREIGHT_START_DATE))throw new BadRequestException('Freight starts in June 2026')
  const start=query.year===2026?FREIGHT_START_DATE:`${query.year}-01-01`
  periods=[]
  for(let cursor=Date.parse(start);isoDay(cursor)<=end;){
   const from=isoDay(cursor),weekday=(new Date(cursor).getUTCDay()+6)%7
   const naturalEnd=isoDay(cursor+(6-weekday)*DAY_MS),to=naturalEnd>end?end:naturalEnd
   periods.push({id:from,label:`${from.slice(5)} — ${to.slice(5)}`,from,to,previousFrom:isoDay(cursor-7*DAY_MS),previousTo:isoDay(Date.parse(to)-7*DAY_MS),partial:weekday!==0||to!==naturalEnd||base[base.length-1].partial&&to===end})
   cursor=Date.parse(naturalEnd)+DAY_MS
  }
 }else{
  periods=base.filter(p=>p.to>=FREIGHT_START_DATE).map(p=>p.from<FREIGHT_START_DATE?{
   ...p,from:FREIGHT_START_DATE,label:`${p.label}（6月起）`,partial:true,previousFrom:'2025-06-01',
  }:p)
 }
 if(!periods.length)throw new BadRequestException('Freight starts in June 2026')
 return periods.map(p=>{
  if(!p.partial)return p
  const days=Math.round((Date.parse(p.to)-Date.parse(p.from))/DAY_MS)
  const previousEnd=isoDay(Date.parse(p.previousFrom)+days*DAY_MS)
  return {...p,previousTo:previousEnd<p.previousTo?previousEnd:p.previousTo}
 })
}

export const freightRefs: Record<typeof dimensions[number], [string,string]> = {
 carrier:['hzkj_logistics_providers_id','hzkj_logistics_providers_name'],
 channel:['hzkj_logistics_channel1_number','hzkj_logistics_channel1_name'],
 warehouse:['hzkj_basedatafield_number','hzkj_basedatafield_number'], country:['hzkj_country','hzkj_country'],
 customer:['hzkj_customer_id','hzkj_customer_name'],owner:['hzkj_bizoperator_id','hzkj_bizoperator_name'],
 department:['hzkj_sale_org_id','hzkj_sale_org_name'],
}
export const freightWarehouseLabel="coalesce(nullif(raw->>'hzkj_basedatafield_name',''),(SELECT name FROM warehouse_names w WHERE w.id=raw->>'hzkj_basedatafield_number'),nullif(raw->>'hzkj_basedatafield_number',''),'未填写')"
export const localFreightSourceSql=`WITH warehouse_names AS MATERIALIZED (
 SELECT facts->'warehouse'->>'number' id,max(facts->'warehouse'->>'name') name
 FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND company_id=$2
 AND nullif(facts->'warehouse'->>'number','') IS NOT NULL AND nullif(trim(facts->'warehouse'->>'name'),'') IS NOT NULL
 GROUP BY facts->'warehouse'->>'number' HAVING count(DISTINCT facts->'warehouse'->>'name')=1
 ), source AS (
 SELECT source_id,document_number,raw,occurred_at,raw_status,
 CASE WHEN raw->>'hzkj_actual_freight' ~ '^-?[0-9]{1,40}(\\.[0-9]{1,20})?$' THEN (raw->>'hzkj_actual_freight')::numeric END amount,
 CASE WHEN upper(trim(raw->>'hzkj_textfield1'))='RMB' THEN 'CNY' WHEN upper(trim(raw->>'hzkj_textfield1')) ~ '^[A-Z]{3}$' THEN upper(trim(raw->>'hzkj_textfield1')) END currency,
 CASE WHEN raw->>'hzkj_actual_weight' ~ '^[0-9]{1,20}(\\.[0-9]{1,20})?$'
 THEN CASE WHEN (raw->>'hzkj_actual_weight')::numeric>0 THEN CASE lower(trim(raw->>'hzkj_textfield2')) WHEN 'kg' THEN (raw->>'hzkj_actual_weight')::numeric WHEN 'g' THEN (raw->>'hzkj_actual_weight')::numeric/1000 END END END kg
 FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND entity_type='dispatch' AND company_id=$2
 AND raw->>'hzkj_bizoperator_id'=ANY($3::text[])
 ), dated AS (SELECT *, (occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS business_day FROM source WHERE ($6::text IS NULL OR raw->>'hzkj_basedatafield_number'=$6)),
 selected AS (SELECT * FROM dated
 WHERE raw_status='C' AND amount>0 AND business_day BETWEEN greatest($4::date,'2026-01-01'::date) AND $5::date)`
/** Aggregate native dispatch headers, never expand product or tracking entries. */
export function localFreightQuery(batchId:string,companyId:string,employeeIds:readonly string[],query:LocalFreightQueryDto,now=new Date()) {
 if(!dimensions.includes(query.dimension??'carrier'))throw new BadRequestException('Invalid freight dimension')
 const periods=localFreightPeriods(query,now)
 const from=periods.reduce((a,p)=>p.previousFrom<a?p.previousFrom:a,periods[0].from)
 const to=periods[periods.length-1].to
 const params=[batchId,companyId,employeeIds,from,to,query.warehouse||null]

 const dimensionValues=(query.allDimensions?dimensions:[query.dimension??'carrier']).map(d=>{
  const [id,name]=freightRefs[d]
  return `('${d}',coalesce(nullif(nullif(raw->>'${id}',''),'0'),'unknown'),${d==='warehouse'?freightWarehouseLabel:`coalesce(nullif(raw->>'${name}',''),'未填写')`})`
 }).join(',')
 const sql=`${localFreightSourceSql},
 buckets AS (SELECT business_day::text AS "day",currency,d.dimension,d.dimension_id,max(d.label) label,sum(amount)::text amount,count(*)::int bill_count,
 sum(kg)::text weight_kg,coalesce(sum(amount) FILTER(WHERE kg IS NOT NULL),0)::text weighted_amount,count(kg)::int weight_count
 FROM selected CROSS JOIN LATERAL (VALUES ${dimensionValues}) d(dimension,dimension_id,label)
 WHERE currency IS NOT NULL GROUP BY business_day,currency,d.dimension,d.dimension_id)
 SELECT coalesce((SELECT jsonb_agg(buckets) FROM buckets),'[]') buckets,
 (SELECT coalesce(jsonb_agg(w ORDER BY w.name,w.id),'[]') FROM (SELECT raw->>'hzkj_basedatafield_number' id,max(${freightWarehouseLabel}) name FROM source WHERE nullif(raw->>'hzkj_basedatafield_number','') IS NOT NULL GROUP BY raw->>'hzkj_basedatafield_number') w) warehouse_options,
 (SELECT count(*)::int FROM selected WHERE currency IS NULL AND business_day BETWEEN $7::date AND $5::date) missing_currency,
 (SELECT count(*)::int FROM dated WHERE raw_status='C' AND amount>0 AND occurred_at IS NULL) missing_date,
 (SELECT coalesce(jsonb_agg(DISTINCT currency) FILTER(WHERE currency IS NOT NULL),'[]') FROM selected) currencies,
 (SELECT coalesce(jsonb_agg(DISTINCT raw->>'hzkj_basedatafield_number') FILTER(WHERE nullif(raw->>'hzkj_basedatafield_number','') IS NOT NULL),'[]') FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND entity_type='dispatch' AND company_id=$2 AND raw->>'hzkj_bizoperator_id'=ANY($3::text[])) warehouses`
 params.push(periods[0].from)
 return {sql,params}
}
type Bucket={dimension?:typeof dimensions[number];day:string;currency:string;dimension_id:string;label:string;amount:string;bill_count:number;weight_kg:string|null;weighted_amount:string;weight_count:number}
const sum=(rows:Bucket[],key:'amount'|'weight_kg'|'weighted_amount')=>rows.reduce((s,r)=>s.plus(r[key]??0),new Decimal(0))
const comparison=(a:Decimal,b:Decimal,available=true)=>({amount:a.toFixed(),previousAmount:available?b.toFixed():null,delta:available?a.minus(b).toFixed():null,percent:available&&!b.isZero()?a.minus(b).div(b).mul(100).toNumber():null})
type FreightMember={employeeId:string;englishName?:string;departmentId?:string;departmentName?:string}
export function aggregateLocalFreight(buckets:Bucket[],query:LocalFreightQueryDto,now=new Date(),members:readonly FreightMember[]=[]) {
 const periods=localFreightPeriods(query,now), rows=buckets.filter(r=>r.currency===(query.currency??'CNY'))
 const inRange=(r:Bucket,from:string,to:string)=>r.day>=from&&r.day<=to
 const current=rows.filter(r=>periods.some(p=>inRange(r,p.from,p.to)))
 const total=(matching:Bucket[])=>{
  const values=periods.map(p=>comparison(sum(matching.filter(r=>inRange(r,p.from,p.to)),'amount'),sum(matching.filter(r=>inRange(r,p.previousFrom,p.previousTo)),'amount'),p.previousFrom>='2026-01-01'))
  return {values,totals:comparison(values.reduce((s,v)=>s.plus(v.amount),new Decimal(0)),values.reduce((s,v)=>s.plus(v.previousAmount??0),new Decimal(0)),values.every(v=>v.previousAmount!==null)),billCount:matching.filter(r=>periods.some(p=>inRange(r,p.from,p.to))).reduce((n,r)=>n+r.bill_count,0)}
 }
 const byId=new Map<string,Bucket[]>(),amounts=new Map<string,Decimal>()
 for(const r of rows){const group=byId.get(r.dimension_id)??[];group.push(r);byId.set(r.dimension_id,group)}
 for(const r of current)amounts.set(r.dimension_id,(amounts.get(r.dimension_id)??new Decimal(0)).plus(r.amount))
 const ids=[...byId.keys()].sort((a,b)=>(amounts.get(b)??new Decimal(0)).cmp(amounts.get(a)??0)||a.localeCompare(b))
 if(query.dimension==='department'){
  const rank=(id:string)=>{const i=['业务一部','业务二部','业务三部','业务四部'].indexOf(byId.get(id)![0].label);return i<0?99:i}
  ids.sort((a,b)=>rank(a)-rank(b)||byId.get(a)![0].label.localeCompare(byId.get(b)![0].label,'zh-CN'))
 }
 const owners=query.dimension==='owner'
 const member=(id:string)=>{const matches=members.filter(m=>m.employeeId===id);return matches.length===1?matches[0]:undefined}
 if(owners){
  const rank=(id:string)=>{const index=['业务一部','业务二部','业务三部','业务四部'].indexOf(member(id)?.departmentName??'');return index<0?99:index}
  ids.sort((a,b)=>rank(a)-rank(b))
 }
 const top=owners?ids:ids.slice(0,10)
 const series=top.map(id=>({id,label:byId.get(id)![0].label,...(owners?{departmentId:member(id)?.departmentId??null,departmentName:member(id)?.departmentName??null,englishName:member(id)?.englishName??null}:{}),...total(byId.get(id)!)}))
 if(!owners&&ids.length>10)series.push({id:'__others',label:'其他',...total(rows.filter(r=>!top.includes(r.dimension_id)))})
 const departmentSeries=owners?[...new Set(ids.map(id=>member(id)?.departmentId??'unknown'))].map(id=>({id,label:members.find(m=>m.departmentId===id)?.departmentName??'归属待确认',...total(rows.filter(r=>(member(r.dimension_id)?.departmentId??'unknown')===id))})):undefined
 const all=total(rows), amount=sum(current,'amount'),weight=sum(current,'weight_kg')
 return {source:'local' as const,currency:query.currency??'CNY',query,periods,series,...(owners?{departmentSeries}:{}),...all,
  averagePerBill:all.billCount?amount.div(all.billCount).toDecimalPlaces(4).toFixed():null,
  weightKg:weight.toFixed(),weightBillCount:current.reduce((n,r)=>n+r.weight_count,0),
  costPerKg:weight.gt(0)?sum(current,'weighted_amount').div(weight).toDecimalPlaces(4).toFixed():null,
  dateBasis:'freight_confirmed_at',timeZone:'UTC+8'}
}

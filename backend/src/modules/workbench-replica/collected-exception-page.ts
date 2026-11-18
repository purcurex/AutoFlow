import { stockExceptionCandidatesSql } from './collected-stock-exceptions'
import { persistedExceptionDisplaySql } from './persisted-exception-read'
import { collectedWhere } from './collected-workbench-query'

/** One snapshot for count, country options and page. Membership reads indexed committed marks. */
export function collectedExceptionPage(batchId:string,employeeIds:readonly string[]|null,query:Record<string,any>,page:number,pageSize:number,stockOptions:{includeStock?:boolean;includeUnassigned?:boolean}={}) {
 const base=collectedWhere(batchId,employeeIds,{...query,shippingCountryCode:undefined})
 const params=[...base.params],bind=(value:unknown)=>{params.push(value);return `$${params.length}`}
 const country=query.shippingCountryCode?`country_code=${bind(query.shippingCountryCode)}`:'TRUE'
 const limit=bind(query.projection==='count'?0:pageSize),offset=bind((page-1)*pageSize)
 const stock=stockOptions.includeStock?stockExceptionCandidatesSql(employeeIds,query,bind,!!stockOptions.includeUnassigned):null
 const position=query.projection==='count'?'0::bigint':`row_number() OVER (ORDER BY ${base.orderBy})`
 return {params,sql:`WITH ${stock?`stock_exception_rows AS MATERIALIZED (${stock}), `:''}fulfillment_matched AS MATERIALIZED (
  SELECT source_id,country_code,total_quantity,paid_at,consumer_paid_at,display FROM hz_fop_collected_orders WHERE ${base.where}
 ), matched AS MATERIALIZED (
  SELECT source_id,country_code,total_quantity,${position} AS position
  FROM (SELECT * FROM fulfillment_matched ${stock?'UNION ALL SELECT source_id,country_code,total_quantity,paid_at,consumer_paid_at,display FROM stock_exception_rows':''}) all_matches
 ), selected AS MATERIALIZED (SELECT * FROM matched WHERE ${country}),
 page AS (SELECT source_id,position FROM selected ORDER BY position LIMIT ${limit} OFFSET ${offset})
 SELECT (SELECT count(*)::int FROM selected) AS total,
  (SELECT CASE WHEN count(total_quantity)=count(*) AND count(*)>0 THEN sum(total_quantity) END FROM selected) AS quantity,
  coalesce((SELECT jsonb_agg(country_code ORDER BY country_code) FROM (SELECT DISTINCT country_code FROM matched WHERE country_code IS NOT NULL) countries),'[]'::jsonb) AS countries,
  coalesce((SELECT jsonb_agg(payload ORDER BY position) FROM (
   SELECT p.position,jsonb_build_object('display',${persistedExceptionDisplaySql('o')},'raw',o.raw) AS payload FROM page p JOIN hz_fop_collected_orders o ON o.batch_id=$1 AND o.source_id=p.source_id
   ${stock?`UNION ALL SELECT p.position,jsonb_build_object('display',s.display,'raw',s.raw,'documentKind','stock_order') FROM page p JOIN stock_exception_rows s USING(source_id)`:''}
  ) result_rows),'[]'::jsonb) AS rows`}
}

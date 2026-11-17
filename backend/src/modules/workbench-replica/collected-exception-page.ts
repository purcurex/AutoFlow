import { collectedWhere } from './collected-workbench-query'

/** Evaluate expensive membership once per request, under one PostgreSQL snapshot.
 * Keep the materialized set narrow; fetch full documents only for the requested page.
 * Country options deliberately ignore only the selected country, never authorization.
 */
export function collectedExceptionPage(batchId:string, employeeIds:readonly string[]|null, query:Record<string,any>, page:number, pageSize:number) {
 const base=collectedWhere(batchId,employeeIds,{...query,shippingCountryCode:undefined})
 const params=[...base.params]
 const bind=(value:unknown)=>{params.push(value);return `$${params.length}`}
 const country=query.shippingCountryCode?`country_code=${bind(query.shippingCountryCode)}`:'TRUE'
 const limit=bind(query.projection==='count'?0:pageSize),offset=bind((page-1)*pageSize)
 return {params,sql:`WITH matched AS MATERIALIZED (
  SELECT source_id,country_code,total_quantity,row_number() OVER (ORDER BY ${base.orderBy}) AS position
  FROM hz_fop_collected_orders WHERE ${base.where}
 ), selected AS MATERIALIZED (SELECT * FROM matched WHERE ${country}),
 page AS (SELECT source_id,position FROM selected ORDER BY position LIMIT ${limit} OFFSET ${offset})
 SELECT (SELECT count(*)::int FROM selected) AS total,
  (SELECT CASE WHEN count(total_quantity)=count(*) AND count(*)>0 THEN sum(total_quantity) END FROM selected) AS quantity,
  coalesce((SELECT jsonb_agg(country_code ORDER BY country_code) FROM (SELECT DISTINCT country_code FROM matched WHERE country_code IS NOT NULL) countries),'[]'::jsonb) AS countries,
  coalesce((SELECT jsonb_agg(jsonb_build_object('display',o.display,'raw',o.raw) ORDER BY p.position)
   FROM page p JOIN hz_fop_collected_orders o ON o.batch_id=$1 AND o.source_id=p.source_id),'[]'::jsonb) AS rows`}
}

import { persistedExceptionDisplaySql } from './persisted-exception-read'
import { collectedWhere } from './collected-workbench-query'

/** Completed dispatch membership is shared by page, totals and country facets in one snapshot.
 * Anomalies are supplementary labels, evaluated only for the visible page.
 * Full documents and supplementary purchase status are loaded only after pagination.
 */
export function collectedDispatchPage(batchId:string, employeeIds:readonly string[]|null, query:Record<string,any>, page:number, pageSize:number) {
 const base=collectedWhere(batchId,employeeIds,{...query,shippingCountryCode:undefined})
 if(!base.dispatchCandidateWhere)throw new Error('Completed dispatch query required')
 const params=[...base.params]
 const bind=(value:unknown)=>{params.push(value);return `$${params.length}`}
 const country=query.shippingCountryCode?`country_code=${bind(query.shippingCountryCode)}`:'TRUE'
 const limit=bind(query.projection==='count'?0:pageSize),offset=bind((page-1)*pageSize)
 const position=query.projection==='count'?'0::bigint':`row_number() OVER (ORDER BY ${base.orderBy})`
 const purchaseHeader=`coalesce((SELECT jsonb_build_object('sourcePurchaseStatus',a.raw->>'hzkj_purchase_status','sourcePurchaseStatusName',a.raw->>'hzkj_purchase_status_title')
  FROM hz_fop_collected_analytics_facts a
  WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.source_id=hz_fop_collected_orders.source_id AND a.entity_type='fulfillment'
   AND a.company_id=(SELECT company_id FROM hz_fop_collected_batches WHERE id=a.batch_id)
   AND a.document_number=hz_fop_collected_orders.order_number AND a.raw->>'hzkj_orderstatus'=hz_fop_collected_orders.raw_order_status
   AND a.facts->'scope'->>'verified'='true' AND a.captured_at >= (SELECT source_as_of FROM hz_fop_collected_batches WHERE id=a.batch_id)
   AND a.raw ? 'hzkj_purchase_status'), '{}'::jsonb)`
 return {params,sql:`WITH candidates AS MATERIALIZED (
  SELECT batch_id,source_id,country_code,total_quantity,${position} AS position
  FROM hz_fop_collected_orders
  WHERE ${base.dispatchCandidateWhere}
 ), matched AS MATERIALIZED (
  SELECT source_id,country_code,total_quantity,position FROM candidates hz_fop_collected_orders
  WHERE TRUE
 ), selected AS MATERIALIZED (SELECT * FROM matched WHERE ${country}),
 page AS (SELECT source_id,position FROM selected ORDER BY position LIMIT ${limit} OFFSET ${offset})
 SELECT (SELECT count(*)::int FROM selected) AS total,
  (SELECT CASE WHEN count(total_quantity)=count(*) AND count(*)>0 THEN sum(total_quantity) END FROM selected) AS quantity,
  coalesce((SELECT jsonb_agg(country_code ORDER BY country_code) FROM (SELECT DISTINCT country_code FROM matched WHERE country_code IS NOT NULL) countries),'[]'::jsonb) AS countries,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'display',${persistedExceptionDisplaySql()} || jsonb_build_object('logisticsInfo',display->'dispatchLogistics') || ${purchaseHeader},'raw',raw) ORDER BY p.position)
   FROM page p JOIN hz_fop_collected_orders ON batch_id=$1 AND hz_fop_collected_orders.source_id=p.source_id),'[]'::jsonb) AS rows`}
}

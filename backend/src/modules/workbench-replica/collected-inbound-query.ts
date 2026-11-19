import { warehouseCodes } from './warehouse-codes'
import { virtualLineSqlV5 } from './physical-business-sql-v5'
import { persistedExceptionDisplaySql } from './persisted-exception-read'
/** Classify each physical line once. Keep full documents and receipt joins out of counts.
 * Candidate raw values remain TOAST references; materializing expanded JSON for every order
 * would spill tens of MB before pagination. Virtual identity rules mirror the frozen v5 predicate.
 */
export function collectedInboundQuery(batchId:string,employeeIds:readonly string[]|null,query:Record<string,any>){
 const params:unknown[]=[batchId],clauses=['o.batch_id=$1'],bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`o.owner_employee_id=ANY(${bind(employeeIds)}::text[])`)
 if(query.warehouseCode)clauses.push(`o.warehouse_code=ANY(${bind(warehouseCodes(query.warehouseCode))}::text[])`)
 if(query.search?.trim()){
  const term=bind('%'+query.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')
  clauses.push(`(o.search_text LIKE ${term} OR o.source_id IN(SELECT l->>'sourceOrderId' FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND lower(e.display->>'number') LIKE ${term})${query.searchOwnerIds?.length?` OR o.owner_employee_id=ANY(${bind(query.searchOwnerIds)}::text[])`:''})`)
 }
 clauses.push(`o.raw @? '$.hzkj_orders_billentry[*] ? (@.hzkj_entrypurc_status == "3" || @.hzkj_entrypurc_status == "4")'`)
 const numeric=(key:string)=>`CASE WHEN line->>'${key}' ~ '^([0-9]{1,15})([.][0-9]{1,6})?$' THEN (line->>'${key}')::numeric END`
 const cte=`WITH candidates AS MATERIALIZED (
  SELECT o.source_id,o.paid_at,o.raw FROM hz_fop_collected_orders o WHERE ${clauses.map(c=>`(${c})`).join(' AND ')}
 ), virtual_products AS MATERIALIZED (
  SELECT source_id,raw->>'number' number FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='product' AND raw->'hzkj_good'->>'hzkj_good_carrier'='2'
 ), marked_lines AS MATERIALIZED (
  SELECT o.source_id order_id,line->>'id' line_id,line->>'pid' parent_id,line->>'hzkj_entrypurc_status' state,
   ${numeric('hzkj_purcqty')} purchase_qty,${numeric('hzkj_instock_qty')} received_qty,
   (NOT ${virtualLineSqlV5('line')} AND vp.source_id IS NULL AND coalesce(line->>'requiresPhysicalOutbound','true')<>'false') physical
  FROM candidates o CROSS JOIN LATERAL jsonb_array_elements(o.raw->'hzkj_orders_billentry') line
  LEFT JOIN virtual_products vp ON vp.source_id=coalesce(line->'hzkj_local_sku'->>'id',line->>'hzkj_local_sku_id') AND (coalesce(line->'hzkj_local_sku'->>'number',line->>'hzkj_local_sku_number') IS NULL OR vp.number=coalesce(line->'hzkj_local_sku'->>'number',line->>'hzkj_local_sku_number'))
 ), physical_lines AS MATERIALIZED (
  SELECT l.* FROM marked_lines l WHERE l.physical AND NOT EXISTS(SELECT 1 FROM marked_lines child WHERE child.order_id=l.order_id AND child.parent_id=l.line_id AND child.parent_id<>'0' AND child.physical)
 ), shipped AS (SELECT order_id FROM physical_lines GROUP BY order_id HAVING bool_or(state IN ('3','4'))),
 inbound_stats AS MATERIALIZED (
  SELECT l.order_id,
  CASE WHEN bool_or(purchase_qty IS NULL OR received_qty IS NULL OR state IS NULL OR state NOT IN ('0','1','2','3','4')) THEN 'unknown'
   WHEN bool_and(state='3' AND received_qty=purchase_qty) THEN 'completed'
   WHEN bool_or(received_qty>0 OR state='3') THEN 'partial' ELSE 'pending' END status,
  sum(purchase_qty) quantity,sum(received_qty) inbound_quantity,sum(greatest(purchase_qty-received_qty,0)) pending_quantity
  FROM physical_lines l JOIN shipped s USING(order_id) WHERE purchase_qty IS NULL OR purchase_qty>0 GROUP BY l.order_id
 )`
 const from='FROM candidates o JOIN inbound_stats n ON n.order_id=o.source_id',unclassifiedParams=[...params]
 return {cte,from:`${from} WHERE n.status ${query.status?'='+bind(query.status):"IN ('pending','partial')"}`,unclassifiedFrom:`${from} WHERE n.status='unknown'`,unclassifiedParams,params}
}

/** Count, quantities and page membership share one PostgreSQL statement snapshot. */
export function collectedInboundPage(batchId:string,employeeIds:readonly string[]|null,query:Record<string,any>,page:number,pageSize:number){
 const q=collectedInboundQuery(batchId,employeeIds,query),params=[...q.params,pageSize,(page-1)*pageSize]
 return {params,sql:`${q.cte}, matched AS MATERIALIZED (
  SELECT n.*,o.paid_at ${q.from}
 ), page AS MATERIALIZED (
  SELECT * FROM matched ORDER BY paid_at ASC NULLS LAST,order_id LIMIT $${q.params.length+1} OFFSET $${q.params.length+2}
 ), line_facts AS (
  SELECT l.order_id,jsonb_agg(jsonb_build_object('id',line_id,'purchaseQuantity',purchase_qty,'inboundQuantity',received_qty,
   'pendingQuantity',CASE WHEN purchase_qty IS NULL OR received_qty IS NULL THEN NULL ELSE greatest(purchase_qty-received_qty,0) END,'rawPurchaseStatus',state) ORDER BY line_id) inbound_lines
  FROM physical_lines l JOIN page p ON p.order_id=l.order_id GROUP BY l.order_id
 ), receipt_links AS (
  SELECT l->>'sourceOrderId' order_id,jsonb_agg(DISTINCT jsonb_build_object('id',e.source_id,'number',e.display->>'number',
   'shippedAt',e.raw->>'hzkj_shipping_time','carrier',e.raw->>'hzkj_logistics_company','trackingNumber',e.raw->>'hzkj_waybill_number')) notices
  FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l
  WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified'
   AND e.display->>'rawCancelStatus'='A' AND l->>'sourceOrderId' IN (SELECT order_id FROM page) GROUP BY l->>'sourceOrderId'
 ) SELECT
  (SELECT row_to_json(t) FROM (SELECT count(*)::int total,sum(quantity) quantity,sum(inbound_quantity) inbound_quantity,sum(pending_quantity) pending_quantity FROM matched) t) counts,
  (SELECT count(*)::int FROM inbound_stats WHERE status='unknown') unclassified,
  coalesce((SELECT jsonb_agg(r ORDER BY r.paid_at ASC NULLS LAST,r.order_id) FROM (
   SELECT ${persistedExceptionDisplaySql('o')} AS display,o.raw,p.*,f.inbound_lines,coalesce(r.notices,'[]'::jsonb) notices
   FROM page p JOIN hz_fop_collected_orders o ON o.batch_id=$1 AND o.source_id=p.order_id
   LEFT JOIN line_facts f ON f.order_id=p.order_id LEFT JOIN receipt_links r ON r.order_id=p.order_id
  ) r),'[]'::jsonb) rows`}
}

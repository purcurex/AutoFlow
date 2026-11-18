import { warehouseCodes } from './warehouse-codes'
import { collectedPhysicalLineSqlV5 } from './physical-business-sql-v5'

/** Same-fulfillment shipment and receipt facts; a receipt-notice relation is optional display data. */
export function collectedInboundQuery(batchId:string,employeeIds:readonly string[]|null,query:Record<string,any>){
 const params:unknown[]=[batchId],clauses=['o.batch_id=$1'],bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`o.owner_employee_id=ANY(${bind(employeeIds)}::text[])`)
 if(query.warehouseCode)clauses.push(`o.warehouse_code=ANY(${bind(warehouseCodes(query.warehouseCode))}::text[])`)
 if(query.search?.trim()){
  const term=bind('%'+query.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')
  clauses.push(`(o.search_text LIKE ${term} OR o.source_id IN(SELECT l->>'sourceOrderId' FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND lower(e.display->>'number') LIKE ${term})${query.searchOwnerIds?.length?` OR o.owner_employee_id=ANY(${bind(query.searchOwnerIds)}::text[])`:''})`)
 }
 const physicalLine=collectedPhysicalLineSqlV5('line')
 // Indexed coarse candidate check; the exact physical-line predicate still runs before counting/paging.
 clauses.push(`o.raw @? '$.hzkj_orders_billentry[*] ? (@.hzkj_entrypurc_status == "3" || @.hzkj_entrypurc_status == "4")'`)
 clauses.push(`EXISTS(SELECT 1 FROM jsonb_array_elements(o.raw->'hzkj_orders_billentry') line WHERE line->>'hzkj_entrypurc_status' IN ('3','4') AND ${physicalLine})`)
 const numeric=(key:string)=>`CASE WHEN line->>'${key}' ~ '^([0-9]{1,15})([.][0-9]{1,6})?$' THEN (line->>'${key}')::numeric END`
 const cte=`WITH inbound_orders AS MATERIALIZED (
 SELECT o.* FROM hz_fop_collected_orders o WHERE ${clauses.map(c=>`(${c})`).join(' AND ')}
 ), physical_lines AS (
 SELECT o.source_id order_id,line->>'id' line_id,line->>'hzkj_entrypurc_status' state,
 ${numeric('hzkj_purcqty')} purchase_qty,${numeric('hzkj_instock_qty')} received_qty
 FROM inbound_orders o CROSS JOIN LATERAL jsonb_array_elements(o.raw->'hzkj_orders_billentry') line
 WHERE ${physicalLine}
 ), line_facts AS (
 SELECT order_id,jsonb_agg(jsonb_build_object('id',line_id,'purchaseQuantity',purchase_qty,'inboundQuantity',received_qty,'pendingQuantity',CASE WHEN purchase_qty IS NULL OR received_qty IS NULL THEN NULL ELSE greatest(purchase_qty-received_qty,0) END,'rawPurchaseStatus',state)) inbound_lines FROM physical_lines GROUP BY order_id
 ), inbound_stats AS (
 SELECT order_id,
 CASE WHEN bool_or(purchase_qty IS NULL OR received_qty IS NULL OR state IS NULL OR state NOT IN ('0','1','2','3','4')) THEN 'unknown'
 WHEN bool_and(state='3' AND received_qty=purchase_qty) THEN 'completed'
 WHEN bool_or(received_qty>0 OR state='3') THEN 'partial' ELSE 'pending' END status,
 sum(purchase_qty) quantity,sum(received_qty) inbound_quantity,sum(greatest(purchase_qty-received_qty,0)) pending_quantity
 FROM physical_lines WHERE purchase_qty IS NULL OR purchase_qty>0 GROUP BY order_id
 ), receipt_links AS MATERIALIZED (
 SELECT l->>'sourceOrderId' order_id,jsonb_agg(DISTINCT jsonb_build_object('id',e.source_id,'number',e.display->>'number','shippedAt',e.raw->>'hzkj_shipping_time','carrier',e.raw->>'hzkj_logistics_company','trackingNumber',e.raw->>'hzkj_waybill_number')) notices
 FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l
 WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND e.display->>'rawCancelStatus'='A' AND l->>'sourceOrderId' IN (SELECT source_id FROM inbound_orders) GROUP BY l->>'sourceOrderId'
 ), notices AS (
 SELECT o.source_id order_id,coalesce(s.status,'unknown') status,s.quantity,s.inbound_quantity,s.pending_quantity,f.inbound_lines,coalesce(r.notices,'[]'::jsonb) notices
 FROM inbound_orders o LEFT JOIN inbound_stats s ON s.order_id=o.source_id LEFT JOIN line_facts f ON f.order_id=o.source_id LEFT JOIN receipt_links r ON r.order_id=o.source_id
 WHERE s.order_id IS NOT NULL OR jsonb_array_length(coalesce(o.raw->'hzkj_orders_billentry','[]'::jsonb))=0
 )`
 const from='FROM inbound_orders o JOIN notices n ON n.order_id=o.source_id',unclassifiedParams=[...params]
 return {cte,from:`${from} WHERE n.status ${query.status?'='+bind(query.status):"IN ('pending','partial')"}`,unclassifiedFrom:`${from} WHERE n.status='unknown'`,unclassifiedParams,params}
}

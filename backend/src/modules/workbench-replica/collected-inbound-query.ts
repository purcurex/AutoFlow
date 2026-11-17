import { warehouseCodes } from './warehouse-codes'
/** Receipt -> purchase entry -> fulfillment entry. Never infer links from SKU. */
export function collectedInboundQuery(batchId:string,employeeIds:readonly string[]|null,query:Record<string,any>){
 const params:unknown[]=[batchId],clauses=['o.batch_id=$1'],bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`o.owner_employee_id=ANY(${bind(employeeIds)}::text[])`)
 if(query.warehouseCode)clauses.push(`o.warehouse_code=ANY(${bind(warehouseCodes(query.warehouseCode))}::text[])`)
 if(query.search?.trim())clauses.push(`(o.search_text LIKE ${bind('%'+query.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')} OR lower(n.notices::text) LIKE $${params.length}${query.searchOwnerIds?.length?` OR o.owner_employee_id=ANY(${bind(query.searchOwnerIds)}::text[])`:''})`)
 if(query.status)clauses.push(`n.status=${bind(query.status)}`)
 const cte=`WITH purchase_lines AS MATERIALIZED (
 SELECT l->>'purchaseLineId' purchase_line_id,r->>'orderId' order_id,l->>'fulfillmentLineId' order_line_id
 FROM hz_fop_collected_entities p CROSS JOIN LATERAL jsonb_array_elements(p.display->'rows') r CROSS JOIN LATERAL jsonb_array_elements(r->'lines') l
 WHERE p.batch_id=$1 AND p.entity_type='purchase' AND l->>'fulfillmentLineId' IS NOT NULL
 ), notice_lines AS MATERIALIZED (
 SELECT DISTINCT l->>'sourceOrderId' order_id, p.order_line_id,e.source_id notice_id,e.display->>'number' notice_number
 FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l
 JOIN purchase_lines p ON p.purchase_line_id=l->>'purchaseLineId' AND p.order_id=l->>'sourceOrderId'
 WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified'
 AND e.display->>'rawCancelStatus'='A' AND l->>'productSource'='verified_receipt_purchase_fulfillment_link'
 ), linked AS MATERIALIZED (
 SELECT n.*,line->>'hzkj_entrypurc_status' state
 FROM hz_fop_collected_orders o CROSS JOIN LATERAL jsonb_array_elements(o.raw->'hzkj_orders_billentry') line
 JOIN notice_lines n ON n.order_id=o.source_id AND n.order_line_id=line->>'id'
 WHERE o.batch_id=$1
 ), notices AS (
 SELECT order_id,jsonb_agg(DISTINCT jsonb_build_object('id',notice_id,'number',notice_number)) notices,
 CASE WHEN bool_or(state='3') THEN 'partial' ELSE 'pending' END status
 FROM linked GROUP BY order_id HAVING bool_or(state IN ('0','1','2','4'))
 )`
 return {cte,from:`FROM hz_fop_collected_orders o JOIN notices n ON n.order_id=o.source_id WHERE ${clauses.map(c=>`(${c})`).join(' AND ')}`,params}
}

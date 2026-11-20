import { inboundStockParcelCtes } from './inbound-stock-parcels'
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
 if(query.mode==='selected')clauses.push(`o.source_id=ANY(${bind(query.orderIds)}::text[])`)
 if(query.warehouseCode)clauses.push(`o.warehouse_code=ANY(${bind(warehouseCodes(query.warehouseCode))}::text[])`)
 if(query.search?.trim()){
  const term=bind('%'+query.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')
  clauses.push(`(o.search_text LIKE ${term} OR o.source_id IN(SELECT l->>'sourceOrderId' FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND lower(concat_ws(' ',e.display->>'number',e.raw->>'hzkj_waybill_number',e.raw->>'hzkj_logistics_company')) LIKE ${term})${query.searchOwnerIds?.length?` OR o.owner_employee_id=ANY(${bind(query.searchOwnerIds)}::text[])`:''})`)
 }
 clauses.push(`o.raw @? '$.hzkj_orders_billentry[*] ? (@.hzkj_entrypurc_status == "3" || @.hzkj_entrypurc_status == "4")'`)
 const numeric=(key:string)=>`CASE WHEN line->>'${key}' ~ '^([0-9]{1,15})([.][0-9]{1,6})?$' THEN (line->>'${key}')::numeric END`
 const cte=`WITH candidates AS MATERIALIZED (
  SELECT o.source_id,o.paid_at,o.raw FROM hz_fop_collected_orders o WHERE ${clauses.map(c=>`(${c})`).join(' AND ')}
 ), virtual_products AS MATERIALIZED (
  SELECT source_id,raw->>'number' number FROM hz_fop_collected_entities WHERE batch_id=$1 AND entity_type='product' AND raw->'hzkj_good'->>'hzkj_good_carrier'='2'
 ), marked_lines AS MATERIALIZED (
  SELECT o.source_id order_id,line->>'id' line_id,line->>'pid' parent_id,line->>'hzkj_entrypurc_status' state,
   ${numeric('hzkj_qty')} demand_qty,${numeric('hzkj_purcqty')} purchase_qty,${numeric('hzkj_instock_qty')} received_qty,
   (NOT ${virtualLineSqlV5('line')} AND vp.source_id IS NULL AND coalesce(line->>'requiresPhysicalOutbound','true')<>'false') physical
  FROM candidates o CROSS JOIN LATERAL jsonb_array_elements(o.raw->'hzkj_orders_billentry') line
  LEFT JOIN virtual_products vp ON vp.source_id=coalesce(line->'hzkj_local_sku'->>'id',line->>'hzkj_local_sku_id') AND (coalesce(line->'hzkj_local_sku'->>'number',line->>'hzkj_local_sku_number') IS NULL OR vp.number=coalesce(line->'hzkj_local_sku'->>'number',line->>'hzkj_local_sku_number'))
 ), physical_lines AS MATERIALIZED (
  SELECT l.* FROM marked_lines l WHERE l.physical AND NOT EXISTS(SELECT 1 FROM marked_lines child WHERE child.order_id=l.order_id AND child.parent_id=l.line_id AND child.parent_id<>'0' AND child.physical)
 ), shipped AS (SELECT order_id FROM physical_lines GROUP BY order_id HAVING bool_or(state IN ('3','4'))),
 inbound_stats AS MATERIALIZED (
  SELECT l.order_id,
  CASE WHEN bool_or(demand_qty IS NULL OR received_qty IS NULL OR state IS NULL OR state NOT IN ('0','1','2','3','4')) THEN 'unknown'
   WHEN bool_and(received_qty>=demand_qty) THEN 'completed'
   WHEN bool_or(received_qty>0 OR state='3') THEN 'partial' ELSE 'pending' END status,
  sum(demand_qty) quantity,sum(received_qty) inbound_quantity,sum(greatest(demand_qty-received_qty,0)) pending_quantity
  FROM physical_lines l JOIN shipped s USING(order_id) WHERE demand_qty IS NULL OR demand_qty>0 GROUP BY l.order_id
 )`
 const from='FROM candidates o JOIN inbound_stats n ON n.order_id=o.source_id',unclassifiedParams=[...params]
 return {cte,from:`${from} WHERE n.status ${query.status?'='+bind(query.status):"IN ('pending','partial')"}`,unclassifiedFrom:`${from} WHERE n.status='unknown'`,unclassifiedParams,params}
}

/** Count, quantities and page membership share one PostgreSQL statement snapshot. */
export function collectedInboundPage(batchId:string,employeeIds:readonly string[]|null,query:Record<string,any>,page:number,pageSize:number){
 const q=collectedInboundQuery(batchId,employeeIds,query),params=[...q.params]
 const parcel=query.view==='parcel'
 const direction=query.shippedSort==='asc'?'ASC':'DESC'
 const orderSort=query.shippedSort?`shipped_at ${direction} NULLS LAST`:'paid_at ASC NULLS LAST'
 const stockCtes=parcel?inboundStockParcelCtes(params,employeeIds,query):''
 params.push(pageSize,(page-1)*pageSize)
 const limitSlot=params.length-1,offsetSlot=params.length
 const parcelCtes=`${stockCtes}parcel_members AS MATERIALIZED (
 SELECT DISTINCT m.order_id,m.paid_at,e.source_id notice_id,e.display->>'number' notice_number,nullif(trim(e.raw->>'hzkj_waybill_number'),'') tracking_number,nullif(trim(e.raw->>'hzkj_logistics_company'),'') carrier,e.raw->>'hzkj_shipping_time' shipped_at,
 CASE WHEN nullif(trim(e.raw->>'hzkj_waybill_number'),'') IS NOT NULL THEN jsonb_build_array(trim(e.raw->>'hzkj_logistics_company'),trim(e.raw->>'hzkj_waybill_number'))::text ELSE 'notice:'||coalesce(e.source_id,'order:'||m.order_id) END parcel_key
 FROM matched m LEFT JOIN (hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l) ON e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND e.display->>'rawCancelStatus'='A' AND l->>'sourceOrderId'=m.order_id
 UNION ALL SELECT NULL::text,NULL::timestamptz,notice_id,notice_number,tracking_number,carrier,shipped_at,'stock:'||stock_id FROM stock_pending
 ), parcels AS MATERIALIZED (SELECT parcel_key,max(carrier) carrier,max(tracking_number) tracking_number,max(shipped_at) shipped_at,coalesce(array_agg(DISTINCT order_id) FILTER(WHERE order_id IS NOT NULL),ARRAY[]::text[]) order_ids,array_agg(DISTINCT notice_number) FILTER(WHERE notice_number IS NOT NULL) notice_numbers,max(paid_at) paid_at FROM parcel_members ${query.parcelType==='direct'?"WHERE parcel_key NOT LIKE 'stock:%'":query.parcelType==='stock'?"WHERE parcel_key LIKE 'stock:%'":''} GROUP BY parcel_key),
 parcel_page AS MATERIALIZED (SELECT p.*,coalesce(d.stock_lines,'[]'::jsonb) stock_lines FROM parcels p LEFT JOIN stock_parcel_details d USING(parcel_key) ORDER BY shipped_at ${direction} NULLS LAST,parcel_key LIMIT $${limitSlot} OFFSET $${offsetSlot}),`
 return {params,sql:`${q.cte}, ${query.shippedSort&&!parcel?`shipment_times AS MATERIALIZED (SELECT l->>'sourceOrderId' order_id,max(nullif(e.raw->>'hzkj_shipping_time','')) shipped_at FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified' AND e.display->>'rawCancelStatus'='A' GROUP BY l->>'sourceOrderId'),`:''} matched AS MATERIALIZED (
  SELECT n.*,o.paid_at${query.shippedSort&&!parcel?',st.shipped_at':''} ${q.from.replace(' WHERE ',query.shippedSort&&!parcel?' LEFT JOIN shipment_times st ON st.order_id=o.source_id WHERE ':' WHERE ')}
 ), ${parcel?parcelCtes:''} page AS MATERIALIZED (
  ${parcel?'SELECT * FROM matched WHERE order_id IN (SELECT unnest(order_ids) FROM parcel_page)':`SELECT * FROM matched ORDER BY ${orderSort},order_id LIMIT $${limitSlot} OFFSET $${offsetSlot}`}
 ), line_facts AS (
  SELECT l.order_id,jsonb_agg(jsonb_build_object('id',line_id,'demandQuantity',demand_qty,'purchaseQuantity',purchase_qty,'inboundQuantity',received_qty,
   'pendingQuantity',CASE WHEN demand_qty IS NULL OR received_qty IS NULL THEN NULL ELSE greatest(demand_qty-received_qty,0) END,'rawPurchaseStatus',state) ORDER BY line_id) inbound_lines
  FROM physical_lines l JOIN page p ON p.order_id=l.order_id GROUP BY l.order_id
 ), receipt_links AS (
  SELECT l->>'sourceOrderId' order_id,jsonb_agg(DISTINCT jsonb_build_object('id',e.source_id,'number',e.display->>'number',
   'shippedAt',e.raw->>'hzkj_shipping_time','carrier',e.raw->>'hzkj_logistics_company','trackingNumber',e.raw->>'hzkj_waybill_number')) notices
  FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l
  WHERE e.batch_id=$1 AND e.entity_type='receipt_notice' AND e.display->'association'->>'state'='verified'
   AND e.display->>'rawCancelStatus'='A' AND l->>'sourceOrderId' IN (SELECT order_id FROM page) GROUP BY l->>'sourceOrderId'
 ) SELECT
  ${parcel?`(SELECT count(*)::int FROM parcels) parcel_total,coalesce((SELECT jsonb_agg(p ORDER BY p.shipped_at ${direction} NULLS LAST,p.parcel_key) FROM parcel_page p),'[]'::jsonb) parcels,`:''}
  (SELECT row_to_json(t) FROM (SELECT count(*)::int total,sum(quantity) quantity,sum(inbound_quantity) inbound_quantity,sum(pending_quantity) pending_quantity FROM matched) t) counts,
  (SELECT count(*)::int FROM inbound_stats WHERE status='unknown') unclassified,
  coalesce((SELECT jsonb_agg(r ORDER BY ${query.shippedSort&&!parcel?`r.shipped_at ${direction} NULLS LAST`:'r.paid_at ASC NULLS LAST'},r.order_id) FROM (
   SELECT ${persistedExceptionDisplaySql('o')} AS display,o.raw,p.*,f.inbound_lines,coalesce(r.notices,'[]'::jsonb) notices
   FROM page p JOIN hz_fop_collected_orders o ON o.batch_id=$1 AND o.source_id=p.order_id
   LEFT JOIN line_facts f ON f.order_id=p.order_id LEFT JOIN receipt_links r ON r.order_id=p.order_id
  ) r),'[]'::jsonb) rows`}
}

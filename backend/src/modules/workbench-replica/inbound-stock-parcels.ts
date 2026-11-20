import { warehouseCodes } from './warehouse-codes'
/** Package facts and stock-wide consumption are separate: the source has no package allocation. */
export function inboundStockParcelCtes(params:unknown[],employees:readonly string[]|null,query:Record<string,any>){
 const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 const scope=bind(employees),clauses=[`$1=e.batch_id`,`e.entity_type='receipt_notice'`,`e.display->'association'->>'state'='verified'`,`e.display->>'rawCancelStatus'='A'`,
 `coalesce(e.display->>'rawWmsStatus','') NOT IN ('15','20','25','30')`,`s.display->>'purchaseStatus' IS DISTINCT FROM 'received'`,
 `(${scope}::text[] IS NULL OR s.owner_employee_id=ANY(${scope}::text[]))`]
 if(query.warehouseCode)clauses.push(`coalesce(e.display->>'warehouseCode',s.display->>'warehouseCode')=ANY(${bind(warehouseCodes(query.warehouseCode))}::text[])`)
 if(query.mode==='selected')clauses.push('false')
 const number=(field:string)=>`CASE WHEN r->>'${field}' ~ '^[0-9]+([.][0-9]+)?$' THEN (r->>'${field}')::numeric END`
 if(query.search?.trim()){
  const term=bind('%'+query.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%')
  clauses.push(`(lower(concat_ws(' ',s.display->>'stockNumber',s.display->>'customerName',e.display->>'number',e.raw->>'hzkj_waybill_number',e.raw->>'hzkj_logistics_company',r->>'hzkj_materialname',s.display->'items',cons.records)) LIKE ${term})`)
 }
 return `stock_receipt_lines AS MATERIALIZED (
 SELECT e.source_id notice_id,e.display->>'number' notice_number,nullif(trim(e.raw->>'hzkj_waybill_number'),'') tracking_number,nullif(trim(e.raw->>'hzkj_logistics_company'),'') carrier,e.raw->>'hzkj_shipping_time' shipped_at,
 CASE WHEN nullif(trim(e.raw->>'hzkj_waybill_number'),'') IS NOT NULL THEN jsonb_build_array(trim(e.raw->>'hzkj_logistics_company'),trim(e.raw->>'hzkj_waybill_number'))::text ELSE 'notice:'||e.source_id END parcel_key,
 s.source_id stock_id,s.display->>'stockNumber' stock_number,s.display->>'stockType' stock_type,l->>'id' line_id,r->>'seq' line_sequence,
 ${number('hzkj_qty')} quantity,${number('hzkj_receiveqty')} received_quantity
 FROM hz_fop_collected_entities e CROSS JOIN LATERAL jsonb_array_elements(e.display->'lines') l
 JOIN hz_fop_collected_entities s ON s.batch_id=e.batch_id AND s.entity_type='stock_orders' AND s.source_id=l->>'sourceDocumentId' AND l->>'sourceDocumentKind'='stock'
 JOIN LATERAL jsonb_array_elements(e.raw->'entryentity') r ON r->>'id'=l->>'id'
 LEFT JOIN LATERAL (
 SELECT jsonb_agg(jsonb_build_object('id',c.record_id,'orderId',o.source_id,'orderNumber',c.order_number,'customerName',o.display->>'customerName','sku',c.payload->>'skuNumber','quantity',c.quantity::text,'status',CASE c.use_status WHEN '0' THEN '预占' ELSE '已耗用' END) ORDER BY c.order_number,c.record_id) records
 FROM hz_fop_collected_stock_consumptions c JOIN hz_fop_collected_orders o ON o.batch_id=c.batch_id AND o.order_number=c.order_number
 WHERE c.batch_id=s.batch_id AND c.stock_id=s.source_id AND c.payload->>'stockNumber'=s.display->>'stockNumber' AND c.quantity>0 AND c.use_status IN ('0','1')
 AND (${scope}::text[] IS NULL OR o.owner_employee_id=ANY(${scope}::text[]))
 ) cons ON true
 WHERE ${clauses.join(' AND ')}
 ), stock_pending AS MATERIALIZED (
 SELECT *,CASE WHEN received_quantity>0 THEN 'partial' ELSE 'pending' END inbound_status FROM stock_receipt_lines
 WHERE quantity>0 AND received_quantity IS NOT NULL AND received_quantity<quantity ${query.status?`AND (CASE WHEN received_quantity>0 THEN 'partial' ELSE 'pending' END)=${bind(query.status)}`:''}
 ), stock_parcel_details AS (
 SELECT 'stock:'||stock_id parcel_key,jsonb_agg(DISTINCT jsonb_build_object('stockId',stock_id,'stockNumber',stock_number,'stockType',stock_type)) stock_lines FROM stock_pending GROUP BY stock_id
 ),`
}

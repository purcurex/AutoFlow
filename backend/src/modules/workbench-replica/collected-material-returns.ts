/** Restrict relations to a unique fulfillment number in this batch; never infer a relation from SKU. */
export function collectedMaterialReturnsQuery(batchId:string, employeeIds:readonly string[]|null, query:Record<string,any>) {
 const params:unknown[]=[batchId,employeeIds],where=['o.batch_id=$1','($2::text[] IS NULL OR o.owner_employee_id=ANY($2::text[]))',"(SELECT count(*) FROM hz_fop_collected_orders u WHERE u.batch_id=o.batch_id AND u.order_number=o.order_number)=1"]
 const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(query.warehouseCode)where.push(`l->>'warehouse'=ANY(${bind(query.warehouseCode==='HZ'?['HangZhou','杭州仓']:query.warehouseCode==='SZ'?['ShenZhen','深圳仓']:[query.warehouseCode])}::text[])`)
 if(query.status)where.push(`r.display->>'status'=${bind(query.status)}`)
 if(query.mode==='selected')where.push(`o.source_id=ANY(${bind(query.orderIds)}::text[])`)
 if(query.search?.trim()){
  const pattern='%'+query.search.trim().toLowerCase().replace(/[\\%_]/g,'\\$&')+'%'
  where.push(`(o.search_text LIKE ${bind(pattern)} ESCAPE '\\' OR lower(concat_ws(' ',r.display->>'number',r.display->'supplier'->>'name',(SELECT string_agg(p->>'number',' ') FROM jsonb_array_elements(coalesce(l->'orderPurchases','[]'::jsonb)) p))) LIKE $${params.length} ESCAPE '\\')`)
 }
 return {params,cte:`WITH linked AS (
 SELECT o.source_id,r.source_id return_id,r.display || jsonb_build_object('lines',jsonb_agg(l)) document
 FROM hz_fop_collected_entities r CROSS JOIN LATERAL jsonb_array_elements(r.display->'lines') l
 JOIN hz_fop_collected_orders o ON o.batch_id=r.batch_id AND o.order_number=l->>'orderNumber'
 WHERE r.batch_id=$1 AND r.entity_type='purchase_material_return' AND ${where.join(' AND ')}
 GROUP BY o.source_id,r.source_id,r.display
 ), matched AS (SELECT source_id,jsonb_agg(document ORDER BY document->>'number') documents FROM linked GROUP BY source_id)`}
}

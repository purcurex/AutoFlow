/** Frozen v5 identity predicates shared by queries and the exception-rule migration. */
export const jsonArrayV5 = (sql:string) => `CASE WHEN jsonb_typeof(${sql})='array' THEN ${sql} ELSE '[]'::jsonb END`
export function virtualLineSqlV5(line:string):string {
 return `(coalesce(${line}->>'isVirtual','false')='true'
  OR trim(coalesce(${line}->'hzkj_local_sku'->>'number',${line}->'hzkj_material'->>'number',${line}->>'hzkj_local_sku_number',${line}->>'hzkj_local_sku.number',${line}->>'sku',''))='HZ000020-001'
  OR trim(coalesce(${line}->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier',${line}->'hzkj_material'->'hzkj_good'->>'hzkj_good_carrier',${line}->>'hzkj_local_sku_hzkj_good_hzkj_good_carrier',${line}->>'hzkj_local_sku.hzkj_good.hzkj_good_carrier',''))='2')`
}
export function collectedVirtualLineSqlV5(line:string,order='o'):string {
 return `(${virtualLineSqlV5(line)} OR EXISTS(SELECT 1 FROM hz_fop_collected_entities vp WHERE vp.batch_id=${order}.batch_id AND vp.entity_type='product'
  AND vp.source_id=coalesce(${line}->'hzkj_local_sku'->>'id',${line}->>'hzkj_local_sku_id')
  AND (coalesce(${line}->'hzkj_local_sku'->>'number',${line}->>'hzkj_local_sku_number') IS NULL OR vp.raw->>'number'=coalesce(${line}->'hzkj_local_sku'->>'number',${line}->>'hzkj_local_sku_number'))
  AND vp.raw->'hzkj_good'->>'hzkj_good_carrier'='2'))`
}
export function collectedPhysicalLineSqlV5(line:string,order='o'):string {
 return `(NOT ${collectedVirtualLineSqlV5(line,order)} AND coalesce(${line}->>'requiresPhysicalOutbound','true')<>'false'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${jsonArrayV5(`${order}.raw->'hzkj_orders_billentry'`)}) child
   WHERE child->>'pid'=${line}->>'id' AND child->>'pid'<>'0'
    AND NOT ${collectedVirtualLineSqlV5('child',order)} AND coalesce(child->>'requiresPhysicalOutbound','true')<>'false'))`
}
export function outboundUnverifiedSqlV5(order:string):string {
 // A partial header that counted virtual entries cannot prove physical movement, audited or not.
 return `(${order}.raw_delivery_status='1' AND ${order}.display->'businessStatus'->>'outbound'='unknown'
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${jsonArrayV5(`${order}.raw->'hzkj_orders_billentry'`)}) virtual_entry WHERE ${collectedVirtualLineSqlV5('virtual_entry',order)}))`
}

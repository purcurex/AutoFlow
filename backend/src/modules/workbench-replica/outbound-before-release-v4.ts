/** Frozen rule v4, shared by the migration and diagnostic SQL. Do not change in place.
 * Virtual lines complete at order approval. Their partial header is not evidence
 * of physical shipment before the single verified allocation is released.
 * Any actual physical/downstream evidence keeps the case open for investigation.
 */
export function outboundBeforeReleaseV4(alias: string): string {
 const array = (value: string) => `CASE WHEN jsonb_typeof(${value})='array' THEN ${value} ELSE '[]'::jsonb END`
 return `(
 EXISTS(SELECT 1 FROM jsonb_array_elements(${array(`${alias}.raw->'hzkj_orders_billentry'`)}) l
  WHERE l->'hzkj_local_sku'->>'number'='HZ000020-001' OR l->'hzkj_local_sku'->'hzkj_good'->>'hzkj_good_carrier'='2')
 AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a
  WHERE a.batch_id=${alias}.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=${alias}.source_id
   AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided'
  HAVING count(*)=1 AND bool_and(coalesce(a.display->'association'->>'state'='verified'
   AND a.display->>'rawBillStatus' IN ('A','B') AND a.display->>'rawAllocationStatus' IN ('pending','available','completed'),false)))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${array(`${alias}.display->'businessStatus'->'lines'`)}) l
  WHERE l->>'excluded'='false' AND l->>'outbound' IN ('partial','completed'))
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=${alias}.batch_id AND e.entity_type IN ('delivery_notice','outbound')
   AND e.display->>'sourceOrderId'=${alias}.source_id)
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=${alias}.batch_id AND e.entity_type='delivery_notice'
   AND e.raw->>'hzkj_platform_order_no'=${alias}.raw->>'billno')
 AND NOT EXISTS(SELECT 1 FROM hz_fop_collected_entities e
  WHERE e.batch_id=${alias}.batch_id AND e.entity_type='outbound'
   AND e.raw->'billentry' @> jsonb_build_array(jsonb_build_object('hzkj_entry_billno',${alias}.raw->>'billno')))
 )`
}

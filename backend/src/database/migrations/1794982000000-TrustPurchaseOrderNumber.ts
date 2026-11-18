import type {MigrationInterface,QueryRunner} from 'typeorm'

/** Order linkage follows the purchase entry's fulfillment number; line IDs are optional detail. */
export class TrustPurchaseOrderNumber1794982000000 implements MigrationInterface {
 name='TrustPurchaseOrderNumber1794982000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query(String.raw`
CREATE FUNCTION hz_exception_procurement_reason_number_v3(p_batch uuid,p_id text) RETURNS text LANGUAGE sql AS $$
 WITH root AS (SELECT display,order_number FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id),
 linked AS (
  SELECT e.raw,root.order_number FROM hz_fop_collected_entities e CROSS JOIN root
  WHERE e.batch_id=p_batch AND e.entity_type='purchase'
   AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))
   AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'
 ), reasons AS (
 SELECT 1 priority,'采购单状态缺失' reason WHERE EXISTS(SELECT 1 FROM linked WHERE nullif(trim(raw->>'billstatus'),'') IS NULL OR nullif(trim(raw->>'hzkj_cancelstatus'),'') IS NULL)
 UNION ALL SELECT 2,'采购付款信息不完整' WHERE EXISTS(SELECT 1 FROM linked WHERE coalesce(raw->>'hzkj_pay_status','') NOT IN ('0','1','3'))
 UNION ALL SELECT 3,'采购关联未核实' WHERE EXISTS(SELECT 1 FROM linked WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(raw->'hzkj_billentry')='array' THEN raw->'hzkj_billentry' ELSE '[]'::jsonb END) l
  WHERE trim(l->>'hzkj_salbillnumber')=order_number))
  OR (NOT EXISTS(SELECT 1 FROM linked) AND EXISTS(SELECT 1 FROM root WHERE display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved']))
 ) SELECT string_agg(reason,'；' ORDER BY priority) FROM reasons;
$$;`)
  const [evalDef]=await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v2(uuid,text,boolean)'::regprocedure) AS sql")
  await q.query(evalDef.sql.replace('hz_exception_procurement_reason_v2(p_batch,p_id)','hz_exception_procurement_reason_number_v3(p_batch,p_id)').replace("'procurement-v2'","'procurement-number-v3'"))
  const [checkDef]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(checkDef.sql.replaceAll('exception_rule_version=2','exception_rule_version=3'))
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders WHERE exception_reason LIKE '%采购关联未核实%' OR display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved']")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
 }
 async down(q:QueryRunner):Promise<void>{
  const [evalDef]=await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v2(uuid,text,boolean)'::regprocedure) AS sql")
  await q.query(evalDef.sql.replace('hz_exception_procurement_reason_number_v3(p_batch,p_id)','hz_exception_procurement_reason_v2(p_batch,p_id)').replace("'procurement-number-v3'","'procurement-v2'"))
  const [checkDef]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(checkDef.sql.replaceAll('exception_rule_version=3','exception_rule_version=2'))
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders WHERE exception_rule_version=3")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
  await q.query('DROP FUNCTION hz_exception_procurement_reason_number_v3(uuid,text)')
 }
}

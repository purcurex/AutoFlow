import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Derive procurement quality marks on source writes, never during list queries. */
export class ProcurementDataExceptions1794981000000 implements MigrationInterface {
 name='ProcurementDataExceptions1794981000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query(`CREATE INDEX ix_exception_purchase_rows ON hz_fop_collected_entities USING gin ((display->'rows') jsonb_path_ops) WHERE entity_type='purchase'`)
  await q.query(String.raw`
CREATE FUNCTION hz_exception_procurement_reason_v2(p_batch uuid,p_id text) RETURNS text LANGUAGE sql AS $$
 WITH root AS (SELECT display FROM hz_fop_collected_orders WHERE batch_id=p_batch AND source_id=p_id),
 linked AS (
  SELECT e.raw,e.display,r AS row FROM hz_fop_collected_entities e
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.display->'rows')='array' THEN e.display->'rows' ELSE '[]'::jsonb END) r
  WHERE e.batch_id=p_batch AND e.entity_type='purchase'
   AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))
   AND r->>'orderId'=p_id AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'
 ), reasons AS (
 SELECT 1 priority,'采购单状态缺失' reason WHERE EXISTS(SELECT 1 FROM linked WHERE nullif(trim(raw->>'billstatus'),'') IS NULL OR nullif(trim(raw->>'hzkj_cancelstatus'),'') IS NULL)
 UNION ALL SELECT 2,'采购付款信息不完整' WHERE EXISTS(SELECT 1 FROM linked WHERE coalesce(raw->>'hzkj_pay_status','') NOT IN ('0','1','3'))
 UNION ALL SELECT 3,'采购关联未核实' WHERE EXISTS(SELECT 1 FROM linked WHERE display->'association'->>'state' IS DISTINCT FROM 'verified' OR row->>'associationState' IS DISTINCT FROM 'verified'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row->'lines')='array' THEN row->'lines' ELSE '[]'::jsonb END) l WHERE nullif(trim(l->>'fulfillmentLineId'),'') IS NULL))
  OR EXISTS(SELECT 1 FROM root WHERE display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved'])
 ) SELECT string_agg(reason,'；' ORDER BY priority) FROM reasons;
$$;
CREATE FUNCTION hz_exception_evaluate_order_v2(p_batch uuid,p_id text,p_dispatch boolean DEFAULT false)
RETURNS TABLE(flag boolean,category text,reason text,code text,facts_hash text,dispatch_linked boolean) LANGUAGE sql AS $$
 WITH previous AS (SELECT * FROM hz_exception_evaluate_order_v1(p_batch,p_id,p_dispatch)),
 procurement AS (SELECT hz_exception_procurement_reason_v2(p_batch,p_id) reason)
 SELECT previous.flag OR procurement.reason IS NOT NULL,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_exception' ELSE previous.category END,
 CASE WHEN procurement.reason IS NOT NULL THEN concat_ws('；',nullif(previous.reason,''),procurement.reason) ELSE previous.reason END,
 CASE WHEN procurement.reason IS NOT NULL AND (previous.category IS NULL OR previous.category='procurement_exception') THEN 'procurement_data_incomplete' ELSE previous.code END,
 md5(jsonb_build_array('procurement-v2',previous.facts_hash,procurement.reason)::text),previous.dispatch_linked FROM previous CROSS JOIN procurement;
$$;
CREATE FUNCTION hz_exception_purchase_changed_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_row jsonb; after_row jsonb; source jsonb; parent text;
BEGIN
 before_row=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
 after_row=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
 IF TG_OP='UPDATE' AND (before_row->'display',before_row->'raw',before_row->'batch_id',before_row->'entity_type') IS NOT DISTINCT FROM (after_row->'display',after_row->'raw',after_row->'batch_id',after_row->'entity_type') THEN RETURN NEW; END IF;
 FOR source IN SELECT v FROM (VALUES(before_row),(after_row)) rows(v) WHERE v->>'entity_type'='purchase' LOOP
  FOR parent IN SELECT DISTINCT r->>'orderId' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(source->'display'->'rows')='array' THEN source->'display'->'rows' ELSE '[]'::jsonb END) r LOOP
   PERFORM hz_exception_enqueue_v1((source->>'batch_id')::uuid,'order',parent);
  END LOOP;
 END LOOP;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER hz_exception_purchase_change AFTER INSERT OR UPDATE OR DELETE ON hz_fop_collected_entities FOR EACH ROW EXECUTE FUNCTION hz_exception_purchase_changed_v2();
`)
  const [definition]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(definition.sql.replace('hz_exception_evaluate_order_v1(p_batch,p_id,p_dispatch)','hz_exception_evaluate_order_v2(p_batch,p_id,p_dispatch)').replaceAll('exception_rule_version=1','exception_rule_version=2'))
  // Rebuild only the existing linked or explicitly unresolved purchase population.
  await q.query(`SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders o WHERE
   o.display->'nativeProcurementAssociationIssues' ?| ARRAY['current_purchase_relationship_conflict','current_purchase_relationship_unresolved']
   OR EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=o.batch_id AND e.entity_type='purchase' AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',o.source_id)))`)
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
 }
 async down(q:QueryRunner):Promise<void>{
  const [definition]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(definition.sql.replace('hz_exception_evaluate_order_v2(p_batch,p_id,p_dispatch)','hz_exception_evaluate_order_v1(p_batch,p_id,p_dispatch)').replaceAll('exception_rule_version=2','exception_rule_version=1'))
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders WHERE exception_rule_version=2")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
  await q.query('DROP TRIGGER hz_exception_purchase_change ON hz_fop_collected_entities; DROP FUNCTION hz_exception_purchase_changed_v2(); DROP FUNCTION hz_exception_evaluate_order_v2(uuid,text,boolean); DROP FUNCTION hz_exception_procurement_reason_v2(uuid,text); DROP INDEX ix_exception_purchase_rows')
 }
}

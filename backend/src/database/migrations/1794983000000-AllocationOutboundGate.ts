import type { MigrationInterface, QueryRunner } from 'typeorm'
import { outboundBeforeReleaseV4 } from '../../modules/workbench-replica/outbound-before-release-v4'

export class AllocationOutboundGate1794983000000 implements MigrationInterface {
 name = 'AllocationOutboundGate1794983000000'
 async up(q: QueryRunner): Promise<void> {
  await q.query(`CREATE INDEX ix_exception_downstream_parent ON hz_fop_collected_entities(batch_id,(display->>'sourceOrderId')) WHERE entity_type IN ('delivery_notice','outbound');
   CREATE INDEX ix_exception_notice_order ON hz_fop_collected_entities(batch_id,(raw->>'hzkj_platform_order_no')) WHERE entity_type='delivery_notice';
   CREATE INDEX ix_exception_outbound_lines ON hz_fop_collected_entities USING gin ((raw->'billentry') jsonb_path_ops) WHERE entity_type='outbound'`)
  const [base] = await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v1(uuid,text,boolean)'::regprocedure) AS sql")
  const old = "(hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown')"
  if (!base.sql.includes(old)) throw Error('outbound_rule_upgrade_source_mismatch')
  // Preserve v1 for rollback; v2 retains the already-installed procurement-number rule.
  await q.query(base.sql.replace('hz_exception_evaluate_order_v1(', 'hz_exception_evaluate_order_base_v4(')
   .replaceAll(old, `(${old} AND NOT ${outboundBeforeReleaseV4('hz_fop_collected_orders')})`))
  const [combined] = await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v2(uuid,text,boolean)'::regprocedure) AS sql")
  await q.query(combined.sql.replace('hz_exception_evaluate_order_v2(', 'hz_exception_evaluate_order_v4(')
   .replace('hz_exception_evaluate_order_v1(p_batch,p_id,p_dispatch)', 'hz_exception_evaluate_order_base_v4(p_batch,p_id,p_dispatch)')
   .replace("'procurement-number-v3',previous.facts_hash,procurement.reason", "'outbound-gate-v4',previous.facts_hash,procurement.reason,previous.flag,previous.category,previous.reason"))
  const [check] = await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(check.sql.replace('hz_exception_evaluate_order_v2(p_batch,p_id,p_dispatch)', 'hz_exception_evaluate_order_v4(p_batch,p_id,p_dispatch)')
   .replaceAll('exception_rule_version=3', 'exception_rule_version=4'))
  await q.query(`CREATE FUNCTION hz_exception_downstream_changed_v4() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE prior jsonb; current_row jsonb; source jsonb; parent text;
   BEGIN
    prior=CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    current_row=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    IF TG_OP='UPDATE' AND (prior->'raw',prior->'display',prior->'batch_id',prior->'entity_type') IS NOT DISTINCT FROM
     (current_row->'raw',current_row->'display',current_row->'batch_id',current_row->'entity_type') THEN RETURN NEW; END IF;
    FOR source IN SELECT v FROM (VALUES(prior),(current_row)) rows(v) WHERE v->>'entity_type' IN ('delivery_notice','outbound') LOOP
     PERFORM hz_exception_enqueue_v1((source->>'batch_id')::uuid,'order',source->'display'->>'sourceOrderId');
     FOR parent IN SELECT source_id FROM hz_fop_collected_orders o WHERE o.batch_id=(source->>'batch_id')::uuid AND
      (o.order_number=source->'raw'->>'hzkj_platform_order_no' OR o.order_number IN
       (SELECT l->>'hzkj_entry_billno' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(source->'raw'->'billentry')='array' THEN source->'raw'->'billentry' ELSE '[]'::jsonb END) l)) LOOP
      PERFORM hz_exception_enqueue_v1((source->>'batch_id')::uuid,'order',parent);
     END LOOP;
    END LOOP;
    RETURN coalesce(NEW,OLD);
   END $$;
   CREATE TRIGGER hz_exception_downstream_change AFTER INSERT OR UPDATE OR DELETE ON hz_fop_collected_entities
    FOR EACH ROW EXECUTE FUNCTION hz_exception_downstream_changed_v4()`)
  await this.rebuild(q)
 }
 private async rebuild(q: QueryRunner) {
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders WHERE raw_delivery_status='1' AND display->'businessStatus'->>'outbound'='unknown'")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
 }
 async down(q: QueryRunner): Promise<void> {
  const [check] = await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(check.sql.replace('hz_exception_evaluate_order_v4(p_batch,p_id,p_dispatch)', 'hz_exception_evaluate_order_v2(p_batch,p_id,p_dispatch)')
   .replaceAll('exception_rule_version=4', 'exception_rule_version=3'))
  await this.rebuild(q)
  await q.query(`DROP TRIGGER hz_exception_downstream_change ON hz_fop_collected_entities;
   DROP FUNCTION hz_exception_downstream_changed_v4();
   DROP FUNCTION hz_exception_evaluate_order_v4(uuid,text,boolean);
   DROP FUNCTION hz_exception_evaluate_order_base_v4(uuid,text,boolean);
   DROP INDEX ix_exception_downstream_parent; DROP INDEX ix_exception_notice_order; DROP INDEX ix_exception_outbound_lines`)
 }
}

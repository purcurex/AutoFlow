import type { MigrationInterface, QueryRunner } from 'typeorm'
import { outboundUnverifiedSqlV5, virtualLineSqlV5 } from '../../modules/workbench-replica/physical-business-sql-v5'

/** Upgrade persisted marks only; physical purchase/outbound displays are rebuilt by the local repair tool. */
export class PhysicalBusinessClassification1794986000000 implements MigrationInterface {
 name='PhysicalBusinessClassification1794986000000'
 async up(q:QueryRunner):Promise<void>{
  await q.query(`CREATE INDEX ix_collected_physical_inbound_candidates ON hz_fop_collected_orders(batch_id,owner_employee_id,warehouse_code,paid_at,source_id)
   WHERE raw @? '$.hzkj_orders_billentry[*] ? (@.hzkj_entrypurc_status == "3" || @.hzkj_entrypurc_status == "4")'`)
  const [base]=await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v1(uuid,text,boolean)'::regprocedure) AS sql")
  const old="(hz_fop_collected_orders.raw_delivery_status='1' AND hz_fop_collected_orders.display->'businessStatus'->>'outbound'='unknown')"
  if(!base.sql.includes(old))throw Error('physical_exception_upgrade_source_mismatch')
  await q.query(base.sql.replace('hz_exception_evaluate_order_v1(', 'hz_exception_evaluate_order_base_v5(').replaceAll(old,outboundUnverifiedSqlV5('hz_fop_collected_orders')))
  const [procurement]=await q.query("SELECT pg_get_functiondef('hz_exception_procurement_reason_number_v3(uuid,text)'::regprocedure) AS sql")
  const active="AND e.raw->>'hzkj_cancelstatus' IS DISTINCT FROM 'B'"
  if(!procurement.sql.includes(active))throw Error('physical_procurement_upgrade_source_mismatch')
  await q.query(procurement.sql.replace('hz_exception_procurement_reason_number_v3(', 'hz_exception_procurement_reason_v5(').replace(active,`${active}
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.display->'rows') r WHERE r->>'orderId'=p_id AND jsonb_array_length(coalesce(r->'lines','[]'::jsonb))>0
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'lines') l WHERE NOT ${virtualLineSqlV5('l')}
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(root.display->'businessStatus'->'lines','[]'::jsonb)) b WHERE b->>'id'=l->>'fulfillmentLineId' AND b->>'excluded'='true')))`))
  const [combined]=await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v4(uuid,text,boolean)'::regprocedure) AS sql")
  await q.query(combined.sql.replace('hz_exception_evaluate_order_v4(', 'hz_exception_evaluate_order_v5(')
   .replace('hz_exception_evaluate_order_base_v4(', 'hz_exception_evaluate_order_base_v5(')
   .replace('hz_exception_procurement_reason_number_v3(', 'hz_exception_procurement_reason_v5(').replace("'outbound-gate-v4'","'physical-business-v5'"))
  await this.switch(q,4,5)
  await this.rebuild(q)
 }
 private async switch(q:QueryRunner,from:number,to:number){
  const [check]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) AS sql")
  await q.query(check.sql.replace(`hz_exception_evaluate_order_v${from}(p_batch,p_id,p_dispatch)`,`hz_exception_evaluate_order_v${to}(p_batch,p_id,p_dispatch)`).replaceAll(`exception_rule_version=${from}`,`exception_rule_version=${to}`))
 }
 private async rebuild(q:QueryRunner){
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders WHERE raw_delivery_status='1' OR exception_type='procurement_exception'")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
 }
 async down(q:QueryRunner):Promise<void>{
  await this.switch(q,5,4);await this.rebuild(q)
  await q.query(`DROP FUNCTION hz_exception_evaluate_order_v5(uuid,text,boolean); DROP FUNCTION hz_exception_evaluate_order_base_v5(uuid,text,boolean); DROP FUNCTION hz_exception_procurement_reason_v5(uuid,text); DROP INDEX ix_collected_physical_inbound_candidates`)
 }
}

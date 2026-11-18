import type { MigrationInterface, QueryRunner } from 'typeorm'
import { collectedPaymentDataExceptionSql, collectedDispatchFailureSql, collectedMissingObtainedTrackingSql, collectedMissingFulfilledTrackingSql, collectedPackagesSql } from './exception-audit-sql-v6'
import { outboundUnverifiedSqlV5 } from '../../modules/workbench-replica/physical-business-sql-v5'

/** Source-backed v6 projection. No source mutation, remote read, or list-time reclassification. */
export class ExceptionAuditRemediation1794988000000 implements MigrationInterface {
 name='ExceptionAuditRemediation1794988000000'
 async up(q:QueryRunner):Promise<void>{
  const [purchase]=await q.query("SELECT pg_get_functiondef('hz_exception_procurement_reason_v5(uuid,text)'::regprocedure) sql")
  const condition="coalesce(raw->>'hzkj_pay_status','') NOT IN ('0','1','2','3','4')"
  if(!purchase.sql.includes(condition))throw Error('exception_v6_purchase_source_mismatch')
  await q.query(purchase.sql.replace('hz_exception_procurement_reason_v5(', 'hz_exception_procurement_reason_v6(')
   .replace(condition,`(NULLIF(trim(raw->>'hzkj_pay_status'),'') IS NOT NULL AND raw->>'hzkj_pay_status' NOT IN ('0','1','2','3','4')
    OR NULLIF(trim(raw->>'hzkj_pay_status'),'') IS NULL AND NULLIF(trim(raw->>'hzkj_1688_order_n'),'') IS NOT NULL)`)
   .replace('采购付款信息不完整','采购付款状态待核验'))
  await q.query(`CREATE FUNCTION hz_exception_evaluate_order_v6(p_batch uuid,p_id text,p_dispatch boolean DEFAULT false)
 RETURNS TABLE(flag boolean,category text,reason text,code text,facts_hash text,dispatch_linked boolean) LANGUAGE sql AS $$
 WITH root AS (
  SELECT o.*, (p_dispatch OR o.exception_dispatch_linked OR b.metadata->'entityCaptures'->'dispatch'->>'coverage' IN ('full_parent_scan','full_company_scan')
   OR EXISTS(SELECT 1 FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id)) IS TRUE use_dispatch
  FROM hz_fop_collected_orders o JOIN hz_fop_collected_batches b ON b.id=o.batch_id WHERE o.batch_id=p_batch AND o.source_id=p_id
 ), hz_fop_collected_orders AS (
  SELECT r.batch_id,r.source_id,r.raw_order_status,r.raw_bill_status,r.raw_payment_status,r.raw_delivery_status,r.paid_at,r.raw,r.use_dispatch,
   CASE WHEN r.use_dispatch THEN r.display||jsonb_build_object('dispatchDocuments',coalesce((SELECT jsonb_agg(e.display ORDER BY e.source_id)
    FROM hz_fop_collected_entities e WHERE e.batch_id=p_batch AND e.entity_type='dispatch' AND e.display->>'sourceOrderId'=p_id),'[]'::jsonb)) ELSE r.display END display
  FROM root r
 ), facts AS (
  SELECT *,${collectedPaymentDataExceptionSql} payment_missing,${collectedDispatchFailureSql} sync_failure,
   ${collectedMissingObtainedTrackingSql} obtained_missing,${collectedMissingFulfilledTrackingSql} fulfilled_missing,
   ${collectedPackagesSql} packages,${outboundUnverifiedSqlV5('hz_fop_collected_orders')} outbound_unverified,
   hz_exception_procurement_reason_v6(p_batch,p_id) procurement_reason,
   (SELECT string_agg(DISTINCT CASE a.raw->>'hzkj_error_code'
    WHEN 'ALLOC-DATA-001' THEN CASE WHEN strpos(coalesce(a.raw->>'hzkj_error_msg',''),'配货明细缺少有效的来源订单商品行')>0 THEN '配货明细来源商品行关联缺失' ELSE '配货数据校验失败' END
    WHEN 'ALLOC-PURCHASE-TIMEOUT' THEN '采购入库自动配货超时' ELSE '配货单报错' END,'；')
    FROM hz_fop_collected_entities a WHERE a.batch_id=p_batch AND a.entity_type='allocation'
    AND a.display->>'sourceOrderId'=p_id AND coalesce(a.display->'association'->>'state','verified')='verified'
    AND a.display->>'rawAllocationStatus'='error') allocation_reason
  FROM hz_fop_collected_orders
 ), candidates AS (
 SELECT v.* FROM facts CROSS JOIN LATERAL (VALUES
  (10,'logistics_exception',CASE WHEN raw_order_status='6' THEN '取消履约' END,'fulfillment_cancelled'),
  (20,'logistics_exception',CASE WHEN payment_missing THEN '收款日期为空' END,'paid_date_missing'),
  (30,'dispatch_exception',CASE WHEN sync_failure THEN CASE WHEN raw_order_status IN ('4','5') THEN '发运审核同步状态与履约状态不一致' ELSE '发运单审核同步失败' END END,'dispatch_sync_failed'),
  (40,'dispatch_exception',CASE WHEN obtained_missing THEN '已取号订单缺少物流跟踪号' END,'dispatch_tracking_missing'),
  (50,'dispatch_exception',CASE WHEN fulfilled_missing THEN CASE WHEN packages IS NULL THEN '履约订单物流信息待核验' ELSE '履约订单物流跟踪号为空' END END,'fulfillment_tracking_missing'),
  (60,'outbound_exception',CASE WHEN outbound_unverified THEN '部分出库无法核实' END,'outbound_unverified'),
  (70,'allocation_exception',allocation_reason,'allocation_source_error'),
  (80,'procurement_exception',procurement_reason,'procurement_data_missing'),
  (90,'logistics_exception',CASE WHEN raw_bill_status='C' AND raw_order_status IN ('2','3','4','5') AND raw_payment_status='0' THEN '单据审核状态与收款状态不一致' END,'receipt_status_conflict'),
  (100,'logistics_exception',CASE WHEN display->'nativeAssociationIssues' ?| ARRAY['parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict'] THEN '业务单据关联待核验' END,'association_conflict'),
  (110,'logistics_exception',CASE WHEN raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no') THEN '履约订单状态待核验'
    WHEN raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')) THEN '履约订单收款状态待核验' END,'order_status_unverified'),
  (120,'dispatch_exception',CASE WHEN raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced' THEN '履约状态与发运进度不一致' END,'dispatch_progress_conflict'),
  (130,display->'exception'->>'type',CASE WHEN NULLIF(display->'exception'->>'type','') IS NOT NULL
   AND coalesce(display->'exception'->>'code','') NOT IN ('paid_date_missing','fulfillment_cancelled','dispatch_sync_failed','dispatch_tracking_missing','fulfillment_tracking_missing','outbound_unverified','allocation_source_error','procurement_data_missing','receipt_status_conflict','association_conflict','order_status_unverified','dispatch_progress_conflict')
   AND coalesce(display->'exception'->>'reason','') NOT IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已履约订单缺少物流跟踪号','已取号订单缺少物流跟踪号','部分出库无法核实','配货单报错','发运单审核同步失败','发运审核同步状态与履约状态不一致','履约订单物流跟踪号为空','履约订单物流信息待核验')
   AND NOT(display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND coalesce(raw->>'hzkj_fulfillment_status',display->'salesSourceStatus'->>'fulfillmentStatus','')<>'fulfilled')
   THEN coalesce(NULLIF(display->'exception'->>'reason',''),'源单据异常待核验') END,display->'exception'->>'code')
 ) v(priority,category,reason,code) WHERE v.reason IS NOT NULL
 ), reasons AS (SELECT category,reason,code,min(priority) priority FROM candidates GROUP BY category,reason,code)
 SELECT EXISTS(SELECT 1 FROM reasons),(SELECT category FROM reasons ORDER BY priority LIMIT 1),
  (SELECT string_agg(reason,'；' ORDER BY priority,reason) FROM reasons),(SELECT code FROM reasons ORDER BY priority LIMIT 1),
  md5(jsonb_build_array('source-audit-v6',raw,display-'timestampProjection',raw_order_status,raw_bill_status,raw_payment_status,raw_delivery_status,paid_at,
   (SELECT jsonb_agg(jsonb_build_array(e.source_id,e.display,e.raw) ORDER BY e.source_id) FROM hz_fop_collected_entities e
    WHERE e.batch_id=p_batch AND ((e.entity_type='allocation' AND e.display->>'sourceOrderId'=p_id)
    OR(e.entity_type='purchase' AND e.display->'rows' @> jsonb_build_array(jsonb_build_object('orderId',p_id))))))::text),use_dispatch FROM facts;
 $$`)
  const [check]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) sql")
  await q.query(check.sql.replace('hz_exception_evaluate_order_v5(p_batch,p_id,p_dispatch)','hz_exception_evaluate_order_v6(p_batch,p_id,p_dispatch)')
   .replaceAll('exception_rule_version=5','exception_rule_version=6')
   .replace("AND source.raw ? 'hzkj_receipt_status' AND coalesce(trim(source.raw->>'hzkj_receipt_status'),'')='' ",'')
   .replace('已支付，收款状态为空','备货收款日期待补齐'))
  await this.rebuild(q)
 }
 private async rebuild(q:QueryRunner){
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders")
  await q.query("SELECT hz_exception_enqueue_v1(batch_id,'stock',source_id) FROM hz_fop_collected_entities WHERE entity_type='stock_orders'")
  await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
 }
 async down(q:QueryRunner):Promise<void>{
  const [check]=await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) sql")
  await q.query(check.sql.replace('hz_exception_evaluate_order_v6(p_batch,p_id,p_dispatch)','hz_exception_evaluate_order_v5(p_batch,p_id,p_dispatch)')
   .replaceAll('exception_rule_version=6','exception_rule_version=5').replace('备货收款日期待补齐','已支付，收款状态为空')
   .replace("source.raw->>'hzkj_orderstatus'='2' AND source.raw ? 'hzkj_receipt_date'", "source.raw->>'hzkj_orderstatus'='2' AND source.raw ? 'hzkj_receipt_status' AND coalesce(trim(source.raw->>'hzkj_receipt_status'),'')='' AND source.raw ? 'hzkj_receipt_date'"))
  await this.rebuild(q)
  await q.query('DROP FUNCTION hz_exception_evaluate_order_v6(uuid,text,boolean); DROP FUNCTION hz_exception_procurement_reason_v6(uuid,text)')
 }
}

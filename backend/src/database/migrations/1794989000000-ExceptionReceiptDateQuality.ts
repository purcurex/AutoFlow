import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Keep an invalid source date distinct from an explicitly empty date. */
export class ExceptionReceiptDateQuality1794989000000 implements MigrationInterface {
  name = 'ExceptionReceiptDateQuality1794989000000'

  async up(q: QueryRunner): Promise<void> {
    const [{ sql }] = await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v6(uuid,text,boolean)'::regprocedure) sql")
    const oldCandidate = "(20,'logistics_exception',CASE WHEN payment_missing THEN '收款日期为空' END,'paid_date_missing')"
    if (!sql.includes(oldCandidate) || !/\('paid_date_missing',('paid_date_invalid',)?'fulfillment_cancelled'/.test(sql)) {
      throw new Error('exception_v7_receipt_source_mismatch')
    }
    // Only our verified timestamp projection can supply this normalization marker.
    const invalid = `(raw->'timestampProjection'->>'entityCode'='hzkj_orders'
      AND raw->'timestampProjection'->>'companyBasis' IN ('verified_timestamp_scope','source_org_id_checked_against_timestamp_scope')
      AND raw->'timestampProjection'->>'companyId'=(SELECT company_id FROM hz_fop_collected_batches WHERE id=p_batch)
      AND jsonb_typeof(raw->'timestampProjection'->'unknownTimes')='array'
      AND (raw->'timestampProjection'->'unknownTimes') ? 'hzkj_receipt_date')`
    await q.query(sql.replace('hz_exception_evaluate_order_v6(', 'hz_exception_evaluate_order_v7(')
      .replace(oldCandidate, `(20,'logistics_exception',CASE WHEN payment_missing THEN CASE WHEN ${invalid} THEN '收款日期格式待核验' ELSE '收款日期为空' END END,CASE WHEN ${invalid} THEN 'paid_date_invalid' ELSE 'paid_date_missing' END)`)
      .replace("('paid_date_missing','fulfillment_cancelled'", "('paid_date_missing','paid_date_invalid','fulfillment_cancelled'")
      .replace("'source-audit-v6'", "'source-audit-v7'"))
    await this.switchVersion(q, 6, 7)
  }

  private async switchVersion(q: QueryRunner, from: number, to: number): Promise<void> {
    const [{ sql }] = await q.query("SELECT pg_get_functiondef('hz_exception_recheck_v1(uuid,text,text,boolean)'::regprocedure) sql")
    const evaluator = `hz_exception_evaluate_order_v${from}(p_batch,p_id,p_dispatch)`
    if (!sql.includes(evaluator) || !sql.includes(`exception_rule_version=${from}`)) {
      throw new Error('exception_v7_recheck_source_mismatch')
    }
    await q.query(sql.replace(evaluator, `hz_exception_evaluate_order_v${to}(p_batch,p_id,p_dispatch)`)
      .replaceAll(`exception_rule_version=${from}`, `exception_rule_version=${to}`))
    await q.query("SELECT hz_exception_enqueue_v1(batch_id,'order',source_id) FROM hz_fop_collected_orders")
    await q.query("SELECT hz_exception_enqueue_v1(batch_id,'stock',source_id) FROM hz_fop_collected_entities WHERE entity_type='stock_orders'")
    await q.query('SELECT hz_exception_flush_v1(id) FROM hz_fop_collected_batches')
  }

  async down(q: QueryRunner): Promise<void> {
    // v7 publishers may have persisted this derived code in display. A rollback
    // must not mistake it for a new independent source exception on recovery.
    const [{ sql }] = await q.query("SELECT pg_get_functiondef('hz_exception_evaluate_order_v6(uuid,text,boolean)'::regprocedure) sql")
    await q.query(sql.replace("('paid_date_missing','fulfillment_cancelled'", "('paid_date_missing','paid_date_invalid','fulfillment_cancelled'"))
    await this.switchVersion(q, 7, 6)
    await q.query('DROP FUNCTION hz_exception_evaluate_order_v7(uuid,text,boolean)')
  }
}

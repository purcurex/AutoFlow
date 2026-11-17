import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Frozen unpaid predicate: preserves native-field precedence, explicit nulls and legacy provenance. */
export class CollectedUnpaidIndex1794831000000 implements MigrationInterface {
  name = 'CollectedUnpaidIndex1794831000000'
  transaction = false
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX CONCURRENTLY ix_collected_unpaid_time
      ON hz_fop_collected_orders(batch_id,raw_order_status,consumer_paid_at DESC NULLS LAST,source_id ASC)
      INCLUDE(owner_employee_id,warehouse_code,country_code,total_quantity)
      WHERE (raw_order_status IN ('no','1') AND (CASE WHEN jsonb_exists(raw,'hzkj_fulfillment_status') THEN raw->>'hzkj_fulfillment_status'
  WHEN display->'salesSourceStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourceStatus'->>'sourceId'=source_id
   AND display->'salesSourceStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourceStatus'->>'fulfillmentStatus' END) IS DISTINCT FROM 'fulfilled'
  AND coalesce((CASE WHEN jsonb_exists(raw,'hzkj_sourcepayststus') THEN raw->>'hzkj_sourcepayststus'
  WHEN display->'salesSourcePaymentStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourcePaymentStatus'->>'sourceId'=source_id
   AND display->'salesSourcePaymentStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourcePaymentStatus'->>'paymentStatus' END) NOT IN ('refunded','voided','expired','unpaid'),true))`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX CONCURRENTLY ix_collected_unpaid_time')
  }
}

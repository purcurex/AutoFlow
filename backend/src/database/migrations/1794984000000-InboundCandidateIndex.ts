import type { MigrationInterface,QueryRunner } from 'typeorm'
export class InboundCandidateIndex1794984000000 implements MigrationInterface {
 name='InboundCandidateIndex1794984000000'
 async up(q:QueryRunner){await q.query(`CREATE INDEX IF NOT EXISTS ix_collected_inbound_candidates ON hz_fop_collected_orders(batch_id,owner_employee_id,warehouse_code,paid_at,source_id) WHERE (raw->>'hzkj_purchase_status' IN ('1','4') OR raw->>'hzkj_purchase_status_title' IN ('部分发货','已发货'))`)}
 async down(q:QueryRunner){await q.query('DROP INDEX IF EXISTS ix_collected_inbound_candidates')}
}

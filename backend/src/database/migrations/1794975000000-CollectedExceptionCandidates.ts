import type { MigrationInterface, QueryRunner } from 'typeorm'

// Frozen conservative predicate, rechecked by the current shared business rules after lookup.
const candidate = String.raw`(
 raw_order_status='6'
 OR raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no')
 OR (raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')))
 OR (raw_payment_status='1' AND paid_at IS NULL)
 OR coalesce(display->'exception'->>'type','')<>''
 OR display->'nativeAssociationIssues' ?| ARRAY['parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict']
 OR display->'nativeProcurementAssociationIssues' ? 'current_purchase_relationship_conflict'
 OR (raw_delivery_status='1' AND display->'businessStatus'->>'outbound'='unknown')
 OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced')
 OR (raw_bill_status='C' AND raw_order_status IN ('2','3'))
 OR (raw_bill_status='C' AND raw_order_status IN ('4','5') AND (
   NOT coalesce(jsonb_path_exists(raw,'strict $.hzkj_logistics_info[*] ? (@.hzkj_tracking_number.type() == "string" && @.hzkj_tracking_number like_regex "[^ \\t\\n\\r]")','{}',true),false)
   OR jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
   OR coalesce(jsonb_path_exists(display,'strict $.dispatchDocuments[*] ? (@.deliveryStatus == "SYNC_FAILED" || @.deliveryStatus == "TRACKING_OBTAINED" || (exists(@.trackingNumbers[*] ? (@.type == "full" || @.type == "first_mile" || @.type == "last_mile")) && !exists(@.trackingNumbers[*] ? (@.type == "full" && @.number.type() == "string" && @.number like_regex "[^ \\t\\n\\r]"))))','{}',true),false)
 ))
)`

export class CollectedExceptionCandidates1794975000000 implements MigrationInterface {
  name = 'CollectedExceptionCandidates1794975000000'
  transaction = false
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX CONCURRENTLY ix_collected_exception_candidates ON hz_fop_collected_orders(batch_id, source_id) INCLUDE(owner_employee_id) WHERE ${candidate}`)
    await q.query(`CREATE INDEX CONCURRENTLY ix_collected_allocation_errors ON hz_fop_collected_entities(batch_id, (display->>'sourceOrderId')) WHERE entity_type='allocation' AND display->>'rawAllocationStatus'='error'`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX CONCURRENTLY ix_collected_allocation_errors')
    await q.query('DROP INDEX CONCURRENTLY ix_collected_exception_candidates')
  }
}

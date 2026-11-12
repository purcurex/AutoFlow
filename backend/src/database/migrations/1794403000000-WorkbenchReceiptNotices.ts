import type { MigrationInterface, QueryRunner } from 'typeorm'

const resources = "'orders','stock_orders','purchases','rma','purchase_returns','stock_inventory','allocation_inventory','contacts','channels'"
export class WorkbenchReceiptNotices1794403000000 implements MigrationInterface {
  name = 'WorkbenchReceiptNotices1794403000000'
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE hz_fop_resource_grants DROP CONSTRAINT ck_hz_fop_resource_grants_resource_type')
    await q.query(`ALTER TABLE hz_fop_resource_grants ADD CONSTRAINT ck_hz_fop_resource_grants_resource_type CHECK(resource_type IN (${resources},'receipt_notices'))`)
    // A projection of one receipt notice, including its own entries and verified current ownership.
    // No upstream requests or implicit permission grants are introduced by this migration.
    await q.query(`CREATE TABLE hz_fop_workbench_receipt_notices (
      document_id uuid PRIMARY KEY REFERENCES hz_fop_receipt_notices(document_id) ON DELETE CASCADE,
      source_version numeric(30,0) NOT NULL,
      owner_employee_ids text[] NOT NULL CHECK(cardinality(owner_employee_ids)>0),
      ownership_verified_at timestamptz NOT NULL,
      shipment_state text NOT NULL CHECK(shipment_state IN ('pending','shipped','unknown')),
      carrier_name text,
      quantity numeric(24,8) NOT NULL CHECK(quantity>0),
      inbound_quantity numeric(24,8) NOT NULL CHECK(inbound_quantity>=0 AND inbound_quantity<=quantity),
      lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines)>0),
      published_at timestamptz NOT NULL DEFAULT now()
    )`)
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE hz_fop_workbench_receipt_notices')
    await q.query("DELETE FROM hz_fop_resource_grants WHERE resource_type='receipt_notices'")
    await q.query('ALTER TABLE hz_fop_resource_grants DROP CONSTRAINT ck_hz_fop_resource_grants_resource_type')
    await q.query(`ALTER TABLE hz_fop_resource_grants ADD CONSTRAINT ck_hz_fop_resource_grants_resource_type CHECK(resource_type IN (${resources}))`)
  }
}

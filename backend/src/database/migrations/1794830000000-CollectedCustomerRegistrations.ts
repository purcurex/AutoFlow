import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CollectedCustomerRegistrations1794830000000 implements MigrationInterface {
  name = 'CollectedCustomerRegistrations1794830000000'
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE hz_fop_collected_customer_registrations (
      batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
      source_id text NOT NULL, company_id text NOT NULL,
      source_entity text NOT NULL CHECK (source_entity='hzkj_member_customer'),
      source_owner_user_id text, created_at timestamptz,
      raw jsonb NOT NULL, captured_at timestamptz NOT NULL,
      PRIMARY KEY(batch_id,source_id)
    )`)
    await q.query('CREATE INDEX ix_customer_registration_scope_time ON hz_fop_collected_customer_registrations(batch_id,company_id,source_owner_user_id,created_at)')
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE hz_fop_collected_customer_registrations') }
}

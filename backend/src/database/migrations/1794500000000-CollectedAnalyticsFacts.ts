import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Rebuildable projections of existing source documents; this table owns no business state. */
export class CollectedAnalyticsFacts1794500000000 implements MigrationInterface {
  name = 'CollectedAnalyticsFacts1794500000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE hz_fop_collected_analytics_facts (
      batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
      entity_type text NOT NULL CHECK (entity_type IN ('fulfillment','stock','purchase','dispatch','receipt')),
      source_id text NOT NULL, company_id text NOT NULL, document_number text NOT NULL,
      owner_employee_id text, customer_id text, department_id text,
      created_at timestamptz, paid_at timestamptz, source_paid_at timestamptz, occurred_at timestamptz,
      amount numeric, currency_code text, quantity numeric, raw_status text,
      facts jsonb NOT NULL, raw jsonb NOT NULL, captured_at timestamptz NOT NULL,
      PRIMARY KEY (batch_id,entity_type,source_id),
      CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
      CHECK (amount IS NULL OR currency_code IS NOT NULL)
    )`)
    await queryRunner.query('CREATE INDEX ix_collected_analytics_scope_time ON hz_fop_collected_analytics_facts(batch_id,entity_type,owner_employee_id,occurred_at,source_id)')
    await queryRunner.query('CREATE INDEX ix_collected_analytics_document ON hz_fop_collected_analytics_facts(batch_id,entity_type,document_number)')
    await queryRunner.query("COMMENT ON TABLE hz_fop_collected_analytics_facts IS '现有来源单据的可重建分析投影；不替代主单表，不生成业务状态；金额币种缺失保留空值，分项原生金额保存在facts。'")
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE hz_fop_collected_analytics_facts')
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm'

export class WorkbenchCollectedOrders1794411000000 implements MigrationInterface {
  name='WorkbenchCollectedOrders1794411000000'
  async up(q:QueryRunner):Promise<void>{
    await q.query(`CREATE TABLE hz_fop_collected_batches (
      id uuid PRIMARY KEY, workspace_owner_id uuid NOT NULL, tenant_id text NOT NULL, company_id text NOT NULL,
      state text NOT NULL CHECK(state IN ('staging','active','failed','superseded')),
      source_as_of timestamptz NOT NULL, completed_at timestamptz,
      row_count integer NOT NULL DEFAULT 0 CHECK(row_count>=0), page_count integer NOT NULL DEFAULT 0 CHECK(page_count>=0),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    )`)
    await q.query(`CREATE UNIQUE INDEX ix_collected_active_batch ON hz_fop_collected_batches(workspace_owner_id,tenant_id,company_id) WHERE state='active'`)
    await q.query(`CREATE TABLE hz_fop_collected_orders (
      batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE, source_id text NOT NULL, order_number text NOT NULL,
      owner_employee_id text, customer_id text, warehouse_code text, country_code text, bill_type text,
      raw_bill_status text, raw_order_status text, raw_payment_status text, raw_delivery_status text,
      created_at timestamptz, paid_at timestamptz, consumer_paid_at timestamptz,
      product_amount numeric, total_amount numeric, currency_code text, total_quantity numeric,
      search_text text NOT NULL, display jsonb NOT NULL, raw jsonb NOT NULL, PRIMARY KEY(batch_id,source_id)
    )`)
    await q.query('CREATE INDEX ix_collected_scope ON hz_fop_collected_orders(batch_id,owner_employee_id,paid_at DESC,source_id)')
    await q.query('CREATE INDEX ix_collected_queue ON hz_fop_collected_orders(batch_id,raw_bill_status,raw_payment_status,raw_order_status)')
    await q.query("COMMENT ON TABLE hz_fop_collected_orders IS '旧API单轮采集只读事实；非一致快照、非正式副本、不生成授权租约；未知事实留空。'")
  }
  async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE hz_fop_collected_orders');await q.query('DROP TABLE hz_fop_collected_batches')}
}

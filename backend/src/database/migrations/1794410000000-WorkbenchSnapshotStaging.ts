import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Durable INTERNAL normalized snapshot pages. Never accepts SQL/table payloads from a public endpoint. */
export class WorkbenchSnapshotStaging1794410000000 implements MigrationInterface {
  name='WorkbenchSnapshotStaging1794410000000'
  async up(q:QueryRunner):Promise<void>{
    await q.query(`CREATE TABLE hz_fop_bootstrap_pages (
      id uuid PRIMARY KEY,
      connection_id uuid NOT NULL,
      company_id uuid NOT NULL,
      dataset_id uuid NOT NULL,
      batch_id uuid NOT NULL REFERENCES hz_fop_bootstrap_batches(id) ON DELETE CASCADE,
      stream_id uuid NOT NULL REFERENCES hz_fop_sync_streams(id) ON DELETE CASCADE,
      snapshot_id varchar(200) NOT NULL,
      page_index integer NOT NULL CHECK(page_index>=0),
      after_cursor text,
      end_cursor text,
      complete boolean NOT NULL,
      groups jsonb NOT NULL CHECK(jsonb_typeof(groups)='array'),
      payload_hash varchar(64) NOT NULL,
      state varchar(40) NOT NULL DEFAULT 'collected' CHECK(state IN ('collected','prepared','applied')),
      collected_at timestamptz NOT NULL DEFAULT now(),
      applied_at timestamptz,
      UNIQUE(batch_id,stream_id,page_index),
      FOREIGN KEY(connection_id,company_id) REFERENCES hz_fop_companies(connection_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(company_id,dataset_id) REFERENCES hz_fop_datasets(company_id,id) ON DELETE RESTRICT
    )`)
    await q.query('CREATE INDEX ix_hz_fop_bootstrap_pages_pending ON hz_fop_bootstrap_pages(batch_id,state,stream_id,page_index)')
    await q.query("COMMENT ON TABLE hz_fop_bootstrap_pages IS '初始化内部归一化快照持久暂存；采集分页与业务发布游标分离。所有快照页收齐后创建未验证身份骨架，完整发布与校验后才允许数据集激活；不表示真实FOP接口已提供。'")
  }
  async down(q:QueryRunner):Promise<void>{await q.query('DROP TABLE hz_fop_bootstrap_pages')}
}

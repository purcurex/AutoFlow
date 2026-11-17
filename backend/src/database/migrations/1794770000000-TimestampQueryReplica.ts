import type { MigrationInterface, QueryRunner } from 'typeorm'

export class TimestampQueryReplica1794770000000 implements MigrationInterface {
 name='TimestampQueryReplica1794770000000'
 async up(q:QueryRunner){
  await q.query(`CREATE TABLE hz_fop_timestamp_state (
    batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
    entity_code text NOT NULL, watermark text, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(batch_id,entity_code))`)
  await q.query(`CREATE TABLE hz_fop_timestamp_runs (
    id uuid PRIMARY KEY, batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
    entity_code text NOT NULL, mode text NOT NULL CHECK(mode IN ('initialize','incremental','reconcile')),
    state text NOT NULL CHECK(state IN ('running','applied','projection_pending','failed')),
    lower_bound text, upper_bound text, error_code text, page_count integer NOT NULL DEFAULT 0,
    row_count integer NOT NULL DEFAULT 0, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`)
  await q.query(`CREATE TABLE hz_fop_timestamp_pages (
    run_id uuid NOT NULL REFERENCES hz_fop_timestamp_runs(id) ON DELETE CASCADE,
    page_index integer NOT NULL, query jsonb NOT NULL, documents jsonb NOT NULL, payload_hash text NOT NULL,
    PRIMARY KEY(run_id,page_index))`)
  await q.query(`CREATE TABLE hz_fop_timestamp_documents (
    batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
    entity_code text NOT NULL, source_id text NOT NULL, company_id text NOT NULL,
    created_at text, modified_at text, raw jsonb NOT NULL, payload_hash text NOT NULL,
    removed boolean NOT NULL DEFAULT false, last_run_id uuid NOT NULL REFERENCES hz_fop_timestamp_runs(id),
    captured_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(batch_id,entity_code,source_id))`)
  await q.query(`CREATE TABLE hz_fop_timestamp_projection_tasks (
    batch_id uuid NOT NULL REFERENCES hz_fop_collected_batches(id) ON DELETE CASCADE,
    entity_code text NOT NULL, source_id text NOT NULL, run_id uuid NOT NULL REFERENCES hz_fop_timestamp_runs(id),
    state text NOT NULL CHECK(state IN ('pending','applied')), reason text,
    previous_raw jsonb, current_raw jsonb, removed boolean NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(batch_id,entity_code,source_id))`)
  await q.query('CREATE INDEX ix_timestamp_runs_scope ON hz_fop_timestamp_runs(batch_id,entity_code,started_at DESC)')
  await q.query("COMMENT ON TABLE hz_fop_timestamp_state IS '时间增量采集水位；不代表事务屏障或工作台全部投影完成。原始时间字符串保留源精度。'")
 }
 async down(q:QueryRunner){for(const table of ['projection_tasks','documents','pages','runs','state'])await q.query(`DROP TABLE hz_fop_timestamp_${table}`)}
}

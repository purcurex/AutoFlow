import { MigrationInterface, QueryRunner } from 'typeorm'
export class FopApiBudgets1795650000000 implements MigrationInterface {
  async up(q:QueryRunner){await q.query(`CREATE TABLE hz_fop_api_budgets (
    scope text PRIMARY KEY, state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(state)='object'),
    updated_at timestamptz NOT NULL DEFAULT now());
    COMMENT ON TABLE hz_fop_api_budgets IS 'Shared per-source rolling API budgets and persistent gateway cooldown; no tokens or business payloads.';`)}
  async down(q:QueryRunner){await q.query('DROP TABLE hz_fop_api_budgets')}
}

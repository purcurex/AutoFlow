import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddLeadDiscoveryLinks1784709060000 implements MigrationInterface {
  name = 'AddLeadDiscoveryLinks1784709060000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "normalized_domain" character varying(255)')
    await queryRunner.query(`
      UPDATE "leads"
      SET "normalized_domain" = lower(regexp_replace("domain", '^www\\.', ''))
      WHERE "normalized_domain" IS NULL
    `)
    await queryRunner.query('ALTER TABLE "leads" ALTER COLUMN "normalized_domain" SET NOT NULL')
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_leads_owner_normalized_domain" ON "leads" ("owner_user_id", "normalized_domain")',
    )

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid NOT NULL,
        "lead_id" uuid NOT NULL,
        "source" character varying(120) NOT NULL,
        "source_reference" character varying(500),
        "source_score" double precision NOT NULL DEFAULT 0,
        "metadata" jsonb,
        "discovered_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_leads" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workflow_leads_run_lead" UNIQUE ("workflow_run_id", "lead_id"),
        CONSTRAINT "chk_workflow_leads_source_score" CHECK ("source_score" >= 0 AND "source_score" <= 100),
        CONSTRAINT "fk_workflow_leads_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_workflow_leads_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_workflow_leads_run_discovered_at" ON "workflow_leads" ("workflow_run_id", "discovered_at")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_workflow_leads_lead_id" ON "workflow_leads" ("lead_id")',
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "workflow_leads"')
    await queryRunner.query('DROP INDEX IF EXISTS "uq_leads_owner_normalized_domain"')
    await queryRunner.query('ALTER TABLE "leads" DROP COLUMN IF EXISTS "normalized_domain"')
  }
}

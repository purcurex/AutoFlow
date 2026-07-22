import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddQuotationSnapshots1784714000000 implements MigrationInterface {
  name = 'AddQuotationSnapshots1784714000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quotations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL,
        "lead_id" uuid,
        "title" varchar(160) NOT NULL DEFAULT 'Customer quotation',
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "currency" char(3) NOT NULL,
        "current_version" integer NOT NULL DEFAULT 1,
        "valid_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_quotations" PRIMARY KEY ("id"),
        CONSTRAINT "fk_quotations_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_quotations_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_quotations_current_version" CHECK ("current_version" > 0),
        CONSTRAINT "chk_quotations_status" CHECK ("status" IN ('draft', 'ready', 'expired', 'cancelled'))
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_quotations_owner_updated_at" ON "quotations" ("owner_user_id", "updated_at")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_quotations_lead_id" ON "quotations" ("lead_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_quotations_status" ON "quotations" ("status")')
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "quotation_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "quotation_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "request_snapshot" jsonb NOT NULL,
        "result_snapshot" jsonb,
        "product_cost_status" varchar(24) NOT NULL DEFAULT 'not_requested',
        "logistics_rate_status" varchar(24) NOT NULL DEFAULT 'not_requested',
        "source_version" varchar(120),
        "effective_at" timestamptz,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_quotation_versions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_quotation_versions_quote_version" UNIQUE ("quotation_id", "version"),
        CONSTRAINT "fk_quotation_versions_quote" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_quotation_versions_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_quotation_versions_version" CHECK ("version" > 0)
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_quotation_versions_quote_created_at" ON "quotation_versions" ("quotation_id", "created_at")')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "quotation_versions"')
    await queryRunner.query('DROP TABLE IF EXISTS "quotations"')
  }
}

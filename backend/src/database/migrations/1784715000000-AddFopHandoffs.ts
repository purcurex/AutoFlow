import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddFopHandoffs1784715000000 implements MigrationInterface {
  name = 'AddFopHandoffs1784715000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fop_handoffs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "lead_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "idempotency_key" varchar(160) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "fop_lead_id" varchar(160),
        "fop_opportunity_id" varchar(160),
        "conflicts" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "last_error" text,
        "attempts" integer NOT NULL DEFAULT 0,
        "last_synced_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_fop_handoffs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_fop_handoffs_lead" UNIQUE ("lead_id"),
        CONSTRAINT "uq_fop_handoffs_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "fk_fop_handoffs_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_fop_handoffs_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_fop_handoffs_attempts" CHECK ("attempts" >= 0),
        CONSTRAINT "chk_fop_handoffs_status" CHECK ("status" IN ('pending', 'succeeded', 'requires_review', 'failed', 'unavailable'))
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_fop_handoffs_owner_updated_at" ON "fop_handoffs" ("owner_user_id", "updated_at")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_fop_handoffs_status" ON "fop_handoffs" ("status")')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "fop_handoffs"')
  }
}

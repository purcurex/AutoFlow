import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddDiscoveryVerificationEvidence1784713000000 implements MigrationInterface {
  name = 'AddDiscoveryVerificationEvidence1784713000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shopify_stores"
      ADD COLUMN IF NOT EXISTS "verification_status" varchar(24) NOT NULL DEFAULT 'unverified',
      ADD COLUMN IF NOT EXISTS "verification_evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "verified_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "contacts" jsonb NOT NULL DEFAULT '[]'::jsonb
    `)
    await queryRunner.query(`
      ALTER TABLE "lead_contacts"
      ADD COLUMN IF NOT EXISTS "source_url" varchar(1000),
      ADD COLUMN IF NOT EXISTS "source_type" varchar(80) NOT NULL DEFAULT 'manual',
      ADD COLUMN IF NOT EXISTS "verification_status" varchar(24) NOT NULL DEFAULT 'unverified',
      ADD COLUMN IF NOT EXISTS "confidence" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb
    `)
    await queryRunner.query(`
      ALTER TABLE "lead_contacts"
      ADD CONSTRAINT "chk_lead_contacts_confidence" CHECK ("confidence" >= 0 AND "confidence" <= 100)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_lead_contacts_verification_status"
      ON "lead_contacts" ("verification_status")
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shopify_stores_verification_status"
      ON "shopify_stores" ("verification_status")
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_shopify_stores_verification_status"')
    await queryRunner.query('DROP INDEX IF EXISTS "idx_lead_contacts_verification_status"')
    await queryRunner.query('ALTER TABLE "lead_contacts" DROP CONSTRAINT IF EXISTS "chk_lead_contacts_confidence"')
    await queryRunner.query(`
      ALTER TABLE "lead_contacts"
      DROP COLUMN IF EXISTS "evidence",
      DROP COLUMN IF EXISTS "confidence",
      DROP COLUMN IF EXISTS "verification_status",
      DROP COLUMN IF EXISTS "source_type",
      DROP COLUMN IF EXISTS "source_url"
    `)
    await queryRunner.query(`
      ALTER TABLE "shopify_stores"
      DROP COLUMN IF EXISTS "contacts",
      DROP COLUMN IF EXISTS "verified_at",
      DROP COLUMN IF EXISTS "verification_evidence",
      DROP COLUMN IF EXISTS "verification_status"
    `)
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddShopifyProspectingEvidence1784718000000 implements MigrationInterface {
  name = 'AddShopifyProspectingEvidence1784718000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
      ADD COLUMN IF NOT EXISTS "search_options" jsonb NOT NULL
      DEFAULT '{"exactPhrase":true,"titleMatch":false,"excludeMarketplaces":true,"findOwnerFacebook":true}'::jsonb
    `)
    await queryRunner.query(`
      ALTER TABLE "leads"
      ADD COLUMN IF NOT EXISTS "product_url" varchar(1000),
      ADD COLUMN IF NOT EXISTS "discovery_sources" jsonb NOT NULL DEFAULT '[]'::jsonb
    `)
    await queryRunner.query(`
      ALTER TABLE "shopify_stores"
      ADD COLUMN IF NOT EXISTS "product_url" varchar(1000),
      ADD COLUMN IF NOT EXISTS "discovery_sources" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "validity_score" double precision NOT NULL DEFAULT 0
    `)
    await queryRunner.query(`
      ALTER TABLE "shopify_stores"
      DROP CONSTRAINT IF EXISTS "chk_shopify_stores_validity_score"
    `)
    await queryRunner.query(`
      ALTER TABLE "shopify_stores"
      ADD CONSTRAINT "chk_shopify_stores_validity_score"
      CHECK ("validity_score" >= 0 AND "validity_score" <= 100)
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shopify_stores_run_validity"
      ON "shopify_stores" ("workflow_run_id", "validity_score" DESC)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_shopify_stores_run_validity"')
    await queryRunner.query('ALTER TABLE "shopify_stores" DROP CONSTRAINT IF EXISTS "chk_shopify_stores_validity_score"')
    await queryRunner.query('ALTER TABLE "shopify_stores" DROP COLUMN IF EXISTS "validity_score", DROP COLUMN IF EXISTS "discovery_sources", DROP COLUMN IF EXISTS "product_url"')
    await queryRunner.query('ALTER TABLE "leads" DROP COLUMN IF EXISTS "discovery_sources", DROP COLUMN IF EXISTS "product_url"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP COLUMN IF EXISTS "search_options"')
  }
}

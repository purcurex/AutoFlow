import type { MigrationInterface, QueryRunner } from 'typeorm'

/** 为1688分页与供应商名称短期复用增加租户隔离的缓存元数据和查询索引。 */
export class AddSourcingResponseCacheMetadata1784730000000 implements MigrationInterface {
  name = 'AddSourcingResponseCacheMetadata1784730000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sourcing_searches"
        ADD COLUMN "cache_fingerprint" varchar(64)
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_search_pages"
        ADD COLUMN "cache_hit" boolean NOT NULL DEFAULT false,
        ADD COLUMN "cache_source_page_id" uuid
    `)
    await queryRunner.query(`
      CREATE INDEX "idx_sourcing_searches_cache_lookup"
      ON "sourcing_searches" (
        "owner_user_id", "provider", "cache_fingerprint", "created_at" DESC
      )
      WHERE "cache_fingerprint" IS NOT NULL
    `)
    await queryRunner.query(`
      CREATE INDEX "idx_sourcing_pages_cache_lookup"
      ON "sourcing_search_pages" (
        "page_number", "page_size", "status", "completed_at" DESC
      )
    `)
    await queryRunner.query(`
      CREATE INDEX "idx_sourcing_offers_owner_provider_offer_recent"
      ON "sourcing_offers" (
        "owner_user_id", "provider", "offer_id", "retrieved_at" DESC
      )
    `)
    await queryRunner.query(`
      CREATE INDEX "idx_sourcing_suppliers_owner_provider_open_recent"
      ON "sourcing_suppliers" (
        "owner_user_id", "provider", "open_id", "updated_at" DESC
      )
      WHERE "open_id" IS NOT NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_sourcing_suppliers_owner_provider_open_recent"',
    )
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_sourcing_offers_owner_provider_offer_recent"',
    )
    await queryRunner.query('DROP INDEX IF EXISTS "idx_sourcing_pages_cache_lookup"')
    await queryRunner.query('DROP INDEX IF EXISTS "idx_sourcing_searches_cache_lookup"')
    await queryRunner.query(`
      ALTER TABLE "sourcing_search_pages"
        DROP COLUMN IF EXISTS "cache_source_page_id",
        DROP COLUMN IF EXISTS "cache_hit"
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_searches"
        DROP COLUMN IF EXISTS "cache_fingerprint"
    `)
  }
}

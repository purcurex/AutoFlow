import type { MigrationInterface, QueryRunner } from 'typeorm'

/** 为同一次寻源增加保守的商品指纹，补充识别同供应商的完全重复商品。 */
export class AddSourcingOfferProductFingerprint1784729000000 implements MigrationInterface {
  name = 'AddSourcingOfferProductFingerprint1784729000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sourcing_offers"
        ADD COLUMN "product_fingerprint" varchar(64)
    `)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_sourcing_offers_search_provider_fingerprint"
      ON "sourcing_offers" ("search_id", "provider", "product_fingerprint")
      WHERE "product_fingerprint" IS NOT NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "uq_sourcing_offers_search_provider_fingerprint"',
    )
    await queryRunner.query(`
      ALTER TABLE "sourcing_offers"
        DROP COLUMN IF EXISTS "product_fingerprint"
    `)
  }
}


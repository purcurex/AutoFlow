import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddFopUserBindings1784729000000 implements MigrationInterface {
  name = 'AddFopUserBindings1784729000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "fop_tenant_id" varchar(128),
      ADD COLUMN "fop_user_id" varchar(128),
      ADD CONSTRAINT "uq_users_fop_identity" UNIQUE ("fop_tenant_id", "fop_user_id"),
      ADD CONSTRAINT "chk_users_fop_identity" CHECK (
        ("fop_tenant_id" IS NULL AND "fop_user_id" IS NULL)
        OR (
          "fop_tenant_id" IS NOT NULL AND "fop_user_id" IS NOT NULL
          AND char_length("fop_tenant_id") BETWEEN 1 AND 128
          AND char_length("fop_user_id") BETWEEN 1 AND 128
          AND "fop_tenant_id" !~ '^[[:space:]]|[[:space:]]$'
          AND "fop_user_id" !~ '^[[:space:]]|[[:space:]]$'
        )
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP CONSTRAINT "chk_users_fop_identity",
      DROP CONSTRAINT "uq_users_fop_identity",
      DROP COLUMN "fop_tenant_id",
      DROP COLUMN "fop_user_id"
    `)
  }
}

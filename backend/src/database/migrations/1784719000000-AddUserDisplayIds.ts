import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddUserDisplayIds1784719000000 implements MigrationInterface {
  name = 'AddUserDisplayIds1784719000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS "users_display_id_seq"
      START WITH 2 INCREMENT BY 1 MINVALUE 2 MAXVALUE 999999
    `)
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "display_id" varchar(6)
    `)
    await queryRunner.query(`
      WITH canonical_admin AS (
        SELECT "id"
        FROM "users"
        WHERE "role" = 'admin'
        ORDER BY "created_at", "id"
        LIMIT 1
      )
      UPDATE "users"
      SET "username" = CONCAT("username", '-', SUBSTRING("id"::text, 1, 6))
      WHERE "username" = 'Admin'
        AND "id" <> COALESCE((SELECT "id" FROM canonical_admin), '00000000-0000-0000-0000-000000000000'::uuid)
    `)
    await queryRunner.query(`
      WITH canonical_admin AS (
        SELECT "id"
        FROM "users"
        WHERE "role" = 'admin'
        ORDER BY "created_at", "id"
        LIMIT 1
      )
      UPDATE "users"
      SET "display_id" = '000001', "username" = 'Admin'
      WHERE "id" = (SELECT "id" FROM canonical_admin)
    `)
    await queryRunner.query(`
      WITH canonical_admin AS (
        SELECT "id"
        FROM "users"
        WHERE "role" = 'admin'
        ORDER BY "created_at", "id"
        LIMIT 1
      ), ranked_users AS (
        SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") + 1 AS sequence_number
        FROM "users"
        WHERE "id" <> COALESCE((SELECT "id" FROM canonical_admin), '00000000-0000-0000-0000-000000000000'::uuid)
      )
      UPDATE "users" AS target
      SET "display_id" = LPAD(ranked_users.sequence_number::text, 6, '0')
      FROM ranked_users
      WHERE target."id" = ranked_users."id"
    `)
    await queryRunner.query(`
      SELECT setval(
        'users_display_id_seq',
        GREATEST(COALESCE((SELECT MAX("display_id"::integer) FROM "users"), 1) + 1, 2),
        false
      )
    `)
    await queryRunner.query(`
      ALTER TABLE "users"
      ALTER COLUMN "display_id" SET DEFAULT LPAD(nextval('users_display_id_seq')::text, 6, '0'),
      ALTER COLUMN "display_id" SET NOT NULL
    `)
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "uq_users_display_id" UNIQUE ("display_id"),
      ADD CONSTRAINT "chk_users_display_id" CHECK ("display_id" ~ '^[0-9]{6}$')
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_display_id", DROP CONSTRAINT IF EXISTS "uq_users_display_id"')
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN IF EXISTS "display_id"')
    await queryRunner.query('DROP SEQUENCE IF EXISTS "users_display_id_seq"')
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOwnerScopedWorkflowDisplayIds1784727000000 implements MigrationInterface {
  name = 'AddOwnerScopedWorkflowDisplayIds1784727000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "next_workflow_number" integer NOT NULL DEFAULT 1
    `)
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
      ADD COLUMN "display_id" varchar(6)
    `)
    await queryRunner.query(`
      WITH ranked_workflows AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "owner_user_id"
            ORDER BY "created_at", "id"
          ) AS sequence_number
        FROM "workflow_runs"
      )
      UPDATE "workflow_runs" AS workflow
      SET "display_id" = CASE
        WHEN ranked_workflows.sequence_number < 100
          THEN LPAD(ranked_workflows.sequence_number::text, 2, '0')
        ELSE ranked_workflows.sequence_number::text
      END
      FROM ranked_workflows
      WHERE workflow."id" = ranked_workflows."id"
    `)
    await queryRunner.query(`
      UPDATE "users" AS owner
      SET "next_workflow_number" = COALESCE((
        SELECT MAX(workflow."display_id"::integer) + 1
        FROM "workflow_runs" AS workflow
        WHERE workflow."owner_user_id" = owner."id"
      ), 1)
    `)
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
      ALTER COLUMN "display_id" SET NOT NULL,
      ADD CONSTRAINT "uq_workflow_runs_owner_display_id"
        UNIQUE ("owner_user_id", "display_id"),
      ADD CONSTRAINT "chk_workflow_runs_display_id"
        CHECK (
          "display_id" ~ '^[0-9]{2,6}$'
          AND "display_id"::integer BETWEEN 1 AND 999999
        )
    `)
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "chk_users_next_workflow_number"
        CHECK ("next_workflow_number" BETWEEN 1 AND 1000000)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP CONSTRAINT IF EXISTS "chk_users_next_workflow_number",
      DROP COLUMN IF EXISTS "next_workflow_number"
    `)
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
      DROP CONSTRAINT IF EXISTS "chk_workflow_runs_display_id",
      DROP CONSTRAINT IF EXISTS "uq_workflow_runs_owner_display_id",
      DROP COLUMN IF EXISTS "display_id"
    `)
  }
}

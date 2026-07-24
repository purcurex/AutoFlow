import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWorkflowRevisionLifecycle1784722000000 implements MigrationInterface {
  name = 'AddWorkflowRevisionLifecycle1784722000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        ADD COLUMN "parent_workflow_run_id" uuid,
        ADD COLUMN "root_workflow_run_id" uuid,
        ADD COLUMN "revision_no" integer NOT NULL DEFAULT 1,
        ADD COLUMN "archived_at" timestamptz
    `)
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        ADD CONSTRAINT "fk_workflow_runs_parent"
          FOREIGN KEY ("parent_workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "fk_workflow_runs_root"
          FOREIGN KEY ("root_workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "chk_workflow_runs_revision_no" CHECK ("revision_no" >= 1)
    `)
    await queryRunner.query(
      'CREATE INDEX "idx_workflow_runs_parent_id" ON "workflow_runs" ("parent_workflow_run_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_workflow_runs_root_revision" ON "workflow_runs" ("root_workflow_run_id", "revision_no")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_workflow_runs_owner_archived_at" ON "workflow_runs" ("owner_user_id", "archived_at")',
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_workflow_runs_owner_archived_at"')
    await queryRunner.query('DROP INDEX IF EXISTS "idx_workflow_runs_root_revision"')
    await queryRunner.query('DROP INDEX IF EXISTS "idx_workflow_runs_parent_id"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP CONSTRAINT IF EXISTS "chk_workflow_runs_revision_no"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP CONSTRAINT IF EXISTS "fk_workflow_runs_root"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP CONSTRAINT IF EXISTS "fk_workflow_runs_parent"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP COLUMN IF EXISTS "archived_at"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP COLUMN IF EXISTS "revision_no"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP COLUMN IF EXISTS "root_workflow_run_id"')
    await queryRunner.query('ALTER TABLE "workflow_runs" DROP COLUMN IF EXISTS "parent_workflow_run_id"')
  }
}

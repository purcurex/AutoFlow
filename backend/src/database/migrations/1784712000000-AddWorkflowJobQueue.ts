import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWorkflowJobQueue1784712000000 implements MigrationInterface {
  name = 'AddWorkflowJobQueue1784712000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "autoflow_workflow_job_status_enum" AS ENUM ('queued', 'running', 'completed', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "status" "autoflow_workflow_job_status_enum" NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "lease_owner" varchar(160),
        "lease_expires_at" timestamptz,
        "heartbeat_at" timestamptz,
        "last_error" text,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workflow_jobs_workflow_run" UNIQUE ("workflow_run_id"),
        CONSTRAINT "fk_workflow_jobs_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_workflow_jobs_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_workflow_jobs_attempts" CHECK ("attempts" >= 0 AND "max_attempts" > 0 AND "attempts" <= "max_attempts")
      )
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workflow_jobs_status_available_at"
      ON "workflow_jobs" ("status", "available_at")
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workflow_jobs_lease_expires_at"
      ON "workflow_jobs" ("lease_expires_at")
    `)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workflow_jobs_owner_created_at"
      ON "workflow_jobs" ("owner_user_id", "created_at")
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "workflow_jobs"')
    await queryRunner.query('DROP TYPE IF EXISTS "autoflow_workflow_job_status_enum"')
  }
}

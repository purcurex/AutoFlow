import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWorkflowExecutionGuards1784711000000 implements MigrationInterface {
  name = 'AddWorkflowExecutionGuards1784711000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_lead_scores_lead_workflow"
      ON "lead_scores" ("lead_id", "workflow_run_id")
      WHERE "workflow_run_id" IS NOT NULL
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_lead_scores_lead_workflow"')
  }
}

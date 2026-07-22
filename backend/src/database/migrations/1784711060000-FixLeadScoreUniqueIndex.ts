import { MigrationInterface, QueryRunner } from 'typeorm'

export class FixLeadScoreUniqueIndex1784711060000 implements MigrationInterface {
  name = 'FixLeadScoreUniqueIndex1784711060000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_lead_scores_lead_workflow"')
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_lead_scores_lead_workflow"
      ON "lead_scores" ("lead_id", "workflow_run_id")
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "uq_lead_scores_lead_workflow"')
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_lead_scores_lead_workflow"
      ON "lead_scores" ("lead_id", "workflow_run_id")
      WHERE "workflow_run_id" IS NOT NULL
    `)
  }
}

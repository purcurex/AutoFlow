import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddLeadPoolWorkflowOrdering1784725000000 implements MigrationInterface {
  name = 'AddLeadPoolWorkflowOrdering1784725000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workflow_leads_run_score_discovered"
      ON "workflow_leads" ("workflow_run_id", "source_score" DESC, "discovered_at" DESC)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_workflow_leads_run_score_discovered"')
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOutreachTemplateOptions1784720000000 implements MigrationInterface {
  name = 'AddOutreachTemplateOptions1784720000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "outreach_tasks"
      ADD COLUMN IF NOT EXISTS "template_options" jsonb NOT NULL DEFAULT '{}'::jsonb
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "outreach_tasks" DROP COLUMN IF EXISTS "template_options"')
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOutreachDeliveryContext1784716000000 implements MigrationInterface {
  name = 'AddOutreachDeliveryContext1784716000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "outreach_tasks"
      ADD COLUMN IF NOT EXISTS "target_contact" varchar(500),
      ADD COLUMN IF NOT EXISTS "subject" varchar(200),
      ADD COLUMN IF NOT EXISTS "template_key" varchar(80) NOT NULL DEFAULT 'legacy-first-touch-v1'
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_outreach_tasks_template_key" ON "outreach_tasks" ("template_key")')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_outreach_tasks_template_key"')
    await queryRunner.query(`
      ALTER TABLE "outreach_tasks"
      DROP COLUMN IF EXISTS "template_key",
      DROP COLUMN IF EXISTS "subject",
      DROP COLUMN IF EXISTS "target_contact"
    `)
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOutreachOtherChannel1784726000000 implements MigrationInterface {
  name = 'AddOutreachOtherChannel1784726000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."autoflow_outreach_channel_enum"
      ADD VALUE IF NOT EXISTS 'other'
    `)
    await queryRunner.query(`
      ALTER TYPE "public"."autoflow_lead_contact_type_enum"
      ADD VALUE IF NOT EXISTS 'other'
    `)
  }

  // PostgreSQL enum values are intentionally retained on rollback to avoid
  // rebuilding both enum-backed tables and invalidating existing records.
  async down(_queryRunner: QueryRunner): Promise<void> {}
}

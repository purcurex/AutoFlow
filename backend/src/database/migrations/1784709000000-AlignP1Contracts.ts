import { MigrationInterface, QueryRunner } from 'typeorm'

export class AlignP1Contracts1784709000000 implements MigrationInterface {
  name = 'AlignP1Contracts1784709000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "public"."autoflow_workflow_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`)
    await queryRunner.query(`ALTER TYPE "public"."autoflow_outreach_status_enum" ADD VALUE IF NOT EXISTS 'failed'`)
    await queryRunner.query(`ALTER TYPE "public"."autoflow_lead_contact_type_enum" ADD VALUE IF NOT EXISTS 'linkedin'`)
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL enum value removal requires rebuilding dependent columns; keep values on rollback.
  }
}

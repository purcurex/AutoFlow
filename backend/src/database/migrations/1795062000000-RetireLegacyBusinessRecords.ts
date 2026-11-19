import { MigrationInterface, QueryRunner } from 'typeorm'

/** Retire only the former document-record store; FOP and analytics tables are independent. */
export class RetireLegacyBusinessRecords1795062000000 implements MigrationInterface {
  name = 'RetireLegacyBusinessRecords1795062000000'
  transaction = true

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("SET LOCAL lock_timeout = '5s'")
    // RESTRICT keeps any unexpected business dependency intact and rolls back this migration.
    await queryRunner.query('DROP TABLE IF EXISTS public.notes RESTRICT')
    await queryRunner.query('DROP TABLE IF EXISTS public.folders RESTRICT')
    await queryRunner.query('DROP TYPE IF EXISTS public.notes_editor_type_enum RESTRICT')
  }

  async down(): Promise<void> {
    throw new Error('Historical business records must be restored from the pre-cleanup database backup.')
  }
}

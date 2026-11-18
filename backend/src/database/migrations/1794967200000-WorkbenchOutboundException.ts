import { MigrationInterface, QueryRunner } from 'typeorm'

export class WorkbenchOutboundException1794967200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE hz_fop_exception_marks DROP CONSTRAINT ck_hz_fop_exception_marks_type')
    await runner.query("ALTER TABLE hz_fop_exception_marks ADD CONSTRAINT ck_hz_fop_exception_marks_type CHECK (type IN ('procurement_exception','dispatch_exception','allocation_exception','logistics_exception','outbound_exception','delivery_exception'))")
  }
  async down(runner: QueryRunner): Promise<void> {
    // Refuse rollback while this new category is in use; never delete or reclassify business records.
    await runner.query('ALTER TABLE hz_fop_exception_marks DROP CONSTRAINT ck_hz_fop_exception_marks_type')
    await runner.query("ALTER TABLE hz_fop_exception_marks ADD CONSTRAINT ck_hz_fop_exception_marks_type CHECK (type IN ('procurement_exception','dispatch_exception','allocation_exception','logistics_exception','delivery_exception'))")
  }
}

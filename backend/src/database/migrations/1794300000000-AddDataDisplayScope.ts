import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddDataDisplayScope1794300000000 implements MigrationInterface {
  name = 'AddDataDisplayScope1794300000000'
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE users ADD COLUMN data_display_scope varchar(16) NOT NULL DEFAULT 'department',
      ADD CONSTRAINT chk_users_data_display_scope CHECK (data_display_scope IN ('department','self'))`)
  }
  async down(runner: QueryRunner) {
    await runner.query('ALTER TABLE users DROP COLUMN data_display_scope')
  }
}

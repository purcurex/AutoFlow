import { MigrationInterface, QueryRunner } from 'typeorm'

export class DefaultManagerDisplayToSelf1794300001000 implements MigrationInterface {
  name = 'DefaultManagerDisplayToSelf1794300001000'
  async up(runner: QueryRunner) {
    await runner.query("ALTER TABLE users ALTER COLUMN data_display_scope SET DEFAULT 'self'")
    // One-time correction of the initial department default for existing managers.
    // Subsequent self-service selections are retained; never reset preferences on login.
    await runner.query("UPDATE users SET data_display_scope='self' WHERE role='user' AND business_role='department_manager' AND data_display_scope='department'")
  }
  async down(runner: QueryRunner) {
    // Do not overwrite user choices when rolling back the database default.
    await runner.query("ALTER TABLE users ALTER COLUMN data_display_scope SET DEFAULT 'department'")
  }
}

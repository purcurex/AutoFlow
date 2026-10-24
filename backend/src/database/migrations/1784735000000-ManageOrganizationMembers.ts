import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ManageOrganizationMembers1784735000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE organization_employees ADD COLUMN job_title varchar(100) NOT NULL DEFAULT '', ADD COLUMN phone varchar(40) NOT NULL DEFAULT '', ADD COLUMN archived_at timestamptz NULL")
    await runner.query('ALTER TABLE users ADD COLUMN account_disabled boolean NOT NULL DEFAULT false, ADD COLUMN session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0)')
  }
  async down(runner: QueryRunner): Promise<void> {
    if ((await runner.query('SELECT 1 FROM users WHERE account_disabled OR session_version > 0 UNION ALL SELECT 1 FROM organization_employees WHERE archived_at IS NOT NULL LIMIT 1')).length) throw new Error('Cannot remove account revocation while disabled accounts or archived members exist')
    await runner.query('ALTER TABLE users DROP COLUMN account_disabled, DROP COLUMN session_version')
    await runner.query('ALTER TABLE organization_employees DROP COLUMN job_title, DROP COLUMN phone, DROP COLUMN archived_at')
  }
}

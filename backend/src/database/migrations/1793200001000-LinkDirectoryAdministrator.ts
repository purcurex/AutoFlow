import { MigrationInterface, QueryRunner } from 'typeorm'
export class LinkDirectoryAdministrator1793200001000 implements MigrationInterface {
  name = 'LinkDirectoryAdministrator1793200001000'
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE users ADD COLUMN organization_workspace_owner_id uuid,
      ADD CONSTRAINT fk_user_directory_owner FOREIGN KEY (organization_workspace_owner_id) REFERENCES users(id) ON DELETE RESTRICT`)
  }
  async down(runner: QueryRunner) {
    const [row] = await runner.query('SELECT count(*)::int AS count FROM users WHERE organization_workspace_owner_id IS NOT NULL')
    if (row.count) throw new Error('Remove directory administrator links explicitly before rollback')
    await runner.query('ALTER TABLE users DROP COLUMN organization_workspace_owner_id')
  }
}

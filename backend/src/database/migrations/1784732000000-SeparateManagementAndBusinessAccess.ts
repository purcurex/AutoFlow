import { MigrationInterface, QueryRunner } from 'typeorm'

export class SeparateManagementAndBusinessAccess1784732000000 implements MigrationInterface {
  name = 'SeparateManagementAndBusinessAccess1784732000000'

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT chk_users_business_role,
      ADD CONSTRAINT chk_users_business_role CHECK (business_role IN ('none','admin','department_manager','salesperson'))`)
    // Preserve existing administrators' effective data access once, without coupling
    // future system role assignments or changes to their separately stored data grant.
    await queryRunner.query(`UPDATE users SET business_role = 'admin' WHERE role = 'admin'`)
  }

  async down(queryRunner: QueryRunner) {
    const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM users WHERE business_role = 'none'`)
    if (count > 0) throw new Error('Assign explicit business scopes before rolling back: management-only accounts would gain business access')
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT chk_users_business_role,
      ADD CONSTRAINT chk_users_business_role CHECK (business_role IN ('admin','department_manager','salesperson'))`)
  }
}

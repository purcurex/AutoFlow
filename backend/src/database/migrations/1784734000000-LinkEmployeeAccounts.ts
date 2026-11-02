import type { MigrationInterface, QueryRunner } from 'typeorm'

export class LinkEmployeeAccounts1784734000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE organization_employees ADD COLUMN account_id uuid REFERENCES users(id) ON DELETE SET NULL')
    await queryRunner.query('CREATE UNIQUE INDEX uq_organization_employee_account ON organization_employees(account_id) WHERE account_id IS NOT NULL')
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE organization_employees DROP COLUMN account_id')
  }
}

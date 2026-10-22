import { MigrationInterface, QueryRunner } from 'typeorm'
export class AddBusinessDataScopes1784731000000 implements MigrationInterface {
  name = 'AddBusinessDataScopes1784731000000'
  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN business_role varchar(24) NOT NULL DEFAULT 'salesperson', ADD COLUMN business_department_id varchar(128), ADD COLUMN business_employee_id varchar(128), ADD CONSTRAINT chk_users_business_role CHECK (business_role IN ('admin','department_manager','salesperson')), ADD CONSTRAINT chk_users_business_ids CHECK ((business_department_id IS NULL OR (char_length(business_department_id) > 0 AND business_department_id = btrim(business_department_id))) AND (business_employee_id IS NULL OR (char_length(business_employee_id) > 0 AND business_employee_id = btrim(business_employee_id))))`)
    await queryRunner.query(`ALTER TABLE sourcing_offers ALTER COLUMN currency SET DEFAULT 'USD'`)
  }
  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`ALTER TABLE sourcing_offers ALTER COLUMN currency SET DEFAULT 'CNY'`)
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT chk_users_business_ids, DROP CONSTRAINT chk_users_business_role, DROP COLUMN business_employee_id, DROP COLUMN business_department_id, DROP COLUMN business_role`)
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm'

/** 增加无凭据的已验证映射；保留原租户/用户唯一约束，历史绑定不自动转成已验证。 */
export class VerifiedFopEmployeeBindings1793233000000 implements MigrationInterface {
  name = 'VerifiedFopEmployeeBindings1793233000000'
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users ADD COLUMN fop_binding_details jsonb NULL')
    await queryRunner.query(`ALTER TABLE users ADD CONSTRAINT chk_users_verified_fop_binding CHECK (
      fop_binding_details IS NULL OR (
        fop_tenant_id IS NOT NULL AND fop_user_id IS NOT NULL
        AND jsonb_typeof(fop_binding_details) = 'object'
        AND fop_binding_details ?& ARRAY['username','name','employeeRecordId','employeeMasterId','departmentId','organizationId','localEmployeeId','localDepartmentId','verifiedAt']
        AND length(fop_binding_details->>'username') BETWEEN 1 AND 128
        AND (fop_binding_details->>'employeeRecordId') ~ '^[1-9][0-9]{0,18}$'
        AND (fop_binding_details->>'employeeMasterId') ~ '^[1-9][0-9]{0,18}$'
        AND (fop_binding_details->>'departmentId') ~ '^[1-9][0-9]{0,18}$'
        AND (fop_binding_details->>'organizationId') ~ '^[1-9][0-9]{0,18}$'
      ) IS TRUE)`)
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE users DROP CONSTRAINT chk_users_verified_fop_binding, DROP COLUMN fop_binding_details')
  }
}

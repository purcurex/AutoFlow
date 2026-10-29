import { MigrationInterface, QueryRunner } from 'typeorm'

/** Company rollout only: preserve independent record scopes, analytics and FOP grants. */
export class CompanyDirectoryAllWorkbenches1793200002000 implements MigrationInterface {
  name = 'CompanyDirectoryAllWorkbenches1793200002000'
  async up(runner: QueryRunner) {
    await runner.query(`UPDATE users u
      SET workbench_roles = ARRAY['sales','procurement','allocation','dispatch','warehouse']::text[],
          session_version = session_version + 1, updated_at = now()
      WHERE u.business_role IN ('salesperson','department_manager','admin')
        AND (EXISTS (SELECT 1 FROM organization_employees e
          WHERE e.account_id = u.id AND e.directory_profile->>'source' = 'company-directory')
          OR (u.email = 'admin@hzdrop.com' AND u.organization_workspace_owner_id IS NOT NULL))
        AND NOT (u.workbench_roles @> ARRAY['sales','procurement','allocation','dispatch','warehouse']::text[])`)
  }
  async down() {
    throw new Error('Restore prior workbench assignments explicitly; company grants cannot be inferred on rollback')
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm'

export class CompanyDirectoryAccess1793200000000 implements MigrationInterface {
  name = 'CompanyDirectoryAccess1793200000000'
  async up(runner: QueryRunner) {
    await runner.query('ALTER TABLE users DROP CONSTRAINT chk_users_chart_permissions')
    await runner.query('ALTER FUNCTION autoflow_valid_chart_permissions(jsonb) RENAME TO autoflow_valid_chart_permissions_v1')
    // Reuse the frozen validator, changing only the new record-scope enum.
    await runner.query(`CREATE FUNCTION autoflow_valid_chart_permissions(value jsonb)
      RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN autoflow_valid_chart_permissions_v1(
        COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(item) = 'object' AND item->>'dataScope' = 'none'
          THEN jsonb_set(item, '{dataScope}', '"self"'::jsonb) ELSE item END)
          FROM jsonb_array_elements(value) AS item), '[]'::jsonb)) ELSE false END
      $$`)
    await runner.query('ALTER TABLE users ADD CONSTRAINT chk_users_chart_permissions CHECK (autoflow_valid_chart_permissions(chart_permissions))')
    await runner.query(`ALTER TABLE organization_employees ADD COLUMN directory_profile jsonb,
      ADD CONSTRAINT chk_employee_directory_profile CHECK (directory_profile IS NULL OR jsonb_typeof(directory_profile) = 'object')`)
  }
  async down(runner: QueryRunner) {
    const [row] = await runner.query(`SELECT EXISTS(SELECT 1 FROM users, jsonb_array_elements(chart_permissions) item WHERE item->>'dataScope' = 'none')
      OR EXISTS(SELECT 1 FROM organization_employees WHERE directory_profile IS NOT NULL) AS populated`)
    if (row.populated) throw new Error('Cannot roll back saved directory profiles or summary-only restrictions')
    await runner.query('ALTER TABLE organization_employees DROP COLUMN directory_profile')
    await runner.query('ALTER TABLE users DROP CONSTRAINT chk_users_chart_permissions')
    await runner.query('DROP FUNCTION autoflow_valid_chart_permissions(jsonb)')
    await runner.query('ALTER FUNCTION autoflow_valid_chart_permissions_v1(jsonb) RENAME TO autoflow_valid_chart_permissions')
    await runner.query('ALTER TABLE users ADD CONSTRAINT chk_users_chart_permissions CHECK (autoflow_valid_chart_permissions(chart_permissions))')
  }
}

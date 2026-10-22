import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWorkbenchRoles1784728000000 implements MigrationInterface {
  name = 'AddWorkbenchRoles1784728000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "workbench_roles" text[] NOT NULL DEFAULT ARRAY['sales']::text[],
      ADD CONSTRAINT "chk_users_workbench_roles" CHECK (
        "workbench_roles" <@ ARRAY['sales', 'procurement', 'allocation', 'dispatch', 'warehouse']::text[]
        AND cardinality("workbench_roles") = (
          CASE WHEN 'sales' = ANY("workbench_roles") THEN 1 ELSE 0 END +
          CASE WHEN 'procurement' = ANY("workbench_roles") THEN 1 ELSE 0 END +
          CASE WHEN 'allocation' = ANY("workbench_roles") THEN 1 ELSE 0 END +
          CASE WHEN 'dispatch' = ANY("workbench_roles") THEN 1 ELSE 0 END +
          CASE WHEN 'warehouse' = ANY("workbench_roles") THEN 1 ELSE 0 END
        )
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "chk_users_workbench_roles", DROP COLUMN "workbench_roles"`)
  }
}

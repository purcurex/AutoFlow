import type { MigrationInterface, QueryRunner } from 'typeorm'
import { WORKBENCH_DOWN_SQL, WORKBENCH_UP_SQL } from '../workbench-schema.sql'

/** Immutable approved V1.2 schema. Runtime never reads the mutable design file. */
export class AddWorkbenchSchemeA1794393001000 implements MigrationInterface {
  name = 'AddWorkbenchSchemeA1794393001000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(WORKBENCH_UP_SQL)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(WORKBENCH_DOWN_SQL)
  }
}

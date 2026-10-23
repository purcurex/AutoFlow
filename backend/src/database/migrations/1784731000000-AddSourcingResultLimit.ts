import type { MigrationInterface, QueryRunner } from 'typeorm'

/** 为1688寻源增加按100条分批开放的结果窗口，不改变供应商返回总量的持久化语义。 */
export class AddSourcingResultLimit1784731000000 implements MigrationInterface {
  name = 'AddSourcingResultLimit1784731000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sourcing_searches"
        ADD COLUMN "result_limit" integer NOT NULL DEFAULT 100,
        ADD CONSTRAINT "chk_sourcing_searches_result_limit"
          CHECK ("result_limit" >= 100 AND "result_limit" % 100 = 0)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sourcing_searches"
        DROP CONSTRAINT IF EXISTS "chk_sourcing_searches_result_limit",
        DROP COLUMN IF EXISTS "result_limit"
    `)
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAuditEvents1784717000000 implements MigrationInterface {
  name = 'AddAuditEvents1784717000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_user_id" uuid,
        "action" varchar(120) NOT NULL,
        "target_type" varchar(120) NOT NULL,
        "target_id" varchar(200),
        "outcome" varchar(24) NOT NULL,
        "correlation_id" varchar(80) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_events" PRIMARY KEY ("id"),
        CONSTRAINT "fk_audit_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_audit_events_outcome" CHECK ("outcome" IN ('succeeded', 'failed'))
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_audit_events_actor_created_at" ON "audit_events" ("actor_user_id", "created_at")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_audit_events_correlation_id" ON "audit_events" ("correlation_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_audit_events_action_created_at" ON "audit_events" ("action", "created_at")')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "audit_events"')
  }
}

import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAiOutreachConversations1784723000000 implements MigrationInterface {
  name = 'AddAiOutreachConversations1784723000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_outreach_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL,
        "lead_id" uuid NOT NULL,
        "title" varchar(160) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'active',
        "options" jsonb NOT NULL,
        "context_snapshot" jsonb NOT NULL,
        "summary" text,
        "last_draft_version" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_outreach_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "chk_ai_outreach_conversations_status"
          CHECK ("status" IN ('active', 'drafted', 'accepted', 'archived')),
        CONSTRAINT "chk_ai_outreach_conversations_version" CHECK ("last_draft_version" >= 0),
        CONSTRAINT "fk_ai_outreach_conversations_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ai_outreach_conversations_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(`
      CREATE TABLE "ai_outreach_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "role" varchar(16) NOT NULL,
        "sequence" integer NOT NULL,
        "content" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ai_outreach_messages" PRIMARY KEY ("id"),
        CONSTRAINT "uq_ai_outreach_messages_conversation_sequence"
          UNIQUE ("conversation_id", "sequence"),
        CONSTRAINT "chk_ai_outreach_messages_role" CHECK ("role" IN ('user', 'assistant')),
        CONSTRAINT "chk_ai_outreach_messages_sequence" CHECK ("sequence" >= 1),
        CONSTRAINT "fk_ai_outreach_messages_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "ai_outreach_conversations"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(`
      CREATE TABLE "outreach_draft_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversation_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "lead_id" uuid NOT NULL,
        "outreach_task_id" uuid,
        "version" integer NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'draft',
        "english_subject" varchar(200) NOT NULL DEFAULT '',
        "english_message" text NOT NULL,
        "chinese_subject" varchar(200) NOT NULL DEFAULT '',
        "chinese_message" text NOT NULL,
        "facts_used" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "missing_facts" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_outreach_draft_versions" PRIMARY KEY ("id"),
        CONSTRAINT "uq_outreach_draft_versions_conversation_version"
          UNIQUE ("conversation_id", "version"),
        CONSTRAINT "chk_outreach_draft_versions_status"
          CHECK ("status" IN ('draft', 'accepted', 'superseded')),
        CONSTRAINT "chk_outreach_draft_versions_version" CHECK ("version" >= 1),
        CONSTRAINT "fk_outreach_draft_versions_conversation"
          FOREIGN KEY ("conversation_id") REFERENCES "ai_outreach_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_outreach_draft_versions_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_outreach_draft_versions_task"
          FOREIGN KEY ("outreach_task_id") REFERENCES "outreach_tasks"("id") ON DELETE SET NULL
      )
    `)
    await queryRunner.query(
      'CREATE INDEX "idx_ai_outreach_conversations_owner_updated" ON "ai_outreach_conversations" ("owner_user_id", "updated_at")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_ai_outreach_conversations_lead_updated" ON "ai_outreach_conversations" ("lead_id", "updated_at")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_ai_outreach_messages_conversation_created" ON "ai_outreach_messages" ("conversation_id", "created_at")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_outreach_draft_versions_owner_created" ON "outreach_draft_versions" ("owner_user_id", "created_at")',
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "outreach_draft_versions"')
    await queryRunner.query('DROP TABLE IF EXISTS "ai_outreach_messages"')
    await queryRunner.query('DROP TABLE IF EXISTS "ai_outreach_conversations"')
  }
}

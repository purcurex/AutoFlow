import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAiPromptTemplates1784721000000 implements MigrationInterface {
  name = 'AddAiPromptTemplates1784721000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_prompt_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid,
        "module_key" varchar(40) NOT NULL,
        "name" varchar(80) NOT NULL,
        "content" text NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "pk_ai_prompt_templates" PRIMARY KEY ("id"),
        CONSTRAINT "fk_ai_prompt_templates_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query('CREATE INDEX "idx_ai_prompt_templates_owner_module" ON "ai_prompt_templates" ("owner_user_id", "module_key")')
    await queryRunner.query('CREATE UNIQUE INDEX "uq_ai_prompt_templates_owner_module_name" ON "ai_prompt_templates" ("owner_user_id", "module_key", "name")')
    await queryRunner.query('CREATE UNIQUE INDEX "uq_ai_prompt_templates_system_module" ON "ai_prompt_templates" ("module_key") WHERE "is_system" = true')
    await queryRunner.query(`
      CREATE TABLE "ai_prompt_bindings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL,
        "module_key" varchar(40) NOT NULL,
        "template_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "pk_ai_prompt_bindings" PRIMARY KEY ("id"),
        CONSTRAINT "uq_ai_prompt_bindings_owner_module" UNIQUE ("owner_user_id", "module_key"),
        CONSTRAINT "fk_ai_prompt_bindings_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ai_prompt_bindings_template" FOREIGN KEY ("template_id") REFERENCES "ai_prompt_templates"("id") ON DELETE CASCADE
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "ai_prompt_bindings"')
    await queryRunner.query('DROP TABLE IF EXISTS "ai_prompt_templates"')
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm'

export class BaselineLegacySchema1784700000000 implements MigrationInterface {
  name = 'BaselineLegacySchema1784700000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."users_role_enum" AS ENUM ('admin', 'user');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."notes_editor_type_enum" AS ENUM ('markdown', 'richtext');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "username" character varying NOT NULL,
        "avatar_url" character varying,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "role" "public"."users_role_enum" NOT NULL DEFAULT 'user',
        CONSTRAINT "pk_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "uq_users_username" UNIQUE ("username")
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "folders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "parent_id" uuid,
        "name" character varying NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_folders" PRIMARY KEY ("id"),
        CONSTRAINT "fk_folders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION,
        CONSTRAINT "fk_folders_parent" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE NO ACTION
      )
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "folder_id" uuid,
        "title" character varying NOT NULL DEFAULT '无标题笔记',
        "content" text NOT NULL DEFAULT '',
        "content_html" text,
        "editor_type" "public"."notes_editor_type_enum" NOT NULL DEFAULT 'markdown',
        "tags" text NOT NULL DEFAULT '[]',
        "is_favorite" boolean NOT NULL DEFAULT false,
        "is_deleted" boolean NOT NULL DEFAULT false,
        "deleted_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "pk_notes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_notes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION,
        CONSTRAINT "fk_notes_folder" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE NO ACTION
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_folders_user_id" ON "folders" ("user_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_folders_parent_id" ON "folders" ("parent_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_notes_user_id" ON "notes" ("user_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_notes_folder_id" ON "notes" ("folder_id")')
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Baseline migration intentionally preserves the pre-existing legacy schema and data.
  }
}

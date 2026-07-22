import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAutoFlowCoreEntities1784700060000 implements MigrationInterface {
  name = 'AddAutoFlowCoreEntities1784700060000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const enumDefinitions: Array<[string, string]> = [
      ['autoflow_seed_type_enum', "'keyword', 'image'"],
      ['autoflow_workflow_status_enum', "'draft', 'running', 'completed', 'failed'"],
      [
        'autoflow_workflow_stage_enum',
        "'seed', 'ad_discovery', 'store_detection', 'lead_cleaning', 'lead_scoring', 'message_generation', 'outreach', 'crm'",
      ],
      ['autoflow_workflow_step_status_enum', "'pending', 'running', 'completed', 'failed', 'skipped'"],
      [
        'autoflow_lead_status_enum',
        "'new', 'qualified', 'contacted', 'replied', 'opportunity', 'won', 'lost', 'invalid'",
      ],
      [
        'autoflow_lead_contact_type_enum',
        "'whatsapp', 'email', 'instagram', 'facebook', 'website', 'phone'",
      ],
      ['autoflow_outreach_channel_enum', "'whatsapp', 'email', 'instagram', 'facebook'"],
      ['autoflow_outreach_status_enum', "'draft', 'ready', 'sent', 'replied', 'skipped'"],
      [
        'autoflow_crm_activity_type_enum',
        "'note', 'call', 'email', 'whatsapp', 'status_change', 'quote', 'follow_up', 'handoff'",
      ],
    ]

    for (const [name, values] of enumDefinitions) {
      await queryRunner.query(`
        DO $$ BEGIN
          CREATE TYPE "public"."${name}" AS ENUM (${values});
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
      `)
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "name" character varying(120) NOT NULL,
        "seed_type" "public"."autoflow_seed_type_enum" NOT NULL,
        "seed_value" character varying(500) NOT NULL,
        "target_market" character varying(80) NOT NULL DEFAULT 'United States',
        "status" "public"."autoflow_workflow_status_enum" NOT NULL DEFAULT 'draft',
        "current_stage" "public"."autoflow_workflow_stage_enum" NOT NULL DEFAULT 'seed',
        "progress" integer NOT NULL DEFAULT 0,
        "lead_count" integer NOT NULL DEFAULT 0,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_runs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_workflow_runs_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_workflow_runs_progress" CHECK ("progress" >= 0 AND "progress" <= 100)
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_workflow_runs_owner_created_at" ON "workflow_runs" ("owner_user_id", "created_at")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_workflow_runs_team_id" ON "workflow_runs" ("team_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_workflow_runs_status" ON "workflow_runs" ("status")')
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_workflow_runs_updated_at" ON "workflow_runs" ("updated_at")',
    )

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_steps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid NOT NULL,
        "stage" "public"."autoflow_workflow_stage_enum" NOT NULL,
        "status" "public"."autoflow_workflow_step_status_enum" NOT NULL DEFAULT 'pending',
        "sequence" integer NOT NULL,
        "input" jsonb,
        "output" jsonb,
        "error_message" text,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workflow_steps" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workflow_steps_run_stage" UNIQUE ("workflow_run_id", "stage"),
        CONSTRAINT "fk_workflow_steps_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_workflow_steps_run_sequence" ON "workflow_steps" ("workflow_run_id", "sequence")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_workflow_steps_status" ON "workflow_steps" ("status")')
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_workflow_steps_updated_at" ON "workflow_steps" ("updated_at")',
    )

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid,
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "brand_name" character varying(160) NOT NULL,
        "domain" character varying(255) NOT NULL,
        "store_url" character varying(500) NOT NULL,
        "source" character varying(120) NOT NULL,
        "country" character varying(80) NOT NULL DEFAULT '',
        "language" character varying(40) NOT NULL DEFAULT 'English',
        "category" character varying(120) NOT NULL DEFAULT '',
        "shopify_confidence" double precision NOT NULL DEFAULT 0,
        "ad_activity_score" double precision NOT NULL DEFAULT 0,
        "traffic_score" double precision NOT NULL DEFAULT 0,
        "contact_score" double precision NOT NULL DEFAULT 0,
        "total_score" double precision NOT NULL DEFAULT 0,
        "status" "public"."autoflow_lead_status_enum" NOT NULL DEFAULT 'new',
        "recommended_angle" text NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_leads" PRIMARY KEY ("id"),
        CONSTRAINT "fk_leads_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_leads_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_leads_scores" CHECK (
          "shopify_confidence" BETWEEN 0 AND 100 AND
          "ad_activity_score" BETWEEN 0 AND 100 AND
          "traffic_score" BETWEEN 0 AND 100 AND
          "contact_score" BETWEEN 0 AND 100 AND
          "total_score" BETWEEN 0 AND 100
        )
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_leads_owner_status" ON "leads" ("owner_user_id", "status")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_leads_team_id" ON "leads" ("team_id")')
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_leads_workflow_run_id" ON "leads" ("workflow_run_id")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_leads_domain" ON "leads" ("domain")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_leads_created_at" ON "leads" ("created_at")')

    await queryRunner.query('ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "workflow_run_id" uuid')
    await queryRunner.query('ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "lead_id" uuid')
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "notes" ADD CONSTRAINT "fk_notes_workflow_run"
          FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "notes" ADD CONSTRAINT "fk_notes_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_notes_workflow_run_id" ON "notes" ("workflow_run_id")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_notes_lead_id" ON "notes" ("lead_id")')

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lead_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "lead_id" uuid NOT NULL,
        "type" "public"."autoflow_lead_contact_type_enum" NOT NULL,
        "value" character varying(500) NOT NULL,
        "label" character varying(80),
        "verified" boolean NOT NULL DEFAULT false,
        "is_primary" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_contacts" PRIMARY KEY ("id"),
        CONSTRAINT "uq_lead_contacts_lead_type_value" UNIQUE ("lead_id", "type", "value"),
        CONSTRAINT "fk_lead_contacts_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_lead_contacts_lead_id" ON "lead_contacts" ("lead_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_lead_contacts_verified" ON "lead_contacts" ("verified")')

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outreach_tasks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "lead_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "channel" "public"."autoflow_outreach_channel_enum" NOT NULL,
        "status" "public"."autoflow_outreach_status_enum" NOT NULL DEFAULT 'draft',
        "message" text NOT NULL,
        "next_follow_up_at" timestamptz,
        "sent_at" timestamptz,
        "replied_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_outreach_tasks" PRIMARY KEY ("id"),
        CONSTRAINT "fk_outreach_tasks_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_outreach_tasks_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `)
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_outreach_tasks_lead_id" ON "outreach_tasks" ("lead_id")')
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_outreach_tasks_owner_status" ON "outreach_tasks" ("owner_user_id", "status")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_outreach_tasks_team_id" ON "outreach_tasks" ("team_id")')
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_outreach_tasks_next_follow_up_at" ON "outreach_tasks" ("next_follow_up_at")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_outreach_tasks_created_at" ON "outreach_tasks" ("created_at")',
    )

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_activities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "lead_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "type" "public"."autoflow_crm_activity_type_enum" NOT NULL,
        "subject" character varying(160),
        "content" text NOT NULL DEFAULT '',
        "from_status" "public"."autoflow_lead_status_enum",
        "to_status" "public"."autoflow_lead_status_enum",
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "next_follow_up_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crm_activities" PRIMARY KEY ("id"),
        CONSTRAINT "fk_crm_activities_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_crm_activities_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_crm_activities_lead_occurred_at" ON "crm_activities" ("lead_id", "occurred_at")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_crm_activities_owner_id" ON "crm_activities" ("owner_user_id")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_crm_activities_team_id" ON "crm_activities" ("team_id")')
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_crm_activities_type" ON "crm_activities" ("type")')
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_crm_activities_next_follow_up_at" ON "crm_activities" ("next_follow_up_at")',
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "fk_notes_lead"')
    await queryRunner.query('ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "fk_notes_workflow_run"')
    await queryRunner.query('DROP INDEX IF EXISTS "idx_notes_lead_id"')
    await queryRunner.query('DROP INDEX IF EXISTS "idx_notes_workflow_run_id"')
    await queryRunner.query('ALTER TABLE "notes" DROP COLUMN IF EXISTS "lead_id"')
    await queryRunner.query('ALTER TABLE "notes" DROP COLUMN IF EXISTS "workflow_run_id"')
    await queryRunner.query('DROP TABLE IF EXISTS "crm_activities"')
    await queryRunner.query('DROP TABLE IF EXISTS "outreach_tasks"')
    await queryRunner.query('DROP TABLE IF EXISTS "lead_contacts"')
    await queryRunner.query('DROP TABLE IF EXISTS "leads"')
    await queryRunner.query('DROP TABLE IF EXISTS "workflow_steps"')
    await queryRunner.query('DROP TABLE IF EXISTS "workflow_runs"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_crm_activity_type_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_outreach_status_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_outreach_channel_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_lead_contact_type_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_lead_status_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_workflow_step_status_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_workflow_stage_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_workflow_status_enum"')
    await queryRunner.query('DROP TYPE IF EXISTS "public"."autoflow_seed_type_enum"')
  }
}

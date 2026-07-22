import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddDiscoveryEvidence1784710000000 implements MigrationInterface {
  name = 'AddDiscoveryEvidence1784710000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ad_creatives" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "provider" character varying(40) NOT NULL,
        "deduplication_key" character varying(64) NOT NULL,
        "advertiser_name" character varying(160) NOT NULL,
        "source_url" character varying(1000) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "image_url" character varying(1000),
        "confidence" double precision NOT NULL DEFAULT 0,
        "raw_payload" jsonb,
        "discovered_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_ad_creatives" PRIMARY KEY ("id"),
        CONSTRAINT "uq_ad_creatives_run_provider_key" UNIQUE ("workflow_run_id", "provider", "deduplication_key"),
        CONSTRAINT "fk_ad_creatives_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ad_creatives_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_ad_creatives_confidence" CHECK ("confidence" >= 0 AND "confidence" <= 100)
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_ad_creatives_owner_discovered_at" ON "ad_creatives" ("owner_user_id", "discovered_at")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_ad_creatives_workflow_run_id" ON "ad_creatives" ("workflow_run_id")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_ad_creatives_team_id" ON "ad_creatives" ("team_id")')

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shopify_stores" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "lead_id" uuid,
        "name" character varying(160) NOT NULL,
        "domain" character varying(255) NOT NULL,
        "normalized_domain" character varying(255) NOT NULL,
        "url" character varying(1000) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "image_url" character varying(1000),
        "detection_source" character varying(80) NOT NULL,
        "shopify_confidence" double precision NOT NULL DEFAULT 0,
        "traffic" jsonb,
        "raw_payload" jsonb,
        "discovered_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_shopify_stores" PRIMARY KEY ("id"),
        CONSTRAINT "uq_shopify_stores_run_domain" UNIQUE ("workflow_run_id", "normalized_domain"),
        CONSTRAINT "fk_shopify_stores_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_shopify_stores_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_shopify_stores_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL,
        CONSTRAINT "chk_shopify_stores_confidence" CHECK ("shopify_confidence" >= 0 AND "shopify_confidence" <= 100)
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_shopify_stores_owner_domain" ON "shopify_stores" ("owner_user_id", "normalized_domain")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_shopify_stores_workflow_run_id" ON "shopify_stores" ("workflow_run_id")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_shopify_stores_lead_id" ON "shopify_stores" ("lead_id")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_shopify_stores_team_id" ON "shopify_stores" ("team_id")')

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lead_scores" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "lead_id" uuid NOT NULL,
        "workflow_run_id" uuid,
        "owner_user_id" uuid NOT NULL,
        "team_id" uuid,
        "shopify_confidence" double precision NOT NULL DEFAULT 0,
        "ad_activity_score" double precision NOT NULL DEFAULT 0,
        "traffic_score" double precision NOT NULL DEFAULT 0,
        "contact_score" double precision NOT NULL DEFAULT 0,
        "category_fit_score" double precision NOT NULL DEFAULT 0,
        "dropshipping_fit_score" double precision NOT NULL DEFAULT 0,
        "risk_score" double precision NOT NULL DEFAULT 0,
        "total_score" double precision NOT NULL DEFAULT 0,
        "grade" character varying(16) NOT NULL DEFAULT 'unrated',
        "model_version" character varying(40) NOT NULL DEFAULT 'rules-v1',
        "reasons" jsonb,
        "calculated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_lead_scores" PRIMARY KEY ("id"),
        CONSTRAINT "fk_lead_scores_lead" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_lead_scores_workflow_run" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_lead_scores_owner" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_lead_scores_dimensions" CHECK (
          "shopify_confidence" BETWEEN 0 AND 100 AND
          "ad_activity_score" BETWEEN 0 AND 100 AND
          "traffic_score" BETWEEN 0 AND 100 AND
          "contact_score" BETWEEN 0 AND 100 AND
          "category_fit_score" BETWEEN 0 AND 100 AND
          "dropshipping_fit_score" BETWEEN 0 AND 100 AND
          "risk_score" BETWEEN 0 AND 100 AND
          "total_score" BETWEEN 0 AND 100
        )
      )
    `)
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_lead_scores_lead_calculated_at" ON "lead_scores" ("lead_id", "calculated_at")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_lead_scores_owner_total_score" ON "lead_scores" ("owner_user_id", "total_score")',
    )
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "idx_lead_scores_workflow_run_id" ON "lead_scores" ("workflow_run_id")',
    )
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "idx_lead_scores_team_id" ON "lead_scores" ("team_id")')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "lead_scores"')
    await queryRunner.query('DROP TABLE IF EXISTS "shopify_stores"')
    await queryRunner.query('DROP TABLE IF EXISTS "ad_creatives"')
  }
}

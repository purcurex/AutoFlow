import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAlibaba1688Sourcing1784724000000 implements MigrationInterface {
  name = 'AddAlibaba1688Sourcing1784724000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sourcing_searches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL DEFAULT 'alibaba_1688',
        "search_mode" varchar(16) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "request_id" varchar(128) NOT NULL,
        "provider_request_id" varchar(128),
        "provider_method" varchar(160) NOT NULL,
        "keyword" text,
        "image_url" varchar(1000),
        "request_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "error_code" varchar(80),
        "error_message" text,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_sourcing_searches" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sourcing_searches_owner_request"
          UNIQUE ("owner_user_id", "request_id"),
        CONSTRAINT "chk_sourcing_searches_provider"
          CHECK ("provider" = 'alibaba_1688'),
        CONSTRAINT "chk_sourcing_searches_mode"
          CHECK ("search_mode" IN ('keyword', 'image')),
        CONSTRAINT "chk_sourcing_searches_status"
          CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
        CONSTRAINT "fk_sourcing_searches_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_sourcing_searches_workflow"
          FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
      )
    `)

    await queryRunner.query(`
      CREATE TABLE "sourcing_suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "search_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL DEFAULT 'alibaba_1688',
        "supplier_key" varchar(255) NOT NULL,
        "member_id" varchar(128),
        "open_id" varchar(128),
        "company_name" varchar(255),
        "shop_name" varchar(255),
        "shop_url" varchar(1000),
        "supplier_rating" double precision,
        "years_in_business" integer,
        "capabilities" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_sourcing_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sourcing_suppliers_search_provider_key"
          UNIQUE ("search_id", "provider", "supplier_key"),
        CONSTRAINT "chk_sourcing_suppliers_provider"
          CHECK ("provider" = 'alibaba_1688'),
        CONSTRAINT "chk_sourcing_suppliers_rating"
          CHECK ("supplier_rating" IS NULL OR ("supplier_rating" >= 0 AND "supplier_rating" <= 100)),
        CONSTRAINT "chk_sourcing_suppliers_years"
          CHECK ("years_in_business" IS NULL OR "years_in_business" >= 0),
        CONSTRAINT "fk_sourcing_suppliers_search"
          FOREIGN KEY ("search_id") REFERENCES "sourcing_searches"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_sourcing_suppliers_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_sourcing_suppliers_workflow"
          FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
      )
    `)

    await queryRunner.query(`
      CREATE TABLE "sourcing_offers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "search_id" uuid NOT NULL,
        "supplier_id" uuid,
        "owner_user_id" uuid NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL DEFAULT 'alibaba_1688',
        "offer_id" varchar(128) NOT NULL,
        "offer_url" varchar(1000) NOT NULL,
        "image_url" varchar(1000),
        "title" varchar(500) NOT NULL,
        "title_zh" varchar(500),
        "title_en" varchar(500),
        "category_id" varchar(128),
        "category_name" varchar(255),
        "minimum_order_quantity" numeric(18,4),
        "quantity_unit" varchar(32),
        "price_min" numeric(18,4),
        "price_max" numeric(18,4),
        "currency" varchar(8) NOT NULL DEFAULT 'CNY',
        "price_tiers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "sales_volume" bigint,
        "repurchase_rate" double precision,
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "sourcing_score" double precision NOT NULL DEFAULT 0,
        "sourcing_score_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "raw_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "retrieved_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_sourcing_offers" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sourcing_offers_search_provider_offer"
          UNIQUE ("search_id", "provider", "offer_id"),
        CONSTRAINT "chk_sourcing_offers_provider"
          CHECK ("provider" = 'alibaba_1688'),
        CONSTRAINT "chk_sourcing_offers_score"
          CHECK ("sourcing_score" >= 0 AND "sourcing_score" <= 100),
        CONSTRAINT "chk_sourcing_offers_repurchase_rate"
          CHECK ("repurchase_rate" IS NULL OR ("repurchase_rate" >= 0 AND "repurchase_rate" <= 100)),
        CONSTRAINT "chk_sourcing_offers_moq"
          CHECK ("minimum_order_quantity" IS NULL OR "minimum_order_quantity" >= 0),
        CONSTRAINT "chk_sourcing_offers_prices"
          CHECK (
            ("price_min" IS NULL OR "price_min" >= 0)
            AND ("price_max" IS NULL OR "price_max" >= 0)
            AND ("price_min" IS NULL OR "price_max" IS NULL OR "price_max" >= "price_min")
          ),
        CONSTRAINT "fk_sourcing_offers_search"
          FOREIGN KEY ("search_id") REFERENCES "sourcing_searches"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_sourcing_offers_supplier"
          FOREIGN KEY ("supplier_id") REFERENCES "sourcing_suppliers"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_sourcing_offers_owner"
          FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_sourcing_offers_workflow"
          FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE
      )
    `)

    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_searches_owner_created" ON "sourcing_searches" ("owner_user_id", "created_at")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_searches_workflow_status" ON "sourcing_searches" ("workflow_run_id", "status")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_searches_provider_request" ON "sourcing_searches" ("provider", "provider_request_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_suppliers_owner_rating" ON "sourcing_suppliers" ("owner_user_id", "supplier_rating")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_suppliers_workflow" ON "sourcing_suppliers" ("workflow_run_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_suppliers_search" ON "sourcing_suppliers" ("search_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_suppliers_member" ON "sourcing_suppliers" ("provider", "member_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_suppliers_open_id" ON "sourcing_suppliers" ("provider", "open_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_offers_owner_score" ON "sourcing_offers" ("owner_user_id", "sourcing_score")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_offers_workflow" ON "sourcing_offers" ("workflow_run_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_offers_search" ON "sourcing_offers" ("search_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_offers_supplier" ON "sourcing_offers" ("supplier_id")',
    )
    await queryRunner.query(
      'CREATE INDEX "idx_sourcing_offers_provider_offer" ON "sourcing_offers" ("provider", "offer_id")',
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "sourcing_offers"')
    await queryRunner.query('DROP TABLE IF EXISTS "sourcing_suppliers"')
    await queryRunner.query('DROP TABLE IF EXISTS "sourcing_searches"')
  }
}

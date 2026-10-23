import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAlibaba1688SourcingPagination1784728000000 implements MigrationInterface {
  name = 'AddAlibaba1688SourcingPagination1784728000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        ADD COLUMN "seed_asset_path" varchar(1000),
        ADD COLUMN "seed_asset_mime_type" varchar(64),
        ADD COLUMN "seed_asset_size" bigint,
        ADD COLUMN "seed_asset_sha256" varchar(64)
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_searches"
        ADD COLUMN "language_code" varchar(32) NOT NULL DEFAULT 'en',
        ADD COLUMN "image_id" varchar(255),
        ADD COLUMN "image_upload_request_id" varchar(128),
        ADD COLUMN "image_upload_trace_id" varchar(128),
        ADD COLUMN "total_records" bigint,
        ADD COLUMN "total_pages" integer,
        ADD COLUMN "page_size" integer NOT NULL DEFAULT 20,
        ADD COLUMN "loaded_page_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "query_fingerprint" varchar(128)
    `)
    await queryRunner.query(`
      UPDATE "sourcing_searches"
      SET "query_fingerprint" = "id"::text
      WHERE "query_fingerprint" IS NULL
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_searches"
        ALTER COLUMN "query_fingerprint" SET NOT NULL,
        DROP CONSTRAINT "chk_sourcing_searches_status",
        ADD CONSTRAINT "chk_sourcing_searches_status"
          CHECK ("status" IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
        ADD CONSTRAINT "chk_sourcing_searches_page_size"
          CHECK ("page_size" IN (10, 20, 50)),
        ADD CONSTRAINT "chk_sourcing_searches_loaded_page_count"
          CHECK ("loaded_page_count" >= 0)
    `)
    await queryRunner.query(`
      CREATE INDEX "idx_sourcing_searches_owner_workflow_fingerprint"
      ON "sourcing_searches" (
        "owner_user_id", "workflow_run_id", "query_fingerprint", "created_at" DESC
      )
    `)
    await queryRunner.query(`
      CREATE TABLE "sourcing_search_pages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "search_id" uuid NOT NULL,
        "owner_user_id" uuid NOT NULL,
        "page_number" integer NOT NULL,
        "page_size" integer NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "lease_owner" varchar(255),
        "lease_expires_at" timestamptz,
        "heartbeat_at" timestamptz,
        "provider_request_id" varchar(128),
        "provider_trace_id" varchar(128),
        "result_count" integer NOT NULL DEFAULT 0,
        "error_code" varchar(80),
        "error_message" text,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_sourcing_search_pages" PRIMARY KEY ("id"),
        CONSTRAINT "uq_sourcing_search_pages_search_page" UNIQUE ("search_id", "page_number"),
        CONSTRAINT "chk_sourcing_search_pages_status"
          CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed')),
        CONSTRAINT "chk_sourcing_search_pages_page_number" CHECK ("page_number" >= 1),
        CONSTRAINT "chk_sourcing_search_pages_page_size" CHECK ("page_size" IN (10, 20, 50)),
        CONSTRAINT "chk_sourcing_search_pages_attempts"
          CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts" AND "max_attempts" >= 1),
        CONSTRAINT "fk_sourcing_search_pages_search" FOREIGN KEY ("search_id")
          REFERENCES "sourcing_searches"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_sourcing_search_pages_owner" FOREIGN KEY ("owner_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `)
    await queryRunner.query(`
      CREATE INDEX "idx_sourcing_search_pages_status_available"
        ON "sourcing_search_pages" ("status", "available_at");
      CREATE INDEX "idx_sourcing_search_pages_search_page"
        ON "sourcing_search_pages" ("search_id", "page_number");
      CREATE INDEX "idx_sourcing_search_pages_owner_search"
        ON "sourcing_search_pages" ("owner_user_id", "search_id");
      CREATE INDEX "idx_sourcing_search_pages_lease_expires"
        ON "sourcing_search_pages" ("lease_expires_at")
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_offers"
        ADD COLUMN "page_number" integer NOT NULL DEFAULT 1,
        ADD COLUMN "rank_in_page" integer NOT NULL DEFAULT 1,
        ADD COLUMN "absolute_rank" integer NOT NULL DEFAULT 1,
        ADD COLUMN "detail_status" varchar(24) NOT NULL DEFAULT 'not_requested',
        ADD COLUMN "detail_retrieved_at" timestamptz,
        ADD COLUMN "score_version" varchar(32) NOT NULL DEFAULT 'v1',
        ADD COLUMN "score_dimensions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD CONSTRAINT "chk_sourcing_offers_page_number" CHECK ("page_number" >= 1),
        ADD CONSTRAINT "chk_sourcing_offers_rank_in_page" CHECK ("rank_in_page" >= 1),
        ADD CONSTRAINT "chk_sourcing_offers_absolute_rank" CHECK ("absolute_rank" >= 1),
        ADD CONSTRAINT "chk_sourcing_offers_detail_status"
          CHECK ("detail_status" IN ('not_requested', 'succeeded', 'failed'))
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_offers"
        ALTER COLUMN "repurchase_rate" TYPE numeric(9,4)
          USING ROUND("repurchase_rate"::numeric, 4);
      ALTER TABLE "sourcing_suppliers"
        ALTER COLUMN "supplier_rating" TYPE numeric(9,4)
          USING ROUND("supplier_rating"::numeric, 4)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sourcing_offers"
        ALTER COLUMN "repurchase_rate" TYPE double precision
          USING "repurchase_rate"::double precision;
      ALTER TABLE "sourcing_suppliers"
        ALTER COLUMN "supplier_rating" TYPE double precision
          USING "supplier_rating"::double precision
    `)
    await queryRunner.query(`
      ALTER TABLE "sourcing_offers"
        DROP CONSTRAINT "chk_sourcing_offers_detail_status",
        DROP CONSTRAINT "chk_sourcing_offers_absolute_rank",
        DROP CONSTRAINT "chk_sourcing_offers_rank_in_page",
        DROP CONSTRAINT "chk_sourcing_offers_page_number",
        DROP COLUMN "score_dimensions",
        DROP COLUMN "score_version",
        DROP COLUMN "detail_retrieved_at",
        DROP COLUMN "detail_status",
        DROP COLUMN "absolute_rank",
        DROP COLUMN "rank_in_page",
        DROP COLUMN "page_number"
    `)
    await queryRunner.query('DROP TABLE IF EXISTS "sourcing_search_pages"')
    await queryRunner.query(`
      UPDATE "sourcing_searches"
      SET "status" = CASE
        WHEN "loaded_page_count" > 0 THEN 'succeeded'
        ELSE 'failed'
      END
      WHERE "status" = 'partial'
    `)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_sourcing_searches_owner_workflow_fingerprint";
      ALTER TABLE "sourcing_searches"
        DROP CONSTRAINT "chk_sourcing_searches_loaded_page_count",
        DROP CONSTRAINT "chk_sourcing_searches_page_size",
        DROP CONSTRAINT "chk_sourcing_searches_status",
        ADD CONSTRAINT "chk_sourcing_searches_status"
          CHECK ("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
        DROP COLUMN "query_fingerprint",
        DROP COLUMN "loaded_page_count",
        DROP COLUMN "page_size",
        DROP COLUMN "total_pages",
        DROP COLUMN "total_records",
        DROP COLUMN "image_upload_trace_id",
        DROP COLUMN "image_upload_request_id",
        DROP COLUMN "image_id",
        DROP COLUMN "language_code"
    `)
    await queryRunner.query(`
      ALTER TABLE "workflow_runs"
        DROP COLUMN "seed_asset_sha256",
        DROP COLUMN "seed_asset_size",
        DROP COLUMN "seed_asset_mime_type",
        DROP COLUMN "seed_asset_path"
    `)
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddChartPermissions1784733000000 implements MigrationInterface {
  name = 'AddChartPermissions1784733000000'

  async up(queryRunner: QueryRunner) {
    // The database also rejects malformed direct writes. Keep this frozen schema
    // aligned with the API validator through a new migration when adding charts.
    await queryRunner.query(`CREATE FUNCTION autoflow_valid_chart_permissions(value jsonb)
      RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
      DECLARE item jsonb; department jsonb; seen text[] := ARRAY[]::text[]; departments text[]; chart text; mode text;
      BEGIN
        IF jsonb_typeof(value) <> 'array' THEN RETURN false; END IF;
        IF jsonb_array_length(value) > 7 THEN RETURN false; END IF;
        FOR item IN SELECT jsonb_array_elements(value) LOOP
          IF jsonb_typeof(item) <> 'object' THEN RETURN false; END IF;
          IF (SELECT count(*) FROM jsonb_object_keys(item)) <> 7
            OR NOT item ?& ARRAY['chartId','visibility','dataScope','summaryMode','summaryDepartments','details','export'] THEN RETURN false; END IF;
          chart := item->>'chartId'; mode := item->>'summaryMode';
          IF chart IS NULL OR chart NOT IN ('registrations','department_receipts','salesperson_receipts','order_volume','customer_orders','freight','sales_performance')
            OR chart = ANY(seen) THEN RETURN false; END IF;
          seen := array_append(seen, chart);
          IF item->>'visibility' IS NULL OR item->>'visibility' NOT IN ('inherit','allow','deny')
            OR item->>'dataScope' IS NULL OR item->>'dataScope' NOT IN ('inherit','self','department')
            OR item->>'details' IS NULL OR item->>'details' NOT IN ('inherit','allow','deny')
            OR item->>'export' IS NULL OR item->>'export' NOT IN ('inherit','allow','deny')
            OR mode IS NULL OR mode NOT IN ('inherit','none','selected','marketing') THEN RETURN false; END IF;
          IF jsonb_typeof(item->'summaryDepartments') <> 'array' THEN RETURN false; END IF;
          departments := ARRAY[]::text[];
          FOR department IN SELECT jsonb_array_elements(item->'summaryDepartments') LOOP
            IF jsonb_typeof(department) <> 'string' OR department #>> '{}' NOT IN ('sales1','sales2','sales3','sales4')
              OR department #>> '{}' = ANY(departments) THEN RETURN false; END IF;
            departments := array_append(departments, department #>> '{}');
          END LOOP;
          IF mode IN ('selected','marketing') AND chart NOT IN ('registrations','department_receipts','order_volume') THEN RETURN false; END IF;
          IF (mode = 'selected' AND cardinality(departments) = 0)
            OR (mode <> 'selected' AND cardinality(departments) <> 0) THEN RETURN false; END IF;
        END LOOP;
        RETURN true;
      END $$`)
    await queryRunner.query(`ALTER TABLE users ADD COLUMN chart_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD CONSTRAINT chk_users_chart_permissions CHECK (autoflow_valid_chart_permissions(chart_permissions))`)
  }

  async down(queryRunner: QueryRunner) {
    const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM users WHERE chart_permissions <> '[]'::jsonb`)
    if (count > 0) throw new Error('Remove chart permission overrides explicitly before rollback; dropping saved restrictions could expand access')
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT chk_users_chart_permissions, DROP COLUMN chart_permissions`)
    await queryRunner.query('DROP FUNCTION autoflow_valid_chart_permissions(jsonb)')
  }
}

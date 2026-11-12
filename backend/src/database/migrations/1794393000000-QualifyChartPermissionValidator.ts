import type { MigrationInterface, QueryRunner } from 'typeorm'

/** Preserve the chart validator; qualify its v1 dependency for pg_restore. */
export class QualifyChartPermissionValidator1794393000000 implements MigrationInterface {
  name = 'QualifyChartPermissionValidator1794393000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.autoflow_valid_chart_permissions(value jsonb)
      RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $function$
        SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN public.autoflow_valid_chart_permissions_v1(
          COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(item) = 'object' AND item->>'dataScope' = 'none'
            THEN jsonb_set(item, '{dataScope}', '"self"'::jsonb) ELSE item END)
            FROM jsonb_array_elements(value) AS item), '[]'::jsonb)) ELSE false END
      $function$;
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.autoflow_valid_chart_permissions(value jsonb)
      RETURNS boolean LANGUAGE sql IMMUTABLE STRICT AS $function$
        SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN autoflow_valid_chart_permissions_v1(
          COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(item) = 'object' AND item->>'dataScope' = 'none'
            THEN jsonb_set(item, '{dataScope}', '"self"'::jsonb) ELSE item END)
            FROM jsonb_array_elements(value) AS item), '[]'::jsonb)) ELSE false END
      $function$;
    `)
  }
}

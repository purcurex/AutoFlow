-- 建表前置修复；仅在独立验证库验证，尚未应用到原业务库。
-- 正式执行应纳入新增的 TypeORM 版本化迁移，保留原校验逻辑。
-- 修复内部函数未限定 schema 导致 pg_restore 空 search_path 失败。
CREATE OR REPLACE FUNCTION public.autoflow_valid_chart_permissions(value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE STRICT
AS $function$
      SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN public.autoflow_valid_chart_permissions_v1(
        COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(item) = 'object' AND item->>'dataScope' = 'none'
          THEN jsonb_set(item, '{dataScope}', '"self"'::jsonb) ELSE item END)
          FROM jsonb_array_elements(value) AS item), '[]'::jsonb)) ELSE false END
      $function$

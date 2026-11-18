import type { DashboardAnalyticsOptions } from './dashboard-analytics-query'

/** UserField IDs resolve through current verified account bindings; names never authorize. */
export function customerRegistrationQuery(o: DashboardAnalyticsOptions) {
  const dimensions = ["('department',coalesce(department_id,'unknown'),coalesce(department_name,'未关联业务部门'))"]
  dimensions.push("('day',to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'),to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'))", "('month',to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM'),to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM'))")
  if (!o.summaryOnly) dimensions.push("('person',coalesce(employee_id,'unknown'),coalesce(owner_name,'未绑定业务员'))")
  if(o.trend){const format=o.trend.grain==='day'?'YYYY-MM-DD':'YYYY-MM';dimensions.splice(0,dimensions.length,`('${o.trend.grain}',to_char(created_at AT TIME ZONE 'Asia/Shanghai','${format}'),to_char(created_at AT TIME ZONE 'Asia/Shanghai','${format}'))`)}
  const sql = `WITH member_input AS (
    SELECT * FROM jsonb_to_recordset($6::jsonb) AS m("employeeId" text,"fopUserId" text,"departmentId" text,"name" text,"englishName" text,"departmentName" text)
  ), members AS (
    SELECT * FROM member_input m WHERE NULLIF("fopUserId",'') IS NOT NULL
    AND (SELECT count(*) FROM member_input x WHERE x."fopUserId"=m."fopUserId")=1
  ), ${o.trend?'unfocused':'source'} AS (
    SELECT f.source_id,f.created_at,m."employeeId" employee_id,m."departmentId" department_id,m."name" owner_name,m."departmentName" department_name,NULLIF(trim(m."englishName"),'') owner_english_name
    FROM hz_fop_collected_customer_registrations f LEFT JOIN members m ON m."fopUserId"=f.source_owner_user_id
    WHERE f.batch_id=$1 AND f.company_id=$2 AND f.source_entity='hzkj_member_customer'
    AND ($3::text[] IS NULL OR m."employeeId"=ANY($3::text[]))
  )${o.trend?`, source AS (SELECT * FROM unfocused WHERE ${o.trend.dimension==='department'?'department_id':'employee_id'}=$7)`:''}, filtered AS (
    SELECT * FROM source WHERE created_at >= $4::timestamptz AND created_at < $5::timestamptz
  ), grouped AS (
    SELECT d.dimension,d.id,d.label,count(*)::int "registrationCount",count(*)::int "orderCount",
      ${!o.summaryOnly ? `CASE WHEN d.dimension='person' THEN max(department_id) END "departmentId",CASE WHEN d.dimension='person' THEN max(department_name) END "departmentName",CASE WHEN d.dimension='person' THEN max(owner_english_name) END "englishName",` : ''}
      NULL::text currency,NULL::text amount,NULL::text quantity
    FROM filtered CROSS JOIN LATERAL (VALUES ${dimensions.join(',')}) d(dimension,id,label)
    GROUP BY d.dimension,d.id,d.label
  ) SELECT jsonb_build_object(
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY dimension,id) FROM grouped g),'[]'::jsonb),
    'registrationCount',(SELECT count(*)::int FROM filtered),'orderCount',(SELECT count(*)::int FROM filtered),
    'missingCreatedAtCount',(SELECT count(*)::int FROM source WHERE created_at IS NULL),
    'unmatchedOwnerCount',(SELECT count(*)::int FROM filtered WHERE employee_id IS NULL),
    'missingPaidAtCount',0,'missingAmountCount',0,'missingCurrencyCount',0,
    'currencies','[]'::jsonb,'warehouses','[]'::jsonb,'amountsByCurrency','[]'::jsonb
  ) analytics`
  return { sql, params: [o.batchId,o.companyId,o.employeeIds,o.start,o.end,JSON.stringify(o.members),...o.trend?[o.trend.id]:[]] }
}

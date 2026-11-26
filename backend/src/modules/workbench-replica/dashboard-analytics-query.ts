import type { DashboardTrendFocus } from './collected-analytics.dto'
import { warehouseCodes } from './warehouse-codes'
import { customerRegistrationQuery } from './customer-registration-query'
export interface DashboardAnalyticsOptions {
 batchId:string;companyId:string;employeeIds:readonly string[]|null;members:unknown[];start:string;end:string
 chartId:string;summaryOnly:boolean;warehouseCode?:string;currency?:string;entityType?:string
 trend?:DashboardTrendFocus
 customerOwnershipScope?:boolean;recordEmployeeIds?:readonly string[]
}
/** Read only the local source-document projection. Never join lines into monetary aggregates. */
export function dashboardAnalyticsQuery(o:DashboardAnalyticsOptions){
 if(o.chartId==='registrations')return customerRegistrationQuery(o)
 const money=['department_receipts','salesperson_receipts'].includes(o.chartId)
 const customerOwners=o.chartId==='customer_orders'&&(!o.summaryOnly||!!o.customerOwnershipScope)
 const orderOwners=['salesperson_receipts','order_volume'].includes(o.chartId)
 const salespersonGroups=(orderOwners||customerOwners)&&!o.summaryOnly
 const personDepartment=customerOwners?'customer_owner_department_id':'department_id'
 const personDepartmentName=customerOwners?'customer_owner_department_name':'department_name'
 const personEnglishName=customerOwners?'customer_owner_english_name':'owner_english_name'
 const dimensions = ["('month',to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM'),to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM'))", o.customerOwnershipScope&&customerOwners?"('department',customer_owner_department_id,customer_owner_department_name)":"('department',coalesce(department_id,'unknown'),coalesce(department_name,'未关联业务部门'))"]
 if(!o.summaryOnly){
  dimensions.push("('day',to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'),to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD'))")
  if(orderOwners)dimensions.push("('person',CASE WHEN owner_name IS NULL THEN 'unknown' ELSE coalesce(owner_employee_id,'unknown') END,coalesce(owner_name,'未绑定业务员'))")
  if(o.chartId==='customer_orders')dimensions.push("('customer',coalesce(customer_id,'unknown'),coalesce(customer_name,'未知客户'))","('person',coalesce(customer_owner_id,'unknown'),coalesce(customer_owner_name,'未绑定业务员'))","('person_department',coalesce(customer_owner_department_id,'unknown'),coalesce(customer_owner_department_name,'归属待确认'))")
 }
 if(o.chartId==='order_volume')dimensions.push("('country',coalesce(country_code,'unknown'),coalesce(country_code,'未知国家'))","('warehouse',coalesce(warehouse_code,'unknown'),coalesce(warehouse_name,warehouse_code,'未知仓库'))")

 const trendColumn=o.trend?({department:customerOwners?'customer_owner_department_id':'department_id',person:customerOwners?'customer_owner_id':'owner_employee_id',customer:'customer_id',country:'country_code',warehouse:'warehouse_code'}[o.trend.dimension]):undefined
 const trendParam=o.customerOwnershipScope&&customerOwners?11:10
 if(o.trend){const format=o.trend.grain==='day'?'YYYY-MM-DD':'YYYY-MM';dimensions.splice(0,dimensions.length,`('${o.trend.grain}',to_char(paid_at AT TIME ZONE 'Asia/Shanghai','${format}'),to_char(paid_at AT TIME ZONE 'Asia/Shanghai','${format}'))`)}
 // COALESCE evaluates the receipt subquery only for a missing order amount; do not eagerly join the company-wide fallback.
 const sql=`WITH members AS (
 SELECT * FROM jsonb_to_recordset($6::jsonb) AS m("employeeId" text,"fopUserId" text,"departmentId" text,"name" text,"englishName" text,"departmentName" text)
 ), ${customerOwners?`customer_owners AS (
 SELECT c.source_id,m."employeeId" customer_owner_id,NULLIF(m."name",'') customer_owner_name,
 m."departmentId" customer_owner_department_id,m."departmentName" customer_owner_department_name,NULLIF(trim(m."englishName"),'') customer_owner_english_name
 FROM hz_fop_collected_customer_registrations c JOIN members m ON m."fopUserId"=c.source_owner_user_id
 WHERE c.batch_id=$1 AND c.company_id=$2 AND c.source_entity='hzkj_member_customer'
 AND NULLIF(m."fopUserId",'') IS NOT NULL
 AND (SELECT count(*) FROM members x WHERE x."fopUserId"=m."fopUserId")=1
 AND ($3::text[] IS NULL OR m."employeeId"=ANY($3::text[]))
 ), customer_lookup AS MATERIALIZED (
 SELECT jsonb_object_agg(source_id,to_jsonb(c)-'source_id') owners FROM customer_owners c
 ), `:''}receipt_totals AS MATERIALIZED (
 SELECT l->>'hzkj_src_order' order_number,
 CASE WHEN count(*)=1 AND max(l->>'hzkj_samount') ~ '^[0-9]+([.][0-9]+)?$' THEN max(l->>'hzkj_samount')::numeric END amount
 FROM hz_fop_collected_analytics_facts r
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.raw->'entryentity')='array' THEN r.raw->'entryentity' ELSE '[]'::jsonb END) l
 WHERE r.batch_id=$1 AND r.company_id=$2 AND r.entity_type='receipt' AND r.raw_status='C'
 AND r.raw->>'hzkj_receive_type'='A' AND coalesce(r.raw->>'hzkj_void_status','') IN ('','0')
 AND l->>'hzkj_entry_src_type'='A' AND NULLIF(l->>'id','') IS NOT NULL
 AND coalesce(NULLIF(r.raw->>'hzkj_settlecurrency_number',''),NULLIF(r.raw->'hzkj_settlecurrency'->>'number',''),r.currency_code,CASE WHEN r.company_id='100000' THEN 'USD' END)='USD'
 GROUP BY l->>'hzkj_src_order'
 ), unique_orders AS MATERIALIZED (
 SELECT document_number FROM hz_fop_collected_analytics_facts WHERE batch_id=$1 AND company_id=$2 AND entity_type='fulfillment' GROUP BY document_number HAVING count(*)=1
 ), unique_lookup AS MATERIALIZED (
 SELECT jsonb_object_agg(document_number,true) AS ids FROM unique_orders
 ), receipt_lookup AS MATERIALIZED (
 SELECT jsonb_object_agg(order_number,amount) AS amounts FROM receipt_totals CROSS JOIN unique_lookup
 WHERE amount IS NOT NULL AND unique_lookup.ids ? order_number
 ), ${o.trend?'unfocused':'source'} AS (
 SELECT f.source_id,f.entity_type,f.paid_at,f.raw->>'hzkj_receipt_status' receipt_status,f.owner_employee_id,m."name" owner_name,NULLIF(trim(m."englishName"),'') owner_english_name,m."departmentId" department_id,m."departmentName" department_name,
 NULLIF(f.facts->'customer'->>'id','') customer_id,NULLIF(f.facts->'customer'->>'name','') customer_name,
 ${customerOwners?'c.customer_owner_id,c.customer_owner_name,c.customer_owner_department_id,c.customer_owner_department_name,c.customer_owner_english_name,':''}
 NULLIF(f.facts->>'countryCode','') country_code,coalesce(NULLIF(f.facts->'warehouse'->>'number',''),NULLIF(f.facts->'warehouse'->>'id','')) warehouse_code,NULLIF(f.facts->'warehouse'->>'name','') warehouse_name,
 COALESCE(CASE WHEN (f.raw->>(CASE WHEN f.entity_type='fulfillment' THEN 'hzkj_total_amount' ELSE 'hzkj_order_amount' END)) ~ '^-?[0-9]+([.][0-9]+)?$' THEN (f.raw->>(CASE WHEN f.entity_type='fulfillment' THEN 'hzkj_total_amount' ELSE 'hzkj_order_amount' END))::numeric END,CASE WHEN f.entity_type='fulfillment' AND f.company_id='100000' AND coalesce(NULLIF(f.raw->>'hzkj_settlecurrency_number',''),NULLIF(f.raw->'hzkj_settlecurrency'->>'number',''),'USD')='USD' THEN (SELECT (rt.amounts->>f.document_number)::numeric FROM receipt_lookup rt) END) order_amount,
 CASE WHEN coalesce(f.raw->>'hzkj_settlecurrency_number',f.raw->'hzkj_settlecurrency'->>'number') ~ '^[A-Z]{3}$' THEN coalesce(f.raw->>'hzkj_settlecurrency_number',f.raw->'hzkj_settlecurrency'->>'number')
 WHEN f.company_id='100000' AND f.entity_type='fulfillment' AND NULLIF(coalesce(f.raw->>'hzkj_settlecurrency_number',f.raw->'hzkj_settlecurrency'->>'number'),'') IS NULL THEN 'USD' END currency,
 f.quantity
 FROM hz_fop_collected_analytics_facts f LEFT JOIN members m ON m."employeeId"=f.owner_employee_id
 ${customerOwners?`CROSS JOIN customer_lookup cl
 LEFT JOIN LATERAL jsonb_to_record(cl.owners->(f.facts->'customer'->>'id'))
 AS c(customer_owner_id text,customer_owner_name text,customer_owner_department_id text,customer_owner_department_name text,customer_owner_english_name text) ON true`:''}
 WHERE batch_id=$1 AND company_id=$2 AND entity_type=$9
 AND ($3::text[] IS NULL OR ${o.customerOwnershipScope&&customerOwners?'c.customer_owner_id':'owner_employee_id'} = ANY($3::text[]))
 ${o.customerOwnershipScope&&customerOwners?'AND owner_employee_id = ANY($10::text[])':''}
 AND facts->'scope'->>'verified'='true' AND facts->'scope'->>'companyId'=$2
 AND ($3::text[] IS NULL OR facts->>'sourceOwnershipVerified'='true')
 )${o.trend?`, source AS (SELECT * FROM unfocused WHERE coalesce(${trendColumn},'unknown')=$${trendParam})`:''}, filtered AS (
 SELECT * FROM source WHERE paid_at >= $4::timestamptz AND paid_at < $5::timestamptz
 AND ($7::text[] IS NULL OR warehouse_code=ANY($7)) AND ($8::text IS NULL OR currency=$8)
 ), undated AS (
 SELECT * FROM source WHERE paid_at IS NULL
 AND ($7::text[] IS NULL OR warehouse_code=ANY($7)) AND ($8::text IS NULL OR currency=$8)
 ), grouped AS (
 SELECT d.dimension,d.id,d.label,${money?'currency':'NULL::text'} currency,count(*)::int "orderCount",
 ${salespersonGroups?`CASE WHEN d.dimension='person' THEN max(${personDepartment}) END "departmentId",CASE WHEN d.dimension='person' THEN max(${personDepartmentName}) END "departmentName",CASE WHEN d.dimension='person' THEN max(${personEnglishName}) END "englishName",`:''}
 ${customerOwners&&!o.summaryOnly?`CASE WHEN d.dimension='customer' THEN max(customer_owner_name) END "customerOwnerName",`:''}
 ${money?(o.trend?'CASE WHEN count(order_amount)=count(*) THEN sum(order_amount)::text END':'sum(order_amount)::text'):'NULL::text'} amount,
 CASE WHEN count(quantity)=count(*) THEN sum(quantity)::text END quantity
 FROM filtered CROSS JOIN LATERAL (VALUES ${dimensions.join(',')}) d(dimension,id,label)
 ${money&&!o.trend?'WHERE currency IS NOT NULL AND order_amount IS NOT NULL':''}
 GROUP BY d.dimension,d.id,d.label${money?',currency':''}
 ) SELECT jsonb_build_object(
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY dimension,id,currency) FROM grouped g),'[]'::jsonb),
 'orderCount',(SELECT count(*)::int FROM filtered),
 'totalQuantity',(SELECT CASE WHEN count(quantity)=count(*) THEN coalesce(sum(quantity),0)::text END FROM filtered),
 'amountsByCurrency',${money?`coalesce((SELECT jsonb_agg(t ORDER BY t.currency) FROM (SELECT currency,sum(order_amount)::text amount,count(*)::int "orderCount" FROM filtered WHERE currency IS NOT NULL AND order_amount IS NOT NULL GROUP BY currency) t),'[]'::jsonb)`:"'[]'::jsonb"},
 'currencyBasis','source_or_confirmed_fulfillment_usd_2026_11_15',
 'missingAmountCount',(SELECT count(*)::int FROM filtered WHERE order_amount IS NULL),
 'missingCurrencyCount',(SELECT count(*)::int FROM filtered WHERE currency IS NULL),
 'missingPaidAtCount',(SELECT count(*)::int FROM undated),
 'missingPaidAtBreakdown',(SELECT jsonb_build_object(
 'unpaid',count(*) FILTER(WHERE receipt_status='0')::int,
 'paid',count(*) FILTER(WHERE receipt_status='1')::int,
 'unknown',count(*) FILTER(WHERE receipt_status IS NULL OR receipt_status NOT IN ('0','1'))::int) FROM undated),
 'currencies',coalesce((SELECT jsonb_agg(c.currency ORDER BY c.currency) FROM (SELECT DISTINCT currency FROM source WHERE currency IS NOT NULL) c),'[]'::jsonb),
 'warehouses',${`coalesce((SELECT jsonb_agg(w ORDER BY w.name) FROM (SELECT warehouse_code id,max(coalesce(warehouse_name,warehouse_code)) name FROM source WHERE warehouse_code IS NOT NULL GROUP BY warehouse_code) w),'[]'::jsonb)`}
 ) analytics`
 // Department performance has one reporting currency; old client filters cannot switch it.
 const currency=o.chartId==='department_receipts'?'USD':o.currency??null
 return {sql,params:[o.batchId,o.companyId,o.employeeIds,o.start,o.end,JSON.stringify(o.members),o.warehouseCode?warehouseCodes(o.warehouseCode):null,currency,o.entityType??'fulfillment',...o.customerOwnershipScope&&customerOwners?[o.recordEmployeeIds??[]]:[],...o.trend?[o.trend.id]:[]]}
}

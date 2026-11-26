import { BUSINESS_START_DATE } from '../fop-data/fop-business-time'
import { BadRequestException } from '@nestjs/common'
import { collectedWhere } from './collected-workbench-query'

export function analyticsWindow(query: { from?: unknown; to?: unknown }) {
  const parse = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('from/to must be UTC+8 calendar dates (YYYY-MM-DD)')
    const time = Date.parse(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid calendar date')
    return time
  }
  const first = parse(query.from), last = parse(query.to)
  if ((query.from as string) < BUSINESS_START_DATE || last < first || (last - first) / 86400000 >= 366) throw new BadRequestException('Analytics date window must be between 1 and 366 inclusive days')
  return { from: query.from as string, to: query.to as string, start: new Date(first - 28800000).toISOString(), end: new Date(last + 57600000).toISOString(), timezone: 'Asia/Shanghai' }
}

export const ANALYTICS_QUEUES = ['unpaid', 'review', 'dispatch', 'procurement', 'procurement_shipping', 'allocation', 'allocation_review', 'shipping', 'exceptions'] as const
export interface CollectedAnalyticsQueryOptions {
  batchId: string; companyId: string; employeeIds: readonly string[] | null
  members: { employeeId: string; departmentId: string }[]
  window: ReturnType<typeof analyticsWindow>; summaryOnly: boolean
  availableQueues: readonly string[]; availableEntities?: readonly string[]
  freightAvailable?: boolean; freightEmployeeIds?: readonly string[] | null
}

/** One local SQL statement shares a database read snapshot, not a FOP snapshot.
 * Numeric measures become text before JSON construction to preserve decimals. */
export function collectedAnalyticsQuery(options: CollectedAnalyticsQueryOptions) {
  const employeeScope = '($3::text[] IS NULL OR owner_employee_id = ANY($3::text[]))'
  const queuePredicates = ANALYTICS_QUEUES.map(queue => {
    // Current workload counts have no date window; list defaults must not add
    // an unbound day parameter (which would collide with the employee scope).
    const predicate = collectedWhere(options.batchId, options.employeeIds, { queue, timeRange: 'all' }).where.replace(/\$2\b/g, '$3')
    return `${options.availableQueues.includes(queue) ? `(${predicate})` : 'NULL::boolean'} AS todo_${queue}`
  })
  const groupDepartment = options.summaryOnly ? 'member.department_id' : 'NULL::text'
  const pending = ANALYTICS_QUEUES.map(queue => `SELECT ${options.summaryOnly ? 'department_id' : 'NULL::text AS department_id'}, '${queue}' AS queue,
    CASE WHEN ${options.availableQueues.includes(queue)} THEN count(*) FILTER (WHERE todo_${queue})::int ELSE NULL::int END AS count,
    ${options.availableQueues.includes(queue)} AS available FROM current_orders${options.summaryOnly ? ' GROUP BY department_id' : ''}`).join('\nUNION ALL\n')
  const quantityStats = `count(*)::int AS "orderCount", sum(quantity)::text AS "knownItemQuantity",
    CASE WHEN count(*) > 0 AND count(quantity) = count(*) THEN sum(quantity)::text END AS "itemQuantity",
    count(*) FILTER (WHERE quantity IS NULL)::int AS "missingQuantityCount"`
  const sql = `WITH members AS (
    SELECT x."employeeId" AS employee_id, x."departmentId" AS department_id FROM jsonb_to_recordset($6::jsonb) AS x("employeeId" text, "departmentId" text)
  ), current_orders AS (
    SELECT source_id, ${groupDepartment} AS department_id, raw_bill_status, raw_order_status, raw_payment_status, raw_delivery_status,
      display->>'procurementStage' AS procurement_stage, display->>'dispatchTaskStatus' AS dispatch_stage,
      ${queuePredicates.join(',\n      ')}
    FROM hz_fop_collected_orders LEFT JOIN members member ON member.employee_id = owner_employee_id
    WHERE batch_id = $1 AND ${employeeScope}
      AND EXISTS (SELECT 1 FROM hz_fop_collected_batches b WHERE b.id = $1 AND b.company_id = $2 AND b.state = 'active')
  ), scoped_facts AS (
    SELECT f.entity_type, f.source_id, f.owner_employee_id, member.department_id, f.paid_at, f.occurred_at, f.amount,
      f.currency_code, f.quantity, f.raw_status, f.facts,
      NULLIF(f.facts->>'countryCode','') AS country_code, NULLIF(f.facts->'warehouse'->>'number','') AS warehouse_code,
      (member.employee_id IS NULL OR f.facts->>'sourceOwnershipVerified' IS DISTINCT FROM 'true') AS unknown_owner
    FROM hz_fop_collected_analytics_facts f LEFT JOIN members member ON member.employee_id = f.owner_employee_id
    WHERE f.batch_id = $1 AND f.company_id = $2 AND ${employeeScope}
      AND f.facts->'scope'->>'verified' = 'true' AND f.facts->'scope'->>'companyId' = $2
      AND ($3::text[] IS NULL OR f.facts->>'sourceOwnershipVerified' = 'true')
      AND f.entity_type = ANY($7::text[])
  ), paid_orders AS (
    SELECT entity_type,department_id,paid_at,quantity,country_code,warehouse_code FROM scoped_facts
    WHERE entity_type IN ('fulfillment','stock') AND paid_at >= $4::timestamptz AND paid_at < $5::timestamptz
  ), statuses AS (
    SELECT department_id, s.dimension, s.state, count(*)::int AS "orderCount" FROM current_orders
    CROSS JOIN LATERAL (VALUES ('review',raw_bill_status),('order',raw_order_status),('payment',raw_payment_status),('delivery',raw_delivery_status)) s(dimension,state)
    GROUP BY department_id,s.dimension,s.state
  ), stages AS (
    SELECT department_id, s.dimension, s.state, count(*)::int AS "orderCount" FROM current_orders
    CROSS JOIN LATERAL (VALUES ('procurement',procurement_stage),('dispatch',dispatch_stage)) s(dimension,state)
    GROUP BY department_id,s.dimension,s.state
  ), entity_statuses AS (
    SELECT entity_type AS "entityType", ${options.summaryOnly ? 'department_id' : 'NULL::text'} AS "departmentId",
      s.key AS dimension,s.value AS state,count(*)::int AS "documentCount" FROM scoped_facts
    CROSS JOIN LATERAL jsonb_each_text(facts->'statuses') s
    WHERE s.key IN ('bill','order','receipt','purchase','sourcePayment','sourceFulfillment','delivery','stockType','refund','purchaseChannel','payment','standardPayment','shipment','logistics','cancelled','closed','changed','intercept','settlement','handover','received','receiveType','sourceType','arrived','voided','authorized')
    GROUP BY entity_type,${options.summaryOnly ? 'department_id,' : ''}s.key,s.value
  ), pending AS (${pending}), paid_summary AS (
    SELECT entity_type AS "entityType", ${quantityStats} FROM paid_orders GROUP BY entity_type
  ), paid_departments AS (
    SELECT entity_type AS "entityType", department_id AS "departmentId", ${quantityStats} FROM paid_orders GROUP BY entity_type,department_id
  ), daily AS (
    SELECT entity_type AS "entityType", ${options.summaryOnly ? 'department_id' : 'NULL::text'} AS "departmentId",
      to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date, ${quantityStats}
    FROM paid_orders GROUP BY entity_type,${options.summaryOnly ? 'department_id,' : ''}to_char(paid_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')
  ), countries AS (
    SELECT entity_type AS "entityType", country_code AS "countryCode", ${quantityStats} FROM paid_orders WHERE ${!options.summaryOnly} GROUP BY entity_type,country_code
  ), warehouses AS (
    SELECT entity_type AS "entityType", warehouse_code AS "warehouseCode", ${quantityStats} FROM paid_orders WHERE ${!options.summaryOnly} GROUP BY entity_type,warehouse_code
  ), quality AS (
    SELECT entity_type AS "entityType", ${options.summaryOnly ? 'department_id' : 'NULL::text'} AS "departmentId", count(*)::int AS "recordCount",
      count(*) FILTER (WHERE entity_type IN ('fulfillment','stock') AND paid_at IS NULL)::int AS "missingCustomerPaidAtCount",
      count(*) FILTER (WHERE amount IS NULL)::int AS "missingAmountCount",
      count(*) FILTER (WHERE currency_code IS NULL)::int AS "missingCurrencyCount",
      count(*) FILTER (WHERE entity_type IN ('fulfillment','stock') AND quantity IS NULL)::int AS "missingQuantityCount",
      count(*) FILTER (WHERE entity_type = 'dispatch' AND occurred_at IS NULL)::int AS "missingFreightOccurredAtCount",
      count(*) FILTER (WHERE unknown_owner)::int AS "unknownOwnerCount"
    FROM scoped_facts GROUP BY entity_type${options.summaryOnly ? ',department_id' : ''}
  ), freight AS (
    SELECT currency_code AS currency, count(*)::int AS "documentCount", sum(amount)::text AS amount
    FROM scoped_facts WHERE ${!options.summaryOnly && options.freightAvailable !== false} AND entity_type = 'dispatch' AND raw_status = 'C'
      AND facts->>'effective' = 'true' AND facts->>'sourceOwnershipVerified' = 'true'
      AND ($8::text[] IS NULL OR owner_employee_id = ANY($8::text[]))
      AND NOT unknown_owner AND amount IS NOT NULL AND currency_code IS NOT NULL
      AND occurred_at >= $4::timestamptz AND occurred_at < $5::timestamptz GROUP BY currency_code
  ) SELECT jsonb_build_object(
    'current',jsonb_build_object('dateFilterApplied',false,'pendingCountsOverlap',true,
      'orderCount',${options.summaryOnly ? 'NULL::int' : '(SELECT count(*)::int FROM current_orders)'},
      'nativeStatuses',coalesce((SELECT jsonb_agg(jsonb_build_object('departmentId',department_id,'dimension',dimension,'state',state,'orderCount',"orderCount") ORDER BY department_id,dimension,state) FROM statuses),'[]'::jsonb),
      'nativeEntityStatuses',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."entityType",t."departmentId",t.dimension,t.state) FROM entity_statuses t),'[]'::jsonb),
      'derivedStages',coalesce((SELECT jsonb_agg(jsonb_build_object('departmentId',department_id,'dimension',dimension,'state',state,'orderCount',"orderCount") ORDER BY department_id,dimension,state) FROM stages),'[]'::jsonb),
      'pending',coalesce((SELECT jsonb_agg(jsonb_build_object('departmentId',department_id,'queue',queue,'count',count,'available',available) ORDER BY department_id,queue) FROM pending),'[]'::jsonb)),
    'customerPaidOrders',jsonb_build_object('timeField','paid_at','basis','customer_payment_date_records','statusFilterApplied',false,
      'summary',${options.summaryOnly ? "'null'::jsonb" : "coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.\"entityType\") FROM paid_summary t),'[]'::jsonb)"},
      'byDepartment',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."entityType",t."departmentId") FROM paid_departments t),'[]'::jsonb),
      'daily',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.date,t."entityType",t."departmentId") FROM daily t),'[]'::jsonb),
      'byCountry',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."entityType",t."countryCode") FROM countries t),'[]'::jsonb),
      'byWarehouse',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."entityType",t."warehouseCode") FROM warehouses t),'[]'::jsonb)),
    'dataQuality',jsonb_build_object('dateFilterApplied',false,'byEntity',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t."entityType",t."departmentId") FROM quality t),'[]'::jsonb)),
    'actualFreight',jsonb_build_object('timeField','occurred_at','available',${!options.summaryOnly && options.freightAvailable !== false},'amountsByCurrency',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.currency) FROM freight t),'[]'::jsonb))
  ) AS analytics`
  return { sql, params: [options.batchId, options.companyId, options.employeeIds, options.window.start, options.window.end, JSON.stringify(options.members), options.availableEntities ?? ['fulfillment'], options.freightEmployeeIds ?? options.employeeIds] }
}

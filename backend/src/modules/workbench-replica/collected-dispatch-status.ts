// Same rule as orderDispatchTaskStatus, evaluated before count, pagination and export.
const array = (value: string) => `CASE WHEN jsonb_typeof(${value})='array' THEN ${value} ELSE '[]'::jsonb END`
const documents = `jsonb_array_elements(${array("display->'dispatchDocuments'")}) d`
const effective = `d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'`
const unknown = `jsonb_typeof(display->'dispatchDocuments') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${array("display->'nativeAssociationIssues'")}) issue WHERE issue IN ('dispatch_relationship_conflict','parent_version_conflict'))
 OR EXISTS(SELECT 1 FROM ${documents} WHERE coalesce(d->'association'->>'state','verified')<>'verified' OR (${effective} AND jsonb_typeof(d->'trackingNumbers') IS DISTINCT FROM 'array'))`
const tracked = `EXISTS(SELECT 1 FROM ${documents} CROSS JOIN LATERAL jsonb_array_elements(${array("d->'trackingNumbers'")}) t
 WHERE ${effective} AND t->>'type' IN ('full','first_mile','last_mile') AND NULLIF(btrim(t->>'number'),'') IS NOT NULL)`
export const collectedDispatchTaskSql = `(CASE WHEN raw_order_status='6' THEN 'dispatch_cancelled'
 WHEN raw_order_status IN ('4','5') THEN 'dispatch_synced'
 WHEN raw_order_status NOT IN ('2','3') OR raw_order_status IS NULL OR (${unknown}) THEN 'unknown'
 WHEN ${tracked} THEN CASE WHEN raw_order_status='3' THEN 'dispatch_tracking' ELSE 'unknown' END
 ELSE 'dispatch_pending' END)`

export const collectedDispatchFailureSql = `(raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM ${documents} WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND ${effective} AND d->>'deliveryStatus'='SYNC_FAILED'))`

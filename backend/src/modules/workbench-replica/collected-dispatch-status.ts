import { sourceShipmentSql } from './source-shipment-sql'
// Same rule as orderDispatchTaskStatus, evaluated before count, pagination and export.
const array = (value: string) => `CASE WHEN jsonb_typeof(${value})='array' THEN ${value} ELSE '[]'::jsonb END`
const documents = `jsonb_array_elements(${array("display->'dispatchDocuments'")}) d`
const effective = `d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' AND d->>'deliveryStatus' IS DISTINCT FROM 'CANCELLED'`
const unknown = `jsonb_typeof(display->'dispatchDocuments') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${array("display->'nativeAssociationIssues'")}) issue WHERE issue IN ('dispatch_relationship_conflict','parent_version_conflict'))
 OR EXISTS(SELECT 1 FROM ${documents} WHERE coalesce(d->'association'->>'state','verified')<>'verified' OR (${effective} AND jsonb_typeof(d->'trackingNumbers') IS DISTINCT FROM 'array'))`
const tracked = `EXISTS(SELECT 1 FROM ${documents} CROSS JOIN LATERAL jsonb_array_elements(${array("d->'trackingNumbers'")}) t
 WHERE ${effective} AND t->>'type'='full' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL)`
export const collectedDispatchTaskSql = `(CASE WHEN raw_order_status='6' THEN 'dispatch_cancelled'
 WHEN (${sourceShipmentSql})='fulfilled' THEN 'dispatch_synced'
 WHEN coalesce((${sourceShipmentSql}) IN ('unfulfilled','partial'),false)=false OR raw_order_status IN ('0','6') OR (${unknown}) THEN 'unknown'
 WHEN NOT EXISTS(SELECT 1 FROM ${documents} WHERE ${effective} AND jsonb_typeof(d->'number')='string' AND NULLIF(trim(d->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL) THEN CASE WHEN ${tracked} THEN 'unknown' ELSE 'dispatch_missing' END
 WHEN ${tracked} THEN 'dispatch_tracking'
 ELSE 'dispatch_pending' END)`

export const collectedDispatchFailureSql = `(raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM ${documents} WHERE coalesce(d->'association'->>'state','verified')='verified'
 AND ${effective} AND d->>'deliveryStatus'='SYNC_FAILED'))`

// Keep the same package selection as collectedPackageSource; supplemental facts are scoped to this order/company.
export const collectedPackagesSql = `(CASE WHEN NOT jsonb_exists(raw,'hzkj_logistics_info') AND display->'moneyCapture'->>'sourceId'=raw->>'id'
 AND display->'moneyCapture'->>'orderNumber'=raw->>'billno'
 AND display->'moneyCapture'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND display->'moneyCapture'->>'operation' IN ('order-detail','order-list')
 AND jsonb_exists(display->'moneyCapture'->'values','hzkj_logistics_info')
 THEN display->'moneyCapture'->'values'->'hzkj_logistics_info' ELSE raw->'hzkj_logistics_info' END)`
export const collectedMissingFulfilledTrackingSql = `(raw_bill_status='C' AND raw_order_status IN ('4','5')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${array(collectedPackagesSql)}) pkg
 WHERE jsonb_typeof(pkg->'hzkj_tracking_number')='string' AND NULLIF(trim(pkg->>'hzkj_tracking_number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL))`
// Require the displayed full/QC number on each dispatch that claims tracking was obtained.
const dispatchNumber = `jsonb_typeof(t->'number')='string' AND NULLIF(trim(t->>'number', ' ' || chr(9) || chr(10) || chr(13)),'') IS NOT NULL`
const dispatchTracking = `jsonb_array_elements(${array("d->'trackingNumbers'")}) t`
export const collectedMissingObtainedTrackingSql = `(raw_bill_status='C' AND raw_order_status IN ('2','3','4','5')
 AND EXISTS(SELECT 1 FROM ${documents} WHERE coalesce(d->'association'->>'state','verified')='verified' AND ${effective}
 AND (d->>'deliveryStatus'='TRACKING_OBTAINED' OR EXISTS(SELECT 1 FROM ${dispatchTracking} WHERE t->>'type' IN ('full','first_mile','last_mile') AND ${dispatchNumber}))
 AND NOT EXISTS(SELECT 1 FROM ${dispatchTracking} WHERE t->>'type'='full' AND ${dispatchNumber})))`
export const collectedDispatchExceptionSql = `(${collectedDispatchFailureSql} OR ${collectedMissingObtainedTrackingSql} OR ${collectedMissingFulfilledTrackingSql})`

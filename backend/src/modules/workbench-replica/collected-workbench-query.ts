import { warehouseCodes } from './warehouse-codes'
import { collectedDispatchTaskSql, collectedDispatchFailureSql } from './collected-dispatch-status'
import { collectedAllocationPredicate, collectedAllocationCompletedAt } from './collected-allocation-query'
type Query = Record<string, any>
/** Same effective-document rule as the allocation UI; empty/only cancelled is incomplete. */
export function collectedDispatchCompletePredicate(){
 return `EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(display->'dispatchDocuments','[]'::jsonb)) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' HAVING count(*)>0 AND bool_and(coalesce(d->>'status'='approved',false)))`
}
/** All conditions apply before pagination. Unknown downstream facts stay in the diagnostic queue. */
export function collectedWhere(batchId:string,employeeIds:readonly string[]|null,q:Query) {
 const params:unknown[]=[batchId], clauses=['batch_id = $1']
 const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`owner_employee_id = ANY(${bind(employeeIds)}::text[])`)
 const active="raw_order_status IN ('1','2','3','4','5','no')"
 const paidActive=`${active} AND raw_payment_status='1'`
 const dispatchPending=`raw_bill_status='C' AND raw_order_status IN ('2','3','6') AND NOT ${collectedDispatchFailureSql}`
 const procurementPending=`${paidActive} AND raw_bill_status='C' AND display->>'nativeProcurementCaptured'='true' AND display->>'procurementStage' IN ('purchase_order_pending','alibaba_pending','payment_pending','refund_pending')`
 const supplierPending=`${paidActive} AND raw_bill_status='C' AND display->>'nativeProcurementCaptured'='true' AND display->>'procurementStage' IN ('supplier_pending','supplier_partial')`
 const pendingOutbound="((NOT jsonb_exists(display,'businessStatus') AND raw_delivery_status IN ('0','1')) OR display->'businessStatus'->>'outbound' IN ('pending','partial'))"
 const completedOutbound="((NOT jsonb_exists(display,'businessStatus') AND raw_delivery_status='2') OR display->'businessStatus'->>'outbound'='completed')"
 const shippingPending=`${paidActive} AND ${pendingOutbound} AND display->>'nativeShippingReady'='true'`
 // Sales preparation is determined by the fulfillment ORDER status, not receipt status.
 // Read the source-platform status from this same captured document; never infer it from outbound/dispatch.
 const sourceFulfillmentStatus=`CASE WHEN jsonb_exists(raw,'hzkj_fulfillment_status') THEN raw->>'hzkj_fulfillment_status'
  WHEN display->'salesSourceStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourceStatus'->>'sourceId'=source_id
   AND display->'salesSourceStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourceStatus'->>'fulfillmentStatus' END`
 const sourcePaymentStatus=`CASE WHEN jsonb_exists(raw,'hzkj_sourcepayststus') THEN raw->>'hzkj_sourcepayststus'
  WHEN display->'salesSourcePaymentStatus'->>'source'='fulfillment_capture'
   AND display->'salesSourcePaymentStatus'->>'sourceId'=source_id
   AND display->'salesSourcePaymentStatus'->>'orderStatus'=raw_order_status
  THEN display->'salesSourcePaymentStatus'->>'paymentStatus' END`
 const unpaidBase=`raw_order_status IN ('no','1') AND (${sourceFulfillmentStatus}) IS DISTINCT FROM 'fulfilled'`
 const unpaid=`${unpaidBase}
  AND coalesce((${sourcePaymentStatus}) NOT IN ('refunded','voided','expired','unpaid'),true)`
 const reviewPending="raw_order_status='2' AND raw_bill_status IN ('A','B')"
 const normalPending=[unpaidBase,reviewPending,dispatchPending,procurementPending,supplierPending,shippingPending,collectedAllocationPredicate('allocation'),collectedAllocationPredicate('allocation_review')].map(x=>`(${x})`).join(' OR ')
 // Explicit issues and unresolved unfinished coverage are distinct from ordinary paid work.
 // COALESCE is essential: a missing base field cannot make NOT(normal membership) UNKNOWN.
 const explicitIssues=`(display->'businessStatus'->>'outbound'='unknown' AND raw_delivery_status='1') OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced') OR jsonb_array_length(coalesce(display->'nativeAssociationIssues','[]'::jsonb))>0 OR jsonb_array_length(coalesce(display->'nativeProcurementAssociationIssues','[]'::jsonb))>0 OR EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id AND a.display->>'rawAllocationStatus'='error')`
 const missingBase=`raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1') OR raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no')`
 const uncertainNative=`${paidActive} AND (display->>'nativeFactsCaptured' IS DISTINCT FROM 'true' OR display->>'nativeProcurementCaptured' IS DISTINCT FROM 'true' OR display->>'dispatchTaskStatus'='unknown' OR display->>'procurementStage'='unknown')`
 const exceptions=`${collectedDispatchFailureSql} OR (${explicitIssues}) OR (raw_delivery_status IS DISTINCT FROM '2' AND ((${missingBase}) OR (${uncertainNative}) OR NOT coalesce((${normalPending}),false)))`
 const queues:Record<string,string>={
  allocation:collectedAllocationPredicate('allocation',!!q.completed),
  allocation_review:collectedAllocationPredicate('allocation_review',!!q.completed),
  shipping:q.completed?completedOutbound:shippingPending,
  dispatch:q.completed?`raw_bill_status='C' AND raw_order_status IN ('4','5') AND NOT ${collectedDispatchFailureSql}`:dispatchPending,
  procurement:q.completed?`${paidActive} AND display->>'nativeProcurementCaptured'='true' AND display->>'procurementStage'='shipped'`:procurementPending,
  procurement_shipping:supplierPending,
  unpaid,
  review:q.completed?"raw_bill_status = 'C'":reviewPending,
  exceptions,
 }
 clauses.push(queues[q.queue]||'FALSE')
 if(q.queue==='unpaid')clauses.push(q.skuAssociation==='unlinked'?"raw_order_status='no'":"raw_order_status='1'")
 if(q.queue==='shipping'&&q.warehouseStage==='pending_review')clauses.push('FALSE')
 if(q.taskStatus&&q.taskStatus!=='all'){if(['allocation','allocation_review'].includes(q.queue)&&['dispatch_complete','dispatch_incomplete'].includes(q.taskStatus))clauses.push(`${q.taskStatus==='dispatch_incomplete'?'NOT ':''}${collectedDispatchCompletePredicate()}`);else if(q.queue==='dispatch')clauses.push(`${collectedDispatchTaskSql}=${bind(q.taskStatus)}`);else if(['procurement','procurement_shipping'].includes(q.queue))clauses.push(`display->>'procurementStage'=${bind(q.taskStatus)}`);else if(q.queue==='exceptions')clauses.push(`(CASE WHEN ${collectedDispatchFailureSql} THEN 'dispatch_exception' ELSE display->'exception'->>'type' END)=${bind(q.taskStatus)}`);else if(q.queue==='shipping'&&q.taskStatus==='outbound_pending')clauses.push(pendingOutbound);else clauses.push('FALSE')}
 if(q.procurementStage&&q.procurementStage!=='all')clauses.push(`display->>'procurementStage'=${bind(q.procurementStage)}`)
 const like=(v:string)=>`%${v.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`
 if(q.search?.trim())clauses.push(`search_text LIKE ${bind(like(q.search.trim()))}${q.searchOwnerIds?.length?` OR owner_employee_id = ANY(${bind(q.searchOwnerIds)}::text[])`:''}`)
 if(q.orderNumber?.trim())clauses.push(`lower(order_number) LIKE ${bind(like(q.orderNumber.trim()))}`)
 if(q.shippingCountryCode)clauses.push(`country_code = ${bind(q.shippingCountryCode)}`)
 if(q.warehouseCode)clauses.push(`warehouse_code = ANY(${bind(warehouseCodes(q.warehouseCode))}::text[])`)
 const paymentTime=q.queue==='unpaid'?'consumer_paid_at':'paid_at'
 const days:Record<string,number>={'1w':7,'1m':30,'3m':90}
 const range=q.timeRange??(q.completed&&q.queue==='review'?'1w':undefined);if(days[range])clauses.push(`${paymentTime} >= now() - (${bind(days[range])} * interval '1 day') AND ${paymentTime} <= now()`)
 if(q.mode==='selected')clauses.push(`source_id = ANY(${bind(q.orderIds)}::text[])`)
 const sorts:Record<string,string>={...(q.queue==='dispatch'?{dispatchDocumentStatus:`array_position(ARRAY['dispatch_pending','dispatch_tracking','dispatch_cancelled','dispatch_synced'],${collectedDispatchTaskSql})`}:{}),paidAt:'paid_at',consumerPaidAt:paymentTime,reviewedAt:"NULLIF(display->>'reviewedAt','')::timestamptz",completedAt:['allocation','allocation_review'].includes(q.queue)?collectedAllocationCompletedAt():`NULLIF(display->>'${q.queue==='dispatch'?'dispatchApprovedAt':q.queue==='procurement'?'procurementCompletedAt':q.queue==='shipping'?'outboundCompletedAt':'reviewedAt'}','')::timestamptz`}
 return {where:clauses.map(x=>`(${x})`).join(' AND '),params,orderBy:`${sorts[q.sortBy]||paymentTime} ${q.sortOrder==='asc'||!q.sortOrder&&q.paidAtOrder==='asc'?'ASC':'DESC'} NULLS LAST, source_id ASC`}
}

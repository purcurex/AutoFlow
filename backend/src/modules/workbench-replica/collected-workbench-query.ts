import { collectedDiagnosticTypeSql, collectedOutboundUnverifiedSql, collectedAllocationErrorSql } from './collected-exception-classification'
import { collectedPaymentDataExceptionSql } from './collected-payment-data-quality'
import { warehouseCodes } from './warehouse-codes'
import { collectedDispatchTaskSql, collectedDispatchExceptionSql } from './collected-dispatch-status'
import { collectedAllocationBillStatus, collectedAllocationPredicate, collectedAllocationCompletedAt } from './collected-allocation-query'
type Query = Record<string, any>
/** Same effective-document rule as the allocation UI; empty/only cancelled is incomplete. */
export function collectedDispatchCompletePredicate(){
 return `EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(display->'dispatchDocuments','[]'::jsonb)) d WHERE coalesce(d->'association'->>'state','verified')='verified' AND d->>'rawInterceptStatus' IS DISTINCT FROM 'CANCELLED' HAVING count(*)>0 AND bool_and(coalesce(d->>'status'='approved',false)))`
}
/** All conditions apply before pagination. Missing downstream capture alone does not create a business exception. */
export function collectedWhere(batchId:string,employeeIds:readonly string[]|null,q:Query,exceptionMode:'stored'|'facts'='stored') {
 const params:unknown[]=[batchId], clauses=['batch_id = $1']
 const bind=(v:unknown)=>{params.push(v);return `$${params.length}`}
 if(employeeIds!==null)clauses.push(`owner_employee_id = ANY(${bind(employeeIds)}::text[])`)
 const active="raw_order_status IN ('1','2','3','4','5','no')"
 const paidActive=`${active} AND raw_payment_status='1'`
 const dispatchPending=`raw_bill_status='C' AND raw_order_status IN ('2','3')`
 const procurementPending=`${paidActive} AND raw_bill_status='C' AND display->>'nativeProcurementCaptured'='true' AND display->'procurementQueueFlags'->>'pending'='true'`
 const supplierPending=`${paidActive} AND raw_bill_status='C' AND display->>'nativeProcurementCaptured'='true' AND display->'procurementQueueFlags'->>'shipping'='true'`
 const pendingOutbound="((coalesce(display->'businessStatus'->>'outbound','unknown')='unknown' AND raw_delivery_status IN ('0','1')) OR display->'businessStatus'->>'outbound' IN ('pending','partial'))"
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
 // Integration coverage is an engineering diagnostic, not a business exception.
 // Keep actual source conflicts and explicit errors; do not require every normal order to have downstream documents.
 const explicitIssues=`(coalesce(${collectedDiagnosticTypeSql()},'')<>'' AND (display->'exception'->>'code' IS DISTINCT FROM 'paid_date_missing' OR ${collectedPaymentDataExceptionSql}) AND NOT (display->'exception'->>'type'='dispatch_exception' AND raw_order_status IN ('no','1') AND (${sourceFulfillmentStatus}) IS DISTINCT FROM 'fulfilled')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('parent_version_conflict','dispatch_relationship_conflict','allocation_relationship_conflict')) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(display->'nativeProcurementAssociationIssues','[]'::jsonb)) issue WHERE issue IN ('current_purchase_relationship_conflict')) OR ${collectedOutboundUnverifiedSql()} OR (raw_order_status IN ('2','3') AND display->>'dispatchTaskStatus'='dispatch_synced') OR ${collectedAllocationErrorSql()}`
 const missingBase=`raw_order_status IS NULL OR raw_order_status NOT IN ('0','1','2','3','4','5','6','no') OR (raw_order_status IN ('2','3','4','5') AND (raw_payment_status IS NULL OR raw_payment_status NOT IN ('0','1')))`
 const exceptions=`raw_order_status='6' OR ${collectedPaymentDataExceptionSql} OR (${explicitIssues}) OR ${collectedDispatchExceptionSql} OR (${missingBase})`

 const queues:Record<string,string>={
  allocation:collectedAllocationPredicate('allocation',!!q.completed),
  allocation_review:collectedAllocationPredicate('allocation_review',!!q.completed),
  shipping:q.completed?completedOutbound:shippingPending,
  dispatch:q.completed?`raw_bill_status='C' AND raw_order_status IN ('4','5')`:dispatchPending,
  procurement:q.completed?`${paidActive} AND display->>'nativeProcurementCaptured'='true' AND display->'procurementQueueFlags'->>'completed'='true'`:procurementPending,
  procurement_shipping:supplierPending,
  unpaid,
  review:q.completed?"raw_bill_status = 'C'":reviewPending,
  exceptions:exceptionMode==='stored'?'is_exception':exceptions,
 }
 const membershipIndex=clauses.length
 clauses.push(queues[q.queue]||'FALSE')
 if(!q.completed && ['A','B'].includes(q.billStatus) && ['review','allocation_review'].includes(q.queue)) clauses.push(q.queue==='review' ? `raw_bill_status=${bind(q.billStatus)}` : collectedAllocationBillStatus(bind(q.billStatus)))
 if(q.queue==='unpaid')clauses.push(q.skuAssociation==='unlinked'?"raw_order_status='no'":"raw_order_status='1'")
 if(q.queue==='shipping'&&q.warehouseStage==='pending_review')clauses.push('FALSE')
 const exceptionTypeIndex=q.queue==='exceptions'&&q.taskStatus&&q.taskStatus!=='all'?clauses.length:-1
 if(q.taskStatus&&q.taskStatus!=='all'){if(['allocation','allocation_review'].includes(q.queue)&&['dispatch_complete','dispatch_incomplete'].includes(q.taskStatus))clauses.push(`${q.taskStatus==='dispatch_incomplete'?'NOT ':''}${collectedDispatchCompletePredicate()}`);else if(q.queue==='dispatch')clauses.push(`${collectedDispatchTaskSql}=${bind(q.taskStatus)}`);else if(['procurement','procurement_shipping'].includes(q.queue))clauses.push(`${q.queue==='procurement_shipping'?"display->>'nativeSupplierShipment'":"display->>'procurementStage'"}=${bind(q.queue==='procurement_shipping'?({supplier_pending:'pending',supplier_partial:'partial'} as Query)[q.taskStatus]:q.taskStatus)}`);else if(q.queue==='exceptions')clauses.push(exceptionMode==='stored'?`exception_type=${bind(q.taskStatus)}`:`(CASE WHEN raw_order_status='6' THEN 'logistics_exception' WHEN ${collectedPaymentDataExceptionSql} THEN 'logistics_exception' WHEN ${collectedDispatchExceptionSql} THEN 'dispatch_exception' ELSE ${collectedDiagnosticTypeSql()} END)=${bind(q.taskStatus)}`);else if(q.queue==='shipping'&&q.taskStatus==='outbound_pending')clauses.push(pendingOutbound);else clauses.push('FALSE')}
 if(q.procurementStage&&q.procurementStage!=='all')clauses.push(`${q.queue==='procurement_shipping'?"display->>'nativeSupplierShipment'":"display->>'procurementStage'"}=${bind(q.queue==='procurement_shipping'?({supplier_pending:'pending',supplier_partial:'partial'} as Query)[q.procurementStage]:q.procurementStage)}`)
 if(q.procurementSource){
  const field:Record<string,string>={full_payment:'fullPaymentQuantity',deposit:'depositQuantity',direct:'directQuantity'}
  clauses.push(['procurement','procurement_shipping'].includes(q.queue)&&field[q.procurementSource]?`EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(display->'procurementSources'->'items','[]'::jsonb)) source WHERE source->>'complete'='true' AND CASE WHEN source->>'${field[q.procurementSource]}' ~ '^[0-9]+([.][0-9]+)?$' THEN (source->>'${field[q.procurementSource]}')::numeric>0 ELSE false END)`:'FALSE')
 }
 const like=(v:string)=>`%${v.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`
 if(q.search?.trim())clauses.push(`search_text LIKE ${bind(like(q.search.trim()))}${q.searchOwnerIds?.length?` OR owner_employee_id = ANY(${bind(q.searchOwnerIds)}::text[])`:''}`)
 if(q.orderNumber?.trim())clauses.push(`lower(order_number) LIKE ${bind(like(q.orderNumber.trim()))}`)
 if(q.shippingCountryCode)clauses.push(`country_code = ${bind(q.shippingCountryCode)}`)
 if(q.warehouseCode)clauses.push(`warehouse_code = ANY(${bind(warehouseCodes(q.warehouseCode))}::text[])`)
 const paymentTime=q.queue==='unpaid'?'consumer_paid_at':'paid_at'
 const days:Record<string,number>={'1w':7,'1m':30,'3m':90}
 const range=q.timeRange??(q.completed&&q.queue==='review'?'1m':undefined);if(days[range])clauses.push(`${paymentTime} >= now() - (${bind(days[range])} * interval '1 day') AND ${paymentTime} <= now()`)
 if(q.mode==='selected')clauses.push(`source_id = ANY(${bind(q.orderIds)}::text[])`)
 const sorts:Record<string,string>={...(q.queue==='dispatch'?{dispatchDocumentStatus:`array_position(ARRAY['dispatch_pending','dispatch_tracking','dispatch_cancelled','dispatch_synced'],${collectedDispatchTaskSql})`}:{}),paidAt:'paid_at',consumerPaidAt:paymentTime,reviewedAt:"NULLIF(display->>'reviewedAt','')::timestamptz",completedAt:['allocation','allocation_review'].includes(q.queue)?collectedAllocationCompletedAt():`NULLIF(display->>'${q.queue==='dispatch'?'dispatchApprovedAt':q.queue==='procurement'?'procurementCompletedAt':q.queue==='shipping'?'outboundCompletedAt':'reviewedAt'}','')::timestamptz`}
 return {where:clauses.map(x=>`(${x})`).join(' AND '),
  // Internal first pass only: the completed-page query must apply the shared exception predicate afterwards.
  dispatchCandidateWhere:q.queue==='dispatch'&&q.completed?clauses.map((x,i)=>`(${i===membershipIndex?"raw_bill_status='C' AND raw_order_status IN ('4','5')":x})`).join(' AND '):undefined,
  // Candidate filtering is only an optimization; the exception page still applies the full where predicate.
  exceptionCandidateWhere:q.queue==='exceptions'?clauses.filter((_,i)=>i!==membershipIndex&&i!==exceptionTypeIndex).map(x=>`(${x})`).join(' AND '):undefined,
  params,orderBy:`${sorts[q.sortBy]||paymentTime} ${q.sortOrder==='asc'||!q.sortOrder&&q.paidAtOrder==='asc'?'ASC':'DESC'} NULLS LAST, source_id ASC`}
}

const relation=`a.batch_id=hz_fop_collected_orders.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=hz_fop_collected_orders.source_id`
/** Verified allocation coverage is required by the caller. Readiness and audit
 * are allocation facts; an absent parent outbound field must not hide this task.
 * Unknown allocation states still block membership. */
export function collectedAllocationPredicate(queue:string,completed=false){
 const pending="a.display->>'rawBillStatus' IN ('A','B')"
 const state=completed?`bool_and(a.display->>'rawBillStatus'='C' AND coalesce(a.display->>'rawAllocationStatus'='completed',false))`:queue==='allocation_review'?`bool_or(${pending}) AND bool_and(a.display->>'rawAllocationStatus'='completed') FILTER (WHERE ${pending})`:`bool_or(${pending}) AND bool_and(a.display->>'rawAllocationStatus' IN ('pending','available','completed')) FILTER (WHERE ${pending}) AND bool_or(a.display->>'rawAllocationStatus' IN ('pending','available')) FILTER (WHERE ${pending})`
 return `raw_bill_status='C' AND EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE ${relation} AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided' HAVING count(*)>0 AND bool_and(coalesce(a.display->'association'->>'state','verified')='verified') AND bool_and(coalesce(a.display->>'rawBillStatus' IN ('A','B','C')${completed?'':" AND (a.display->>'rawBillStatus'='C' OR a.display->>'rawAllocationStatus' IS NOT NULL)"},false)) AND ${state})`
}
export function collectedAllocationDisplay(completed=false,ready=false){
 const active=`FROM hz_fop_collected_entities a WHERE ${relation} AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided'`
 const docs=`(SELECT jsonb_agg(a.display ORDER BY a.source_id) ${active})`
 const readiness=completed?`(SELECT CASE WHEN bool_and(coalesce(a.display->>'rawAllocationStatus'='completed',false)) THEN 'ready' ELSE 'unknown' END ${active})`:`'${ready?'ready':'incomplete'}'`
 return `display || jsonb_build_object('allocationDocuments',${docs},'allocationDocument',(SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(a.display)->0) ELSE NULL END ${active}),'allocationApprovedAt',${completed?`(SELECT CASE WHEN count(a.display->>'approvedAt')=count(*) THEN max(a.display->>'approvedAt') END ${active})`:'NULL'},'allocationReadyAt',(SELECT CASE WHEN count(a.display->>'readyAt')=count(*) THEN max(a.display->>'readyAt') END ${active}),'allocationStatus','${completed?'approved':ready?'ready':'incomplete'}','fulfillmentProgress',coalesce(display->'fulfillmentProgress','{}'::jsonb)||jsonb_build_object('allocationCreated',true,'stockReadiness',${readiness},'allocationReview','${completed?'approved':'pending'}'))`
}

export function collectedAllocationCompletedAt(){return `(SELECT CASE WHEN count(a.display->>'approvedAt')=count(*) THEN max(NULLIF(a.display->>'approvedAt','')::timestamptz) END FROM hz_fop_collected_entities a WHERE ${relation} AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided')`}

/** Filter persisted allocation entities, before response projection adds allocationDocuments. */
export function collectedAllocationBillStatus(parameter: string) {
 return `EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE ${relation} AND a.display->>'rawAllocationStatus' IS DISTINCT FROM 'voided' AND coalesce(a.display->'association'->>'state','verified')='verified' AND a.display->>'rawBillStatus'=${parameter})`
}

/** Missing dates need an explicit source null and a verified same-company capture. */
export const collectedPaymentDataExceptionSql = `(raw_payment_status='1' AND paid_at IS NULL
 AND raw->>'id'=source_id AND raw->>'hzkj_receipt_status'='1'
 AND jsonb_exists(raw,'hzkj_receipt_date') AND NULLIF(trim(raw->>'hzkj_receipt_date'),'') IS NULL
 AND ((display->'paymentDataCheck'->>'source'='fop_targeted_query'
 AND display->'paymentDataCheck'->>'state'='confirmed_empty'
 AND display->'paymentDataCheck'->>'sourceId'=source_id)
 OR (raw->'timestampProjection'->>'entityCode'='hzkj_orders'
 AND raw->'timestampProjection'->>'companyBasis' IN ('verified_timestamp_scope','source_org_id_checked_against_timestamp_scope')
 AND raw->'timestampProjection'->>'companyId'=(SELECT b.company_id FROM hz_fop_collected_batches b WHERE b.id=hz_fop_collected_orders.batch_id)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[raw->>'org_id',raw->'org'->>'id',raw->>'organizationId',raw->'hzkj_org'->>'id']) company
 WHERE company IS NOT NULL AND company<>raw->'timestampProjection'->>'companyId'))))`

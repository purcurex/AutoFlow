/** Local facts for the selected order package. No upstream request or cross-order inference. */
export const localLogisticsSql = `(SELECT jsonb_agg(jsonb_build_object(
  'carrierName',lp.name,'channelName',ch.name,'channelCode',ch.code,'shopifyTracking',tr.tracking) ORDER BY pkg.source_package_key)
  FROM hz_fop_order_packages pkg
  LEFT JOIN hz_fop_reference_items lp ON lp.connection_id=o.connection_id AND lp.company_id=o.company_id AND lp.resource_type='logistics_provider' AND lp.source_id=pkg.provider_id AND lp.deleted_at IS NULL
  LEFT JOIN hz_fop_reference_items ch ON ch.connection_id=o.connection_id AND ch.company_id=o.company_id AND ch.resource_type='actual_channel' AND ch.source_id=pkg.channel_id AND ch.deleted_at IS NULL
  LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('type',tn.tracking_type,'number',tn.number))->0 AS tracking
    FROM hz_fop_tracking_numbers tn JOIN hz_fop_source_documents ts ON ts.id=tn.dispatch_document_id AND ts.connection_id=o.connection_id AND ts.company_id=o.company_id AND ts.dataset_id=o.dataset_id AND ts.validation_state='verified' AND ts.deleted_at IS NULL
    WHERE tn.package_id=pkg.id AND tn.connection_id=o.connection_id AND tn.company_id=o.company_id AND tn.dataset_id=o.dataset_id
    AND EXISTS (SELECT 1 FROM hz_fop_document_relations r WHERE r.from_document_id=o.document_id AND r.to_document_id=tn.dispatch_document_id AND r.connection_id=o.connection_id AND r.company_id=o.company_id AND r.dataset_id=o.dataset_id AND r.relation_type='dispatch' AND r.resolution_state='resolved' AND r.removed_at IS NULL)
    AND tn.provider_id=pkg.provider_id AND tn.shopify_selected IS TRUE AND tn.removed_at IS NULL AND tn.tracking_type IN ('full','first_mile','last_mile') HAVING count(*)=1) tr ON TRUE
  WHERE pkg.order_document_id=o.document_id AND pkg.connection_id=o.connection_id AND pkg.company_id=o.company_id AND pkg.dataset_id=o.dataset_id AND pkg.expected_active IS TRUE AND pkg.removed_at IS NULL)`

/** Dispatch workbench follows the actual dispatch channel, even after a route change. */
function dispatchLogisticsSql(approvedOnly: boolean): string { return `(SELECT jsonb_agg(jsonb_build_object('channelName',ch.name,'channelCode',ch.code,'trackingNumbers',COALESCE(tr.numbers,'[]'::jsonb)) ORDER BY ds.document_number, d.document_id)
 FROM hz_fop_dispatches d JOIN hz_fop_source_documents ds ON ds.id=d.document_id AND ds.connection_id=o.connection_id AND ds.company_id=o.company_id AND ds.dataset_id=o.dataset_id AND ds.validation_state='verified' AND ds.deleted_at IS NULL
 LEFT JOIN hz_fop_reference_items ch ON ch.connection_id=o.connection_id AND ch.company_id=o.company_id AND ch.resource_type='actual_channel' AND ch.source_id=d.actual_channel_id AND ch.deleted_at IS NULL
 LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('type',tn.tracking_type,'number',tn.number) ORDER BY tn.tracking_type,tn.id) AS numbers FROM hz_fop_tracking_numbers tn WHERE tn.dispatch_document_id=d.document_id AND tn.connection_id=o.connection_id AND tn.company_id=o.company_id AND tn.dataset_id=o.dataset_id AND tn.removed_at IS NULL AND tn.tracking_type IN ('full','last_mile')) tr ON TRUE
 WHERE ${approvedOnly ? "ds.raw_bill_status='C' AND" : ''} d.company_id=o.company_id AND d.dataset_id=o.dataset_id AND EXISTS(SELECT 1 FROM hz_fop_document_relations r WHERE r.from_document_id=o.document_id AND r.to_document_id=d.document_id AND r.connection_id=o.connection_id AND r.company_id=o.company_id AND r.dataset_id=o.dataset_id AND r.relation_type='dispatch' AND r.resolution_state='resolved' AND r.removed_at IS NULL))` }
export const localDispatchLogisticsSql = dispatchLogisticsSql(false)
/** Warehouse lists retain fulfillment rows; only currently approved, linked dispatch packages supply logistics. */
export const localWarehouseLogisticsSql = dispatchLogisticsSql(true)

/** One scoped definition supplies filters, display and delivery state; EXISTS avoids duplicate line relations. */
export const localValidDispatchFromSql = `FROM hz_fop_dispatches d
 JOIN hz_fop_source_documents ds ON ds.id=d.document_id AND ds.connection_id=o.connection_id AND ds.company_id=o.company_id AND ds.dataset_id=o.dataset_id AND ds.entity_code='hzkj_deliver_bill' AND ds.validation_state='verified' AND ds.deleted_at IS NULL
 WHERE d.company_id=o.company_id AND d.dataset_id=o.dataset_id AND EXISTS (
 SELECT 1 FROM hz_fop_document_relations r WHERE r.from_document_id=o.document_id AND r.to_document_id=d.document_id AND r.connection_id=o.connection_id AND r.company_id=o.company_id AND r.dataset_id=o.dataset_id AND r.relation_type='dispatch' AND r.resolution_state='resolved' AND r.removed_at IS NULL)`

/** A live unresolved/unverified target is missing proof, rather than proof of no dispatch. Tombstones are excluded. */
const localDispatchIncompleteSql = `EXISTS (SELECT 1 FROM hz_fop_document_relations r
 LEFT JOIN hz_fop_source_documents ds ON ds.id=r.to_document_id AND ds.connection_id=o.connection_id AND ds.company_id=o.company_id AND ds.dataset_id=o.dataset_id
 LEFT JOIN hz_fop_dispatches d ON d.document_id=ds.id AND d.company_id=o.company_id AND d.dataset_id=o.dataset_id
 WHERE r.from_document_id=o.document_id AND r.connection_id=o.connection_id AND r.company_id=o.company_id AND r.dataset_id=o.dataset_id AND r.relation_type='dispatch' AND r.removed_at IS NULL
 AND ds.deleted_at IS NULL AND (r.resolution_state<>'resolved' OR ds.id IS NULL OR ds.validation_state<>'verified' OR ds.entity_code<>'hzkj_deliver_bill' OR d.document_id IS NULL))`

export const localDispatchDocumentsSql = `(SELECT jsonb_agg(jsonb_build_object('id',ds.source_id,'number',ds.document_number,'deliveryStatus',d.raw_delivery_status,'status',CASE ds.raw_bill_status WHEN 'C' THEN 'approved' WHEN 'B' THEN 'submitted' WHEN 'A' THEN 'draft' ELSE 'unknown' END) ORDER BY ds.document_number,d.document_id) ${localValidDispatchFromSql})`

// Purchase1688PushValidationService checks any header hzkj_logistics_orderno (full/QC),
// independently of approval or tail tracking. Verified dispatch snapshots must contain the
// complete trackingNumbers array, so absent active full numbers mean pending_logistics.
export const localDispatchStateJoin = `LEFT JOIN LATERAL (SELECT CASE WHEN count(*)=0 THEN 'dispatch_missing'
 WHEN bool_or(d.raw_delivery_status IS NULL OR d.raw_delivery_status NOT IN ('PENDING','TRACKING_OBTAINED','FULFILLED','UPDATING','CANCELLED')) THEN 'unknown'
 WHEN bool_and(d.raw_delivery_status='FULFILLED') THEN 'dispatch_synced'
 WHEN bool_or(d.raw_delivery_status='UPDATING') THEN 'dispatch_updating'
 WHEN bool_or(d.raw_delivery_status='CANCELLED') THEN 'dispatch_cancelled'
 WHEN bool_or(d.raw_delivery_status='PENDING') THEN 'dispatch_pending' ELSE 'dispatch_tracking' END AS task_state,
 CASE WHEN count(*)>0 AND bool_and(COALESCE(ds.raw_bill_status='C',false)) THEN 'dispatch_complete' ELSE 'dispatch_incomplete' END AS completion_state,
 CASE WHEN count(*)=0 THEN 'pending_dispatch' WHEN bool_or(EXISTS (SELECT 1 FROM hz_fop_tracking_numbers tn WHERE tn.dispatch_document_id=d.document_id AND tn.connection_id=o.connection_id AND tn.company_id=o.company_id AND tn.dataset_id=o.dataset_id AND tn.removed_at IS NULL AND tn.tracking_type='full' AND NULLIF(btrim(tn.number),'') IS NOT NULL)) THEN 'satisfied' ELSE 'pending_logistics' END AS logistics_gate,
 ${localDispatchIncompleteSql} AS incomplete, max(ds.source_audited_at) AS audited_at
 ${localValidDispatchFromSql}) delivery ON TRUE`

/** Unknown payment times never become order/creation timestamps. */
export const localProcurementPaidAtSql = `(CASE WHEN o.purchase_coverage_state='not_required' THEN
 (SELECT min(s.procurement_paid_at) FROM hz_fop_stock_orders s JOIN hz_fop_source_documents sd ON sd.id=s.document_id AND sd.company_id=o.company_id AND sd.dataset_id=o.dataset_id AND sd.validation_state='verified' AND sd.deleted_at IS NULL
 WHERE s.company_id=o.company_id AND s.dataset_id=o.dataset_id AND EXISTS(SELECT 1 FROM hz_fop_stock_consumptions sc WHERE sc.stock_document_id=s.document_id AND sc.order_document_id=o.document_id AND sc.company_id=o.company_id AND sc.dataset_id=o.dataset_id AND sc.removed_at IS NULL AND sc.quantity>0) HAVING count(*)=count(s.procurement_paid_at))
 ELSE (SELECT min(p.paid_at) FROM hz_fop_purchase_orders p JOIN hz_fop_source_documents pd ON pd.id=p.document_id AND pd.company_id=o.company_id AND pd.dataset_id=o.dataset_id AND pd.validation_state='verified' AND pd.deleted_at IS NULL
 WHERE p.company_id=o.company_id AND p.dataset_id=o.dataset_id AND EXISTS(SELECT 1 FROM hz_fop_workbench_purchase_allocations pa WHERE pa.purchase_document_id=p.document_id AND pa.order_document_id=o.document_id AND pa.company_id=o.company_id AND pa.dataset_id=o.dataset_id AND pa.projection_revision=o.projection_revision AND pa.allocated_requirement_quantity>0) HAVING count(*)=count(p.paid_at)) END)`

/** Review confirms channel choices before dispatch preparation; never returns tracking. */
export const localReviewLogisticsSql = `(SELECT jsonb_agg(jsonb_build_object('channelName',ch.name,'channelCode',ch.code) ORDER BY pkg.source_package_key)
 FROM hz_fop_order_packages pkg LEFT JOIN hz_fop_reference_items ch ON ch.connection_id=o.connection_id AND ch.company_id=o.company_id AND ch.resource_type='actual_channel' AND ch.source_id=pkg.channel_id AND ch.deleted_at IS NULL
 WHERE pkg.order_document_id=o.document_id AND pkg.connection_id=o.connection_id AND pkg.company_id=o.company_id AND pkg.dataset_id=o.dataset_id AND pkg.expected_active IS TRUE AND pkg.removed_at IS NULL)`

/** Approval facts come from valid allocation documents, not the workbench completion timestamp. */
export const localAllocationApprovalJoin = `LEFT JOIN LATERAL (
 SELECT CASE WHEN count(*)>0 AND bool_and(s.raw_bill_status='C') AND count(s.raw_bill_status)=count(*) THEN 'approved' ELSE 'unknown' END AS review_state,
 CASE WHEN count(*)=count(s.source_audited_at) THEN max(s.source_audited_at) END AS audited_at
 FROM hz_fop_allocations a JOIN hz_fop_source_documents s ON s.id=a.document_id AND s.connection_id=o.connection_id AND s.company_id=o.company_id AND s.dataset_id=o.dataset_id AND s.deleted_at IS NULL AND s.validation_state='verified'
 WHERE a.company_id=o.company_id AND a.dataset_id=o.dataset_id AND EXISTS (SELECT 1 FROM hz_fop_document_relations r WHERE r.from_document_id=o.document_id AND r.to_document_id=a.document_id AND r.connection_id=o.connection_id AND r.company_id=o.company_id AND r.dataset_id=o.dataset_id AND r.relation_type='allocation' AND r.resolution_state='resolved' AND r.removed_at IS NULL)
) allocation_approval ON TRUE`

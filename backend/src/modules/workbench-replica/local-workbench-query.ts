import { localDispatchStateJoin, localAllocationApprovalJoin } from './local-workbench-logistics'
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import { canFilterTaskStatus } from '../fop-data/workbench-status'
import { fulfillmentSortDirection } from '../fop-data/fop-order-sort'

export interface LocalReadScope { connectionId: string; companyId: string; datasetId: string; employeeIds: readonly string[] | null }
export interface LocalOrderFilters {
  purchaseGrouping?: boolean
  returnStatus?: string
  queue: string; completed?: boolean; search?: string; orderNumber?: string; warehouseCode?: string; shippingCountryCode?: string
  procurementStage?: string; taskStatus?: string; warehouseStage?: string; timeRange?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; paidAtOrder?: 'asc' | 'desc'
  searchOwnerIds?: string[]; rmaType?: string; rmaFlowStatus?: string; stockType?: string; purchaseStatus?: string; orderStatus?: string; lifecycle?: string; page?: number; pageSize?: number
}
export function localQueueCode(queue: string, completed = false): string {
  if (!completed) return queue
  const codes: Record<string, string> = { review: 'sales_completed', dispatch: 'dispatch_completed', procurement: 'procurement_completed', allocation_review: 'allocation_completed', shipping: 'warehouse_completed' }
  if (!codes[queue]) throw new BadRequestException('This queue has no completion list')
  return codes[queue]
}
/** All interpolated fragments are server constants; values supplied by a browser remain bound parameters. */
export function localResourceGrantSql(resource: string, target: string, company = 'o.company_id', connection = 'o.connection_id'): string {
  if (!['orders', 'stock_orders', 'purchases', 'rma', 'purchase_returns', 'stock_inventory', 'allocation_inventory', 'contacts', 'receipt_notices'].includes(resource)) throw new Error('Invalid local resource')
  const scope = `g.connection_id = ${connection} AND g.company_id = ${company} AND g.resource_type = '${resource}'`
  const valid = `g.verified_at <= CURRENT_TIMESTAMP AND g.verified_at >= CURRENT_TIMESTAMP - INTERVAL '60 seconds' AND g.source_as_of <= CURRENT_TIMESTAMP AND g.source_as_of >= CURRENT_TIMESTAMP - INTERVAL '60 seconds' AND g.expires_at > CURRENT_TIMESTAMP`
  return `(EXISTS (SELECT 1 FROM hz_fop_resource_grants g WHERE ${scope} AND g.target_key IN ('*', ${target}) AND g.decision = 'allow' AND ${valid})
    AND NOT EXISTS (SELECT 1 FROM hz_fop_resource_grants g WHERE ${scope} AND g.target_key IN ('*', ${target}) AND g.decision = 'deny')
    AND NOT EXISTS (SELECT 1 FROM hz_fop_resource_grants g WHERE ${scope} AND g.target_key = ${target} AND NOT COALESCE((g.decision = 'allow' AND ${valid}), FALSE)))`
}
export function buildLocalOrderQuery(scopes: LocalReadScope[], query: LocalOrderFilters, stock = false) {
  const values: unknown[] = [JSON.stringify(scopes.map(s => ({ connection_id: s.connectionId, company_id: s.companyId, dataset_id: s.datasetId, employee_ids: s.employeeIds })))]
  const bind = (value: unknown) => { values.push(value); return `$${values.length}` }
  const queue = stock ? query.queue === 'procurement' ? 'stock_procurement' : 'stock' : localQueueCode(query.queue, query.completed)
  const queueParam = bind(queue)
  const resource = stock ? 'stock_orders' : 'orders'
  let from = `FROM jsonb_to_recordset($1::jsonb) AS scope(connection_id uuid, company_id uuid, dataset_id uuid, employee_ids text[])
    JOIN hz_fop_workbench_orders o ON o.connection_id = scope.connection_id AND o.company_id = scope.company_id AND o.dataset_id = scope.dataset_id
    JOIN hz_fop_source_documents sd ON sd.id = o.document_id AND sd.company_id = o.company_id AND sd.dataset_id = o.dataset_id
    LEFT JOIN hz_fop_workbench_memberships m ON m.order_document_id = o.document_id AND m.company_id = o.company_id AND m.dataset_id = o.dataset_id AND m.queue_code = ${queueParam}`
  if(!stock && ['shipping','procurement','procurement_shipping'].includes(query.queue)) from += ` LEFT JOIN hz_fop_fulfillment_orders native ON native.document_id=o.document_id AND native.company_id=o.company_id AND native.dataset_id=o.dataset_id`
  if(query.queue==='allocation_review' && query.completed) from += ` ${localAllocationApprovalJoin}`
  if(!stock && ['dispatch','procurement','allocation','allocation_review'].includes(query.queue)) from += ` ${localDispatchStateJoin}`
  const conditions = ["sd.deleted_at IS NULL", `o.order_kind = '${stock ? 'stock' : 'fulfillment'}'`,
    '(scope.employee_ids IS NULL OR o.owner_employee_id = ANY(scope.employee_ids))', localResourceGrantSql(resource, 'sd.source_id')]
  if(!stock && query.queue==='review' && query.completed) conditions.push("o.order_review_state='approved'")
  if(query.queue==='allocation_review' && query.completed) conditions.push("allocation_approval.review_state='approved'")
  if(query.queue==='dispatch') conditions.push(query.completed ? "delivery.task_state='dispatch_synced'" : "delivery.task_state IN ('dispatch_missing','dispatch_pending','dispatch_tracking','dispatch_updating','dispatch_cancelled')")
  if(!stock && (query.queue==='procurement' || query.queue==='procurement_shipping')) {
    conditions.push("o.purchase_coverage_state IS DISTINCT FROM 'not_required'")

  }
  if (query.orderNumber?.trim()) conditions.push(`o.order_number ILIKE ${bind('%' + escapeLike(query.orderNumber.trim()) + '%')} ESCAPE '\\'`)
  if (query.warehouseCode) conditions.push(`EXISTS (SELECT 1 FROM hz_fop_reference_items wr WHERE wr.company_id = o.company_id AND wr.connection_id = o.connection_id AND wr.resource_type = 'warehouse' AND wr.source_id = o.warehouse_id AND wr.code = ${bind(query.warehouseCode)} AND wr.deleted_at IS NULL)`)
  if (query.shippingCountryCode) conditions.push(`o.country_code = ${bind(query.shippingCountryCode.toUpperCase())}`)
  if (query.search?.trim()) {
    const param = bind('%' + escapeLike(query.search.trim().toLowerCase()) + '%')
    const extraSearch:string[]=[]
    if(query.searchOwnerIds?.length)extraSearch.push(`o.owner_employee_id=ANY(${bind(query.searchOwnerIds)}::text[])`)
    if(query.purchaseGrouping)extraSearch.push(`EXISTS (SELECT 1 FROM hz_fop_workbench_purchase_allocations search_allocation
      JOIN hz_fop_source_documents purchase_search ON purchase_search.id=search_allocation.purchase_document_id AND purchase_search.company_id=o.company_id AND purchase_search.dataset_id=o.dataset_id
      WHERE search_allocation.order_document_id=o.document_id AND search_allocation.company_id=o.company_id AND search_allocation.dataset_id=o.dataset_id
        AND purchase_search.deleted_at IS NULL AND purchase_search.validation_state='verified' AND ${localResourceGrantSql('purchases','purchase_search.source_id')}
        AND (lower(purchase_search.document_number) LIKE ${param} ESCAPE '\\' OR EXISTS (SELECT 1 FROM hz_fop_platform_orders platform_search
          WHERE platform_search.purchase_document_id=purchase_search.id AND platform_search.company_id=o.company_id AND platform_search.dataset_id=o.dataset_id AND platform_search.removed_at IS NULL
            AND lower(platform_search.external_order_id) LIKE ${param} ESCAPE '\\')))`)
    if(query.queue==='rma')extraSearch.push(`lower(concat_ws(' ',rm.rma_number,rm.rma_reason,rm.rma_flow_status)) LIKE ${param} ESCAPE '\\'`)
    if(query.queue==='purchase_returns')extraSearch.push(`EXISTS (SELECT 1 FROM hz_fop_workbench_orders return_source ${localReturnJoins} WHERE return_source.document_id=o.document_id AND return_source.company_id=o.company_id AND return_source.dataset_id=o.dataset_id AND ${localReturnAuthorized} AND lower(concat_ws(' ',return_sd.document_number,purchase_sd.document_number,pr.reason)) LIKE ${param} ESCAPE '\\')`)
    conditions.push(`(lower(concat_ws(' ', o.order_number, o.shopify_order_number, o.customer_name, o.store_name)) LIKE ${param} ESCAPE '\\' OR EXISTS (SELECT 1 FROM hz_fop_workbench_order_lines search_line WHERE search_line.order_document_id = o.document_id AND search_line.company_id = o.company_id AND search_line.dataset_id = o.dataset_id AND search_line.projection_revision = o.projection_revision AND lower(concat_ws(' ', search_line.sku_code, search_line.product_name)) LIKE ${param} ESCAPE '\\') ${extraSearch.length ? ' OR '+extraSearch.join(' OR ') : ''})`)
  }
  const range = query.completed ? query.timeRange ?? '1w' : query.timeRange
  if (range && range !== 'all') {
    if (!['1w', '1m', '3m'].includes(range)) throw new BadRequestException('Invalid payment range')
    conditions.push(`o.customer_paid_at >= ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai' - INTERVAL '${range === '1w' ? '7 days' : range === '1m' ? '1 month' : '3 months'}') AT TIME ZONE 'Asia/Shanghai') AND o.customer_paid_at <= CURRENT_TIMESTAMP`)
  }
  if (query.procurementStage) conditions.push(`o.procurement_stage = ${bind(query.procurementStage)}`)
  if (stock) {
    if (query.stockType) conditions.push(`o.stock_type = ${bind(query.stockType)}`)
    if (query.lifecycle) conditions.push(`o.stock_lifecycle = ${bind(query.lifecycle)}`)
    if (query.purchaseStatus) conditions.push(`${stockPurchaseSql} = ${bind(query.purchaseStatus)}`)
    if (query.orderStatus) conditions.push(`${stockOrderStatusSql} = ${bind(query.orderStatus)}`)
  } else if (query.taskStatus) {
    if (!canFilterTaskStatus(query.queue, query.taskStatus)) throw new BadRequestException('Invalid task status')
    // Linked predicates are applied only after the completeness candidate set is captured.
    const linkedStatus = ['dispatch_preparation','dispatch_complete','dispatch_incomplete'].includes(query.taskStatus) || query.queue==='procurement' && query.taskStatus==='alibaba_pending'
    if (!linkedStatus && query.queue === 'shipping') conditions.push(query.taskStatus === 'outbound_pending' ? "native.raw_delivery_status IN ('0','1') AND o.intercept_status IS DISTINCT FROM 'intercepted'" : `o.intercept_status = ${bind(query.taskStatus === 'shipment_intercepted' ? 'intercepted' : 'released')}`)
    else if (!linkedStatus && query.queue === 'exceptions') conditions.push(`EXISTS (SELECT 1 FROM hz_fop_exception_marks e WHERE e.order_document_id = o.document_id AND e.company_id = o.company_id AND e.dataset_id = o.dataset_id AND e.active IS TRUE AND e.type = ${bind(query.taskStatus)})`)
    else if (!linkedStatus) conditions.push(`${query.queue === 'dispatch' ? 'delivery.task_state' : 'o.procurement_stage'} = ${bind(query.taskStatus)}`)
  }
  if (query.warehouseStage && query.warehouseStage !== 'all') conditions.push(query.warehouseStage === 'pending_review' ? "o.allocation_review_state = 'pending'" : "o.allocation_review_state = 'approved' AND native.raw_delivery_status IN ('0','1')")
  const completenessWhere = conditions.join(' AND ')
  const completenessValues = [...values]
  if (!stock && query.taskStatus) {
    if (query.taskStatus==='dispatch_preparation') conditions.push("o.procurement_stage='alibaba_pending' AND delivery.logistics_gate IN ('pending_dispatch','pending_logistics')")
    else if (['dispatch_complete','dispatch_incomplete'].includes(query.taskStatus)) conditions.push(`delivery.completion_state=${bind(query.taskStatus)}`)
    else if (query.queue==='procurement' && query.taskStatus==='alibaba_pending') conditions.push("o.procurement_stage='alibaba_pending' AND delivery.logistics_gate='satisfied'")
  }
  if(!stock && !query.purchaseGrouping && ['procurement','procurement_shipping'].includes(query.queue)) conditions.push(query.completed ? "native.raw_purchase_status IN ('3','4')" : "native.raw_purchase_status IN ('0','1','2')")
  if(!stock && query.queue==='shipping') conditions.push(query.completed ? "native.raw_delivery_status='2'" : "native.raw_delivery_status IN ('0','1')")
  if (query.queue === 'purchase_returns') conditions.push(`EXISTS (SELECT 1 FROM hz_fop_workbench_orders return_source ${localReturnJoins} WHERE return_source.document_id=o.document_id AND return_source.company_id=o.company_id AND return_source.dataset_id=o.dataset_id AND ${localReturnAuthorized} ${query.returnStatus?`AND pr.raw_physical_status=${bind(query.returnStatus)}`:''})`)
  if (query.queue === 'rma') {
    // Join each authorized RMA before LIMIT/count, never expand a paged fulfillment order afterwards.
    from += ` JOIN LATERAL (SELECT DISTINCT rma.document_id AS rma_document_id,rma_sd.document_number AS rma_number,rma.reason AS rma_reason,rma.raw_flow_status AS rma_flow_status,rma.after_sale_type,rma.is_open
      FROM hz_fop_document_relations relation JOIN hz_fop_rma_orders rma ON rma.document_id=relation.to_document_id AND rma.company_id=o.company_id AND rma.dataset_id=o.dataset_id
      JOIN hz_fop_source_documents rma_sd ON rma_sd.id=rma.document_id AND rma_sd.company_id=o.company_id AND rma_sd.dataset_id=o.dataset_id
      WHERE relation.from_document_id=o.document_id AND relation.company_id=o.company_id AND relation.dataset_id=o.dataset_id AND relation.relation_type='rma' AND relation.resolution_state='resolved' AND relation.removed_at IS NULL
        AND rma_sd.deleted_at IS NULL AND rma_sd.validation_state='verified' AND rma.after_sale_type IN ('refund','return_refund','reshipment') AND ${localResourceGrantSql('rma','rma_sd.source_id')}) rm ON TRUE`
    if (query.rmaType) conditions.push(`rm.after_sale_type=${bind(query.rmaType)}`)
    if (query.rmaFlowStatus !== 'all') conditions.push(query.rmaFlowStatus === 'closed' ? 'rm.is_open IS FALSE' : 'rm.is_open IS TRUE')
  }
  let sort = 'o.customer_paid_at', direction = fulfillmentSortDirection(query)
  if (stock) {
    sort = query.sortBy === 'paidAt' ? 'o.customer_paid_at' : query.sortBy === 'orderStatus' ? `array_position(ARRAY['unpaid','paid','approved'], ${stockOrderStatusSql})` : query.sortBy === 'purchaseStatus' ? `array_position(ARRAY['unpurchased','partial','in_progress','purchased','shipped','received'], ${stockPurchaseSql})` : 'o.business_created_at'
    direction = query.sortOrder ?? (query.sortBy?.endsWith('Status') ? 'asc' : 'desc')
  } else if (query.sortBy) {
    const fields: Record<string, string> = { completedAt: query.queue === 'review' ? 'sd.source_audited_at' : query.queue === 'dispatch' ? 'delivery.audited_at' : query.queue === 'allocation_review' && query.completed ? 'allocation_approval.audited_at' : 'm.phase_completed_at', paidAt: 'o.customer_paid_at', consumerPaidAt: 'o.customer_paid_at', reviewedAt: 'sd.source_audited_at', dispatchDocumentStatus: `array_position(ARRAY['dispatch_missing','dispatch_pending','dispatch_tracking','dispatch_updating','dispatch_cancelled','dispatch_synced'],${query.queue==='dispatch'?'delivery.task_state':'o.dispatch_task_state'})`, stockReadiness: "array_position(ARRAY['incomplete','ready'],o.stock_readiness_state)", allocationReviewStatus: "array_position(ARRAY['pending','approved'],o.allocation_review_state)", outboundStatus: query.queue==='shipping' ? "array_position(ARRAY['0','1','2'],native.raw_delivery_status)" : "array_position(ARRAY['pending','completed'],o.outbound_state)" }
    if (!fields[query.sortBy]) throw unconfigured('This sort needs a local linked document projection')
    sort = fields[query.sortBy]
  }
  return { from, completenessWhere, completenessValues, where: conditions.join(' AND '), values, queue, orderBy: `${sort} ${direction.toUpperCase()} NULLS LAST, o.customer_paid_at DESC NULLS LAST, o.document_id ASC${query.queue === 'rma' ? ", rm.rma_document_id ASC" : ""}` }
}
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')
export const stockOrderStatusSql = `(CASE WHEN o.customer_payment_state = 'unpaid' AND o.order_review_state <> 'approved' THEN 'unpaid' WHEN o.customer_payment_state = 'paid' AND o.order_review_state = 'pending' THEN 'paid' WHEN o.customer_payment_state = 'paid' AND o.order_review_state = 'approved' THEN 'approved' END)`
export const stockPurchaseSql = `(CASE WHEN o.stock_lifecycle = 'received' THEN 'received' WHEN o.supplier_shipment_state = 'shipped' THEN 'shipped' WHEN o.procurement_stage = 'supplier_pending' THEN 'purchased' WHEN o.procurement_stage = 'supplier_partial' THEN 'partial' WHEN o.purchase_coverage_state = 'not_ordered' THEN 'unpurchased' WHEN o.purchase_coverage_state = 'partial' THEN 'partial' ELSE 'unknown' END)`
export function unconfigured(message: string): ServiceUnavailableException { return new ServiceUnavailableException({ code: 'workbench_replica_feature_not_configured', message }) }

/** Only explicit physical-return kinds are eligible. Platform refund success does not prove physical completion. */
export const localReturnJoins = `JOIN hz_fop_document_relations return_relation ON return_relation.from_document_id=o.document_id AND return_relation.company_id=o.company_id AND return_relation.dataset_id=o.dataset_id AND return_relation.relation_type='purchase_return' AND return_relation.resolution_state='resolved' AND return_relation.removed_at IS NULL
  JOIN hz_fop_purchase_returns pr ON pr.document_id=return_relation.to_document_id AND pr.company_id=o.company_id AND pr.dataset_id=o.dataset_id AND pr.return_kind IN ('physical_return','RETURN_REFUND')
  JOIN hz_fop_source_documents return_sd ON return_sd.id=pr.document_id AND return_sd.company_id=o.company_id AND return_sd.dataset_id=o.dataset_id AND return_sd.deleted_at IS NULL AND return_sd.validation_state='verified'
  JOIN hz_fop_source_documents purchase_sd ON purchase_sd.source_id=pr.purchase_source_id AND purchase_sd.entity_code='hzkj_purorderbill' AND purchase_sd.company_id=o.company_id AND purchase_sd.dataset_id=o.dataset_id AND purchase_sd.deleted_at IS NULL AND purchase_sd.validation_state='verified'
  LEFT JOIN hz_fop_source_lines return_line ON return_line.id=return_relation.to_line_id AND return_line.document_id=pr.document_id AND return_line.company_id=o.company_id AND return_line.dataset_id=o.dataset_id
  LEFT JOIN hz_fop_return_line_details return_detail ON return_detail.line_id=return_line.id AND return_detail.company_id=o.company_id AND return_detail.dataset_id=o.dataset_id`
export const localReturnAuthorized = `${localResourceGrantSql('purchase_returns','return_sd.source_id')} AND ${localResourceGrantSql('purchases','purchase_sd.source_id')}`
export const localReturnAmbiguous = `(return_relation.relation_grain<>'line_line' OR return_line.id IS NULL OR return_detail.requested_quantity IS NULL OR return_detail.returned_quantity IS NULL OR
  (SELECT count(*) FROM hz_fop_document_relations other_return WHERE other_return.to_line_id=return_line.id AND other_return.to_document_id=pr.document_id AND other_return.company_id=o.company_id AND other_return.dataset_id=o.dataset_id AND other_return.relation_type='purchase_return' AND other_return.resolution_state='resolved' AND other_return.removed_at IS NULL) <> 1)`

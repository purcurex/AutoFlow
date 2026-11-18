import { outboundUnverifiedSqlV5 } from './physical-business-sql-v5'
/** Classify existing local diagnostic facts without changing source data or queue membership. */
export function collectedOutboundUnverifiedSql(alias = 'hz_fop_collected_orders'): string {
  return outboundUnverifiedSqlV5(alias)
}

export function collectedAllocationErrorSql(alias = 'hz_fop_collected_orders'): string {
  return `EXISTS(SELECT 1 FROM hz_fop_collected_entities a WHERE a.batch_id=${alias}.batch_id AND a.entity_type='allocation' AND a.display->>'sourceOrderId'=${alias}.source_id AND a.display->>'rawAllocationStatus'='error')`
}

/** Only source-owned explicit exceptions persist; locally derived marks are recomputed. */
function explicitTypeSql(alias:string):string {
 const e=`${alias}.display->'exception'`
 return `(CASE WHEN ${e}->>'code' IN ('paid_date_missing','paid_date_invalid','fulfillment_cancelled')
   OR (${e}->>'type'='dispatch_exception' AND ${e}->>'reason' IN ('Shopify跟踪号同步失败，请重新同步；成功回写后进入已履约清单。','已取号订单缺少物流跟踪号','已履约订单缺少物流跟踪号'))
   OR (${e}->>'type'='outbound_exception' AND ${e}->>'reason'='部分出库无法核实')
   OR (${e}->>'type'='allocation_exception' AND ${e}->>'reason'='配货单报错')
   THEN NULL ELSE NULLIF(${e}->>'type','') END)`
}
export function collectedDiagnosticTypeSql(alias = 'hz_fop_collected_orders'): string {
 return `COALESCE(${explicitTypeSql(alias)}, CASE WHEN ${collectedOutboundUnverifiedSql(alias)} THEN 'outbound_exception' WHEN ${collectedAllocationErrorSql(alias)} THEN 'allocation_exception' END)`
}
export function collectedDiagnosticDisplaySql(alias = 'hz_fop_collected_orders'): string {
 const display=`${alias}.display`
 // Payment and dispatch are recalculated by withOrderBusinessStatus from the same source row.
 return `(CASE WHEN ${explicitTypeSql(alias)} IS NOT NULL THEN ${display}
   WHEN ${collectedOutboundUnverifiedSql(alias)} THEN ${display} || jsonb_build_object('exception',jsonb_build_object('type','outbound_exception','reason','部分出库无法核实','hours',NULL))
   WHEN ${collectedAllocationErrorSql(alias)} THEN ${display} || jsonb_build_object('exception',jsonb_build_object('type','allocation_exception','reason','配货单报错','hours',NULL))
   ELSE ${display} || jsonb_build_object('exception',NULL) END)`
}

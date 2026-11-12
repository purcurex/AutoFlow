import { ServiceUnavailableException } from '@nestjs/common'
import type { FopOrder, FopOrderItem } from '../fop-data/fop-data.types'
import type { FopStockOrder } from '../fop-data/fop-stock.types'
export type LocalRow = Record<string, any>
const time = (value: unknown): string | null => value instanceof Date ? value.toISOString() : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
export function localNumber(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '' || !['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', message: `Missing or invalid ${field}` })
  return Number(value)
}
function items(lines: LocalRow[]): FopOrderItem[] { return lines.map(line => ({ id: line.source_line_id ?? line.id, sku: line.sku_code ?? '', name: line.product_name ?? '', variant: line.variant ?? '', imageUrl: line.image_url ?? null, quantity: localNumber(line.quantity, 'line quantity') })) }
/** Unknown stages remain unknown in the response; type assertion only bridges the older public type's narrower enums. */
export function localOrder(row: LocalRow, lines: LocalRow[]): FopOrder {
  const paidAt = time(row.customer_paid_at)
  const packages: LocalRow[] = Array.isArray(row.logistics_packages) ? row.logistics_packages : []
  const carriers = [...new Set(packages.map(p => p.carrierName).filter(Boolean))]
  const logisticsChannels = [...new Map(packages.filter(p => p.channelName || p.channelCode).map(p => [JSON.stringify([p.channelName, p.channelCode]), { name: p.channelName ?? null, code: p.channelCode ?? null }])).values()]
  const tracking = packages.map(p => p.shopifyTracking?.number).filter(Boolean)
  return {
    id: row.source_id, orderNumber: row.order_number, shopifyOrderNumber: row.shopify_order_number ?? '', customerId: row.customer_id ?? undefined, customerName: row.customer_name ?? '', storeName: row.store_name ?? '',
    warehouseCode: row.warehouse_code ?? '', warehouse: row.warehouse_name ?? '', owner: row.owner_employee_id ? { id: row.owner_employee_id, name: row.owner_name ?? '' } : undefined, salesperson: row.owner_name ?? '',
    items: items(lines), amount: localNumber(row.total_amount, 'order amount'), currency: row.currency_code ?? 'XXX', amountBreakdown: { productAmount: row.product_amount == null ? null : localNumber(row.product_amount, 'product amount'), shippingFee: row.freight_amount == null ? null : localNumber(row.freight_amount, 'freight amount'), taxAmount: row.tax_amount == null ? null : localNumber(row.tax_amount, 'tax amount'), discountAmount: row.discount_amount == null ? null : localNumber(row.discount_amount, 'discount amount') },
    customLogisticsChannelName: row.custom_channel_name ?? null, procurementPaidAt: time(row.procurement_paid_at),
    paidAt, consumerPaidAt: paidAt, createdAt: time(row.business_created_at) ?? '', reviewedAt: time(row.source_audited_at), shippingCountryCode: row.country_code ?? null, shippingRecipient: row.recipient_snapshot ?? null,
    ...('source_purchase_status' in row ? {sourcePurchaseStatus: ['0','1','2','3','4'].includes(row.source_purchase_status) ? row.source_purchase_status : null, sourceOutboundStatus: ['0','1','2'].includes(row.source_outbound_status) ? row.source_outbound_status : null} : {}),
    paymentStatus: row.customer_payment_state ?? 'unknown', reviewStatus: row.order_review_state ?? 'unknown', procurementStatus: 'unknown', allocationStatus: 'unknown', dispatchStatus: 'unknown', shippingStatus: 'unknown',
    fulfillmentProgress: { allocationCreated: row.allocation_created ?? null, shopifySync: row.shopify_sync_state ?? 'unknown', supplierShipment: row.supplier_shipment_state ?? 'unknown', stockReadiness: row.stock_readiness_state ?? 'unknown', allocationReview: row.allocation_review_state ?? 'unknown', outbound: row.outbound_state ?? 'unknown' },
    procurementProgress: { logisticsGate: row.logistics_gate ?? 'unknown', purchaseApplication: row.purchase_application_state ?? 'unknown', purchaseOrder: row.purchase_coverage_state ?? 'unknown', alibabaOrder: row.platform_order_state ?? 'unknown', supplierPayment: row.supplier_payment_state ?? 'unknown' },
    dispatchTaskStatus: row.dispatch_task_state ?? 'unknown', shipmentInterceptStatus: ['intercepted', 'released'].includes(row.intercept_status) ? row.intercept_status : null,
    dispatchDocuments: row.dispatch_documents ?? null, allocationDocument: row.allocation_document ?? null, carrier: carriers.join(' / ') || null, logisticsChannels, logisticsInfo: packages.map(p => ({ carrierName: p.carrierName ?? null, channelName: p.channelName ?? null, channelCode: p.channelCode ?? null, shopifyTracking: p.shopifyTracking ?? null, trackingNumbers: p.trackingNumbers ?? undefined })), trackingNumber: tracking.length === 1 ? tracking[0] : null, cancelled: row.cancelled ?? null,
    exception: row.exception_type ? { type: row.exception_type, reason: row.exception_reason ?? null, hours: row.exception_occurred_at ? Math.max(0, (Date.now() - Date.parse(row.exception_occurred_at)) / 3600000) : null } : null,
    ...(row.queue_code === 'dispatch_completed' ? { dispatchApprovedAt: time(row.dispatch_audited_at) } : {}),
    ...(row.queue_code === 'procurement_completed' ? { procurementCompletedAt: time(row.phase_completed_at) } : {}),
    ...(row.queue_code === 'allocation_completed' ? { allocationApprovedAt: time(row.allocation_audited_at) } : {}),
    ...(row.queue_code === 'warehouse_completed' ? { outboundCompletedAt: time(row.phase_completed_at) } : {}),
  } as FopOrder
}
export function localStockOrder(row: LocalRow, lines: LocalRow[]): FopStockOrder {
  if (!['full_payment', 'deposit'].includes(row.stock_type)) throw new ServiceUnavailableException({ code: 'workbench_replica_incomplete', message: 'Missing stock type' })
  const order = localOrder(row, lines)
  return { id: order.id, stockNumber: order.orderNumber, stockType: row.stock_type, customerId: row.customer_id ?? '', customerCode: '', customerName: order.customerName, storeName: order.storeName, owner: order.owner ?? { id: '', name: '' }, department: { id: '', name: '' }, items: order.items, amount: order.amount, currency: order.currency, paidAt: order.paidAt, createdAt: time(row.business_created_at), paymentStatus: row.customer_payment_state ?? 'unknown', reviewStatus: row.order_review_state ?? 'unknown', orderStatus: row.stock_order_status ?? null, purchaseStatus: row.stock_purchase_status ?? 'unknown', warehouseCode: order.warehouseCode ?? '', warehouse: order.warehouse }
}

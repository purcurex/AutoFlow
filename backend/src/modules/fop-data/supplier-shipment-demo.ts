import type { FopOrderCandidate } from './fop-data.types'
import type { PurchaseObligation } from './procurement-groups.types'
import { businessDate } from './fop-business-time'
const HOUR = 3_600_000
const examples = [
  { hours: 12, partial: false, supplier: '杭州云帆' },
  { hours: 30, partial: false, supplier: '深圳星河' },
  { hours: 60, partial: false, supplier: '宁波远航' },
  { hours: 12, partial: true, supplier: '义乌晨曦' },
  { hours: 30, partial: true, supplier: '东莞优选' },
  { hours: 60, partial: true, supplier: '广州汇诚' },
] as const
/** Synthetic orders inherit genuine demo ownership/scope; the provider fixes anchor once per run. */
export function demoShipmentOrders(orders: readonly FopOrderCandidate[], anchor: number): FopOrderCandidate[] {
  const sources = orders.filter(o => o.salesDepartmentCode && !o.cancelled && o.paymentStatus === 'paid' && o.reviewStatus === 'approved' && o.items.length)
  if (!sources.length) return []
  return examples.map((example, index) => {
    const source = sources[index % sources.length]
    const paid = anchor - example.hours * HOUR
    const day = businessDate(new Date(paid)).replaceAll('-', '')
    return { ...source, id: `${source.id}:shipment-aging:${index}`, orderNumber: `TO${day.slice(2)}${900001 + index}`, shopifyOrderNumber: `#SHIP${900001 + index}`,
      items: [{ ...source.items[0], quantity: 4 }], amount: 40, amountBreakdown: { productAmount: 35, shippingFee: 5, taxAmount: 0, discountAmount: 0 },
      createdAt: new Date(paid - 3 * HOUR).toISOString(), consumerPaidAt: new Date(paid - 4 * HOUR).toISOString(),
      paidAt: new Date(paid - 2 * HOUR).toISOString(), reviewedAt: new Date(paid - HOUR).toISOString(), procurementPaidAt: new Date(paid).toISOString(),
      procurementProgress: { purchaseOrder: 'ordered', purchaseApplication: 'created', alibabaOrder: 'pushed', supplierPayment: 'paid', logisticsGate: 'satisfied' },
      fulfillmentProgress: { allocationCreated: false, shopifySync: 'pending', supplierShipment: example.partial ? 'partial' : 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' },
      procurementStatus: 'purchased', allocationStatus: 'not_ready', dispatchStatus: 'not_ready', shippingStatus: 'not_ready',
      allocationDocument: null, allocationReadyAt: null, dispatchDocuments: [], logisticsInfo: null, wmsCreatedAt: null, trackingNumber: null, exception: null,
    }
  })
}
/** Dedicated POs avoid merging distinct aging examples into the weekly demo batches. */
export function demoShipmentObligation(order: FopOrderCandidate): PurchaseObligation | undefined {
  const match = /:shipment-aging:([0-5])$/.exec(order.id)
  if (!match) return undefined
  const index = Number(match[1]), example = examples[index]
  const day = businessDate(order.procurementPaidAt!).replaceAll('-', '')
  const id = `${order.tenantId}:shipment-aging:${index}`
  return { purchase: { id, number: `CG${day}${900001 + index}`, supplier: { id: `demo-aging-supplier-${index}`, name: `${example.supplier}（发货演示）` },
    purchaseType: 'online', platform: '1688', platformOrderNumber: (5127800000000000000n + BigInt(day) * 1000000n + BigInt(900001 + index)).toString(),
    payment: 'paid', placement: 'placed', paidAt: order.procurementPaidAt!,
  }, lines: order.items.map((item, line) => ({ fulfillmentLineId: `${order.id}:line:${line}`, purchaseLineId: `${id}:${item.sku}`, sku: item.sku, quantity: item.quantity, shippedQuantity: example.partial ? item.quantity / 2 : 0 })) }
}

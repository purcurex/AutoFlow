import { canFilterProcurementStage, getProcurementStage } from './procurement-stage'
import type { FulfillmentProgress, ProcurementProgress } from './fop-data.types'

describe('procurement header stage classification', () => {
  const purchase: ProcurementProgress = { purchaseApplication: 'created', purchaseOrder: 'ordered', alibabaOrder: 'pushed', supplierPayment: 'paid', logisticsGate: 'satisfied' }
  it.each([
    [{ purchaseOrder: 'not_ordered', purchaseApplication: 'not_created', supplierPayment: 'not_required' }, 'pending', 'purchase_order_pending'],
    [{ purchaseOrder: 'not_ordered', supplierPayment: 'not_required' }, 'pending', 'purchase_order_pending'],
    [{ purchaseOrder: 'partial' }, 'pending', 'purchase_order_pending'],
    [{ alibabaOrder: 'not_pushed', supplierPayment: 'unpaid', logisticsGate: 'pending_logistics' }, 'pending', 'alibaba_pending'],
    [{ supplierPayment: 'unpaid' }, 'pending', 'payment_pending'],
    [{ supplierPayment: 'partial' }, 'pending', 'payment_pending'],
    [{ supplierPayment: 'refunded' }, 'shipped', 'refund_pending'],
    [{}, 'pending', 'supplier_pending'],
    [{}, 'partial', 'supplier_partial'],
    [{}, 'shipped', 'shipped'],
    [{ supplierPayment: 'unknown' }, 'pending', 'unknown'],
    [{ purchaseOrder: 'not_required' }, 'not_required', 'not_required'],
  ] as const)('uses actual progress %j / %s as %s', (changes, shipment, expected) => {
    expect(getProcurementStage({ ...purchase, ...changes }, shipment as FulfillmentProgress['supplierShipment'])).toBe(expected)
  })
  it('does not invent progress or accept a state belonging to another queue', () => {
    expect(getProcurementStage(undefined, 'pending')).toBe('unknown')
    expect(canFilterProcurementStage('procurement', 'payment_pending')).toBe(true)
    expect(canFilterProcurementStage('procurement_shipping', 'payment_pending')).toBe(false)
    expect(canFilterProcurementStage('procurement', ['payment_pending'])).toBe(false)
    expect(canFilterProcurementStage('review', 'payment_pending')).toBe(false)
  })
})

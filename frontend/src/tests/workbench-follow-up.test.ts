import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { matchesFopQueue, type FopOrder, type ProcurementProgress } from '@/api/fop-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import ProcurementStatus from '@/components/autoflow/ProcurementStatus.vue'

const order = (): FopOrder => ({ ...mockFopOrders[0]!, cancelled: false, paymentStatus: 'paid', reviewStatus: 'approved', trackingNumber: null, dispatchDocuments: [],
  procurementProgress: { purchaseOrder: 'not_ordered', supplierPayment: 'not_required' },
  fulfillmentProgress: { allocationCreated: true, shopifySync: 'pending', supplierShipment: 'pending', stockReadiness: 'incomplete', allocationReview: 'pending', outbound: 'pending' } })

describe('result-based workbench follow-up', () => {
  it('retains procurement preparation without logistics and follows allocation release through outbound', () => {
    const row = order()
    expect(matchesFopQueue(row, 'procurement')).toBe(true)
    expect(matchesFopQueue(row, 'allocation')).toBe(true)
    row.fulfillmentProgress.stockReadiness = 'ready'
    expect(matchesFopQueue(row, 'allocation_review')).toBe(true) // no dispatch document, still visible
    expect(matchesFopQueue(row, 'shipping')).toBe(false)
    row.fulfillmentProgress.stockReadiness = 'incomplete' // manual release
    expect(matchesFopQueue(row, 'allocation')).toBe(true)
    expect(matchesFopQueue(row, 'allocation_review')).toBe(false)
    row.fulfillmentProgress.stockReadiness = 'ready'
    row.fulfillmentProgress.allocationReview = 'approved'
    expect(matchesFopQueue(row, 'allocation_review')).toBe(false)
    expect(matchesFopQueue(row, 'shipping')).toBe(true)
    expect(matchesFopQueue(row, 'shipping', 'pending_review')).toBe(false)
    row.fulfillmentProgress.outbound = 'partial'
    expect(matchesFopQueue(row, 'shipping')).toBe(true)
    row.fulfillmentProgress.outbound = 'completed'
    expect(matchesFopQueue(row, 'shipping')).toBe(false)
    expect(matchesFopQueue(row, 'dispatch')).toBe(true) // outbound does not imply Shopify sync
  })

  it.each(['pending_dispatch', 'pending_logistics', 'satisfied', 'not_required', 'unknown'] as const)('keeps purchase preparation visible when the 1688 logistics gate is %s', logisticsGate => {
    const row = order()
    row.procurementProgress = { purchaseOrder: 'ordered', supplierPayment: 'unpaid', purchaseApplication: 'created', alibabaOrder: 'not_pushed', logisticsGate } as ProcurementProgress
    expect(matchesFopQueue(row, 'procurement')).toBe(true)
  })

  it('shows the 1688 waiting stage rather than falsely reporting supplier payment as the next step', () => {
    const wrapper = mount(ProcurementStatus, { props: { progress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid', purchaseApplication: 'created', alibabaOrder: 'not_pushed', logisticsGate: 'pending_logistics' } as ProcurementProgress, shipment: 'pending' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    expect(wrapper.get('.procurement-stage').text()).toBe('待制作发运单')
    expect(wrapper.text()).toContain('待制作发运单')
    expect(wrapper.find('.procurement-prerequisite').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each(['not_required', 'paid', 'unknown'] as const)('retains an outstanding 1688 push when current supplier payment is %s', supplierPayment => {
    const row = order()
    row.procurementProgress = { purchaseOrder: 'ordered', supplierPayment, alibabaOrder: 'not_pushed', logisticsGate: 'pending_logistics' }
    expect(matchesFopQueue(row, 'procurement')).toBe(true)
    expect(matchesFopQueue(row, 'procurement_shipping')).toBe(false)
  })
})

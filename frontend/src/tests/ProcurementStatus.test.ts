import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it } from 'vitest'
import ProcurementStatus from '@/components/autoflow/ProcurementStatus.vue'

describe('procurement workflow facts', () => {
  it('uses a gentle pending tone for dispatch collaboration instead of a danger alert', () => {
    const wrapper = mount(ProcurementStatus, { props: { progress: { purchaseOrder: 'ordered', supplierPayment: 'unpaid', alibabaOrder: 'not_pushed', logisticsGate: 'pending_dispatch' }, shipment: 'pending' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN' })] } })
    expect(wrapper.get('.procurement-stage').text()).toBe('待制作发运单')
    expect(wrapper.get('.procurement-stage').attributes('data-tone')).toBe('warning')
    wrapper.unmount()
  })
  it.each([
    ['not_ordered', 'not_required', 'pending', '待建采购订单'],
    ['partial', 'paid', 'partial', '待建采购订单'],
    ['ordered', 'unpaid', 'pending', '待支付采购款'],
    ['ordered', 'partial', 'partial', '待支付采购款'],
    ['ordered', 'paid', 'pending', '供应商待发货'],
    ['ordered', 'paid', 'partial', '供应商部分发货'],
    ['ordered', 'unknown', 'partial', '待确认'],
    ['unknown', 'paid', 'pending', '待确认'],
    ['cancelled', 'unpaid', 'pending', '采购单已取消'],
    ['ordered', 'refunded', 'pending', '采购退款待跟进'],
  ] as const)('%s / %s / %s uses the outstanding stage', (purchaseOrder, supplierPayment, shipment, expected) => {
    const wrapper = mount(ProcurementStatus, { props: { progress: { purchaseOrder, supplierPayment }, shipment }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN' })] } })
    expect(wrapper.get('.procurement-stage').text()).toBe(expected)
    expect(wrapper.findAll('.procurement-fact')).toHaveLength(0)
    wrapper.unmount()
  })
  it('does not assume a purchase was placed or paid when procurement facts are missing', () => {
    const wrapper = mount(ProcurementStatus, { props: { shipment: 'pending' }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN' })] } })
    expect(wrapper.get('.procurement-stage').text()).toBe('待确认')
    expect(wrapper.text()).not.toContain('采购款已付')
    wrapper.unmount()
  })
})

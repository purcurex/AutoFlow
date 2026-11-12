import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import * as currency from '@/utils/currency'
import * as orders from '@/api/fop-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import OrderAmountBreakdown from '@/components/ui/OrderAmountBreakdown.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
const global = { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] }
const availability = { mode: 'collected' as const, complete: false as const, missingFields: ['amount', 'currency', 'quantity'] }
const replica = { readMode: 'local' as const, datasetId: 'batch-real', revision: '1', sourceSyncedAt: '2026-11-12T01:00:00Z', dataMode: 'collected' as const, complete: false as const }
const order = { ...mockFopOrders[0]!, amount: null, currency: null, items: [{ ...mockFopOrders[0]!.items[0]!, quantity: null }], dataQuality: { mode: 'collected' as const, readOnly: true as const, missingFields: availability.missingFields, reasons: ['关联配货单未采集'] } }
describe('collected workbench contract', () => {
  it('accepts partial fields only with matching read-only collection metadata', () => {
    expect(orders.isFopOrderPageDataValid({ items: [order], replica, dataAvailability: availability })).toBe(true)
    expect(orders.isFopOrderPageDataValid({ items: [order] })).toBe(false)
    expect(orders.isFopOrderPageDataValid({ items: [{ ...order, dataQuality: undefined }], replica, dataAvailability: availability })).toBe(false)
    expect(orders.isFopOrderPageDataValid({ items: [{ ...order, amount: '0' }], replica, dataAvailability: availability })).toBe(false)
    expect(orders.isFopOrderPageDataValid({ items: [mockFopOrders[0]!] })).toBe(true)
  })
  it('preserves missing amounts and currencies without inventing USD or zero', () => {
    expect(currency.formatKnownCurrency(null, 'USD')).toBe('—')
    expect(currency.formatKnownCurrency(32.5, null)).toBe('32.50')
    expect(currency.formatKnownCurrency(0, 'USD')).toBe('$0.00')
    expect(orders.orderItemQuantity(order.items)).toBeNull()
  })
  it('keeps product amount separate from missing order total', () => {
    const wrapper = mount(OrderAmountBreakdown, { global, props: { amount: null, currency: null, breakdown: { productAmount: 32.5, shippingFee: null, discountAmount: null } } })
    expect(wrapper.get('.info-tip-trigger').text()).toBe('—')
  })
  it('renders incomplete monetary totals as unavailable even for empty queues', () => {
    const wrapper = mount(OrderAmountTotals, { global, props: { totals: { orderCount: 0, itemQuantity: null, amountsByCurrency: [], complete: false } } })
    expect(wrapper.text()).toBe('—')
  })
  it('distinguishes uncollected entities from an empty complete list', () => {
    const wrapper = mount(WorkbenchTaskHeading, { global, props: { title: '备货清单', replica, dataAvailability: { ...availability, missingDatasets: ['stock_orders'], reason: '备货单尚未采集，待提供接口' } } })
    expect(wrapper.text()).toContain('备货单尚未采集，待提供接口')
    expect(wrapper.text()).toContain('只读')
    expect(wrapper.text()).toContain('2026/11/12 09:00')
  })
})

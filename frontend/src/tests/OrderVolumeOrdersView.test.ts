vi.mock('@/api/fop-chart-access', async importOriginal => { const { chartAccessFixture } = await import('./chart-access-fixtures'); return { ...await importOriginal<object>(), getChartAccess: vi.fn(async () => chartAccessFixture()) } })
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { expect, it, vi } from 'vitest'
import OrderVolumeOrdersView from '@/views/autoflow/OrderVolumeOrdersView.vue'
import { getOrderVolumeDetails } from '@/api/fop-order-volume'
vi.mock('@/api/fop-order-volume', () => ({ getOrderVolumeDetails: vi.fn().mockResolvedValue({ source: 'mock', total: 0, page: 1, pageSize: 20, items: [], totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } }) }))

it('retains customer dates in workbench details without inventing a year or timeline', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: OrderVolumeOrdersView }] })
  await router.push('/workbench/sales?queue=order-volume&category=customer&from=2025-12-31&to=2026-01-02&warehouse=ALL&seriesId=other')
  const wrapper = mount(OrderVolumeOrdersView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await flushPromises()
  const query = vi.mocked(getOrderVolumeDetails).mock.calls.at(-1)![0]
  expect(query).toMatchObject({ from: '2025-12-31', to: '2026-01-02', seriesId: 'other', workbenchRole: 'sales' })
  expect(query).not.toHaveProperty('grain'); expect(query).not.toHaveProperty('year')
  expect(wrapper.text()).toContain('2025-12-31 — 2026-01-02')
  expect(wrapper.find('tfoot').text()).toContain('0 笔订单')
  wrapper.unmount()
})

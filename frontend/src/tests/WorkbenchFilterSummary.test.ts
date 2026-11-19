import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, expect, it } from 'vitest'
import WorkbenchFilterSummary from '@/components/WorkbenchFilterSummary.vue'
import { clearWorkbenchAccess, useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
afterEach(clearWorkbenchAccess)

it.each([
  ['procurement', 'full_payment', '全款备货'],
  ['procurement_shipping', 'deposit', '押金备货'],
  ['completed', 'direct', '直接采购'],
])('summarizes the applied %s source and follows route changes', async (queue, source, label) => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: { template: '<div />' } }] })
  await router.push(`/workbench/procurement?queue=${queue}&view=fulfillment&procurementSource=${source}`)
  const wrapper = mount(WorkbenchFilterSummary, { props: { queue }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  expect(wrapper.get('p').text()).toContain(`采购来源：${label}`)
  expect(wrapper.get('p').attributes('title')).toContain(`采购来源：${label}`)
  await router.push({ query: { queue, view: 'fulfillment' } }); await flushPromises()
  expect(wrapper.get('p').text()).toContain('采购来源：全部')
  wrapper.unmount()
})
it.each([
  ['procurement', 'procurement_shipping', 'purchase', 'fulfillment', false],
  ['procurement', 'procurement_shipping', '', 'purchase', false],
  ['procurement', 'procurement_shipping', '', 'fulfillment', true],
  ['procurement', 'procurement_shipping', 'fulfillment', 'purchase', true],
  ['sales', 'review', 'fulfillment', 'fulfillment', false],
  ['procurement', 'stock_procurement', 'fulfillment', 'fulfillment', false],
] as const)('limits source summary to the effective fulfillment view (%s/%s/%s/default %s)', async (role, queue, view, defaultProcurementView, visible) => {
  useWorkbenchAccess().access.value = { roles: ['sales', 'procurement'], isAdmin: false, defaultProcurementView }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: { template: '<div />' } }] })
  await router.push({ path: `/workbench/${role}`, query: { queue, view: view || undefined, procurementSource: 'full_payment' } })
  const wrapper = mount(WorkbenchFilterSummary, { props: { queue }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  expect(wrapper.get('p').text().includes('采购来源')).toBe(visible)
  wrapper.unmount()
})
it('summarizes existing completed and unpaid ranges as customer payment time', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: { template: '<div />' } }] })
  await router.push('/workbench/dispatch?queue=completed&timeRange=1w')
  const wrapper = mount(WorkbenchFilterSummary, { props: { queue: 'completed' }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  expect(wrapper.text()).toContain('客户付款时间：近一周')
  expect(wrapper.text()).not.toContain('完成时间：')
  await router.push('/workbench/sales?queue=completed&timeRange=1m'); await flushPromises()
  expect(wrapper.text()).toContain('客户付款时间：近一月')
  await wrapper.setProps({ queue: 'unpaid' }); await router.push('/workbench/sales?queue=unpaid&timeRange=3m'); await flushPromises()
  expect(wrapper.text()).toContain('C端付款时间：近三月')
  wrapper.unmount()
})
it('summarizes applied query values without loading or data-source text and retains its element on navigation', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?departmentId=d1&warehouseCode=HZ&taskStatus=dispatch_tracking&search=YT')
  const w = mount(WorkbenchFilterSummary, { props: { queue: 'dispatch', labels: { d1: '业务一部' } }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  const original = w.element
  expect(w.text()).toContain('业务一部'); expect(w.text()).toContain('HangZhou'); expect(w.text()).toContain('已取号未同步'); expect(w.text()).toContain('YT')
  expect(w.text()).not.toMatch(/MOCK|演示|业务范围|加载/)
  await router.push('/?warehouseCode=SZ'); await flushPromises()
  expect(w.element).toBe(original); expect(w.text()).toContain('营销中心'); expect(w.text()).toContain('ShenZhen'); expect(w.text()).not.toContain('YT')
  await w.setProps({ queue: 'stock' }); await router.push('/?stockType=deposit&purchaseStatus=partial&orderStatus=paid&search=lamp'); await flushPromises()
  expect(w.text()).toContain('客户付款时间：近一月'); expect(w.text()).toContain('押金备货'); expect(w.text()).not.toContain('采购状态'); expect(w.text()).toContain('lamp'); expect(w.text()).not.toContain('备货订单状态')
  await router.push('/?lifecycle=received&timeRange=1w'); await flushPromises()
  expect(w.text()).toContain('备货阶段：采购完成已入库'); expect(w.text()).toContain('客户付款时间：近一周')
  await w.setProps({ queue: 'stock_procurement' }); expect(w.text()).not.toMatch(/备货订单状态|备货阶段|客户付款时间/)
  w.unmount()
})

it.each(['receipts', 'performance'])('describes %s without reusing unrelated todo filters', async queue => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?warehouseCode=HZ&search=old-todo-search&taskStatus=dispatch_tracking')
  const w = mount(WorkbenchFilterSummary, { props: { queue }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  expect(w.text()).toContain('数据范围')
  expect(w.get('p').text()).not.toBe('')
  expect(w.text()).not.toMatch(/old-todo-search|杭州仓|已取号未同步|MOCK|演示/)
  w.unmount()
})

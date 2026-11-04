import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import { expect, it } from 'vitest'
import WorkbenchFilterSummary from '@/components/WorkbenchFilterSummary.vue'
it('labels dispatch archive dates as shipment approval time, leaving other archive labels unchanged', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', component: { template: '<div />' } }] })
  await router.push('/workbench/dispatch?queue=completed&timeRange=1w')
  const wrapper = mount(WorkbenchFilterSummary, { props: { queue: 'completed' }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  expect(wrapper.text()).toContain('发运单审核时间：近一周')
  expect(wrapper.text()).not.toContain('完成时间：')
  await router.push('/workbench/sales?queue=completed&timeRange=1m'); await flushPromises()
  expect(wrapper.text()).toContain('完成时间：近一月')
  wrapper.unmount()
})
it('summarizes applied query values without loading or data-source text and retains its element on navigation', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?departmentId=d1&warehouseCode=HZ&taskStatus=dispatch_approved&search=YT')
  const w = mount(WorkbenchFilterSummary, { props: { queue: 'dispatch', labels: { d1: '业务一部' } }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  const original = w.element
  expect(w.text()).toContain('业务一部'); expect(w.text()).toContain('杭州仓'); expect(w.text()).toContain('已审核未同步'); expect(w.text()).toContain('YT')
  expect(w.text()).not.toMatch(/MOCK|演示|业务范围|加载/)
  await router.push('/?warehouseCode=SZ'); await flushPromises()
  expect(w.element).toBe(original); expect(w.text()).toContain('营销中心'); expect(w.text()).toContain('深圳仓'); expect(w.text()).not.toContain('YT')
  await w.setProps({ queue: 'stock' }); await router.push('/?stockType=deposit&purchaseStatus=partial&orderStatus=paid&search=lamp'); await flushPromises()
  expect(w.text()).toContain('押金备货'); expect(w.text()).not.toContain('采购状态'); expect(w.text()).toContain('lamp'); expect(w.text()).not.toContain('备货订单状态')
  await router.push('/?lifecycle=received&timeRange=1w'); await flushPromises()
  expect(w.text()).toContain('备货阶段：采购完成已入库'); expect(w.text()).toContain('创建时间：近一周')
  await w.setProps({ queue: 'stock_procurement' }); expect(w.text()).not.toMatch(/备货订单状态|备货阶段|创建时间/)
  w.unmount()
})

it.each(['order-analysis', 'order-volume', 'receipts', 'freight', 'performance', 'overview'])('describes %s without reusing unrelated todo filters', async queue => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  await router.push('/?warehouseCode=HZ&search=old-todo-search&taskStatus=dispatch_approved')
  const w = mount(WorkbenchFilterSummary, { props: { queue }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  expect(w.text()).toContain('数据范围')
  expect(w.get('p').text()).not.toBe('')
  expect(w.text()).not.toMatch(/old-todo-search|杭州仓|已审核未同步|MOCK|演示/)
  w.unmount()
})

import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import FopOrdersView from '@/views/autoflow/FopOrdersView.vue'
import * as orders from '@/api/fop-orders'
import { mockFopOrders } from '@/api/fop-order-fixtures'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))

async function setup(query = '?queue=allocation') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/workbench/:role', name: 'RoleWorkbench', component: FopOrdersView },
    { path: '/dashboard', name: 'FopDashboard', component: { template: '<div />' } },
  ] })
  await router.push(`/workbench/allocation${query}`)
  await router.isReady()
  const wrapper = mount(FopOrdersView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await vi.dynamicImportSettled()
  await flushPromises()
  return { wrapper, router }
}

vi.mock('@/api/index', () => ({ default: { get: vi.fn(async (_path, { params: query }) => {
  const search = query.search?.toLowerCase() || ''
  const filtered = mockFopOrders.filter(order => orders.matchesFopQueue(order, query.queue) && (!search || order.orderNumber.toLowerCase().includes(search)))
  return { source: 'fop', items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize }
}) } }))

describe('fulfillment order list', () => {
  it('shows server totals for all pages, separates currencies and keeps zero totals visible', async () => {
    const spy = vi.spyOn(orders, 'getFopOrders').mockResolvedValueOnce({
      source: 'mock', total: 123, page: 1, pageSize: 10,
      items: mockFopOrders.filter(o => orders.matchesFopQueue(o, 'allocation')).slice(0, 1),
      totals: { orderCount: 123, itemQuantity: 456, amountsByCurrency: [{ currency: 'USD', amount: 100.2 }, { currency: 'EUR', amount: 9.8 }] },
    })
    const { wrapper, router } = await setup()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tfoot th').text()).toContain('123 笔订单')
    expect(wrapper.find('tfoot .quantity-total').text()).toBe('456')
    expect(wrapper.findAll('.order-currency-total').map(cell => cell.text())).toEqual(['$100.20', '€9.80'])
    spy.mockResolvedValueOnce({ source: 'mock', total: 0, page: 1, pageSize: 10, items: [], totals: { orderCount: 0, itemQuantity: 0, amountsByCurrency: [] } })
    await router.push('/workbench/allocation?queue=allocation&search=empty'); await flushPromises()
    expect(wrapper.find('tfoot').text()).toContain('0 笔订单')
    expect(wrapper.find('tfoot').text()).toContain('$0.00')
    wrapper.unmount(); spy.mockRestore()
  })
  it('shows the required fields and only the selected business status, retaining its queue while searching', async () => {
    const { wrapper, router } = await setup()
    expect(wrapper.find('h2').text()).toContain('待配货')
    const headers = wrapper.find('thead').text()
    for (const label of ['订单编号', 'Shopify 单号', '客户名称', '商品', '支付状态', '配货状态']) expect(headers).toContain(label)
    for (const label of ['审核状态', '发运状态', '发货状态']) expect(headers).not.toContain(label)
    expect(wrapper.findAll('tbody tr')).toHaveLength(10)
    expect(wrapper.findAll('tbody img').length).toBeGreaterThan(0)
    await wrapper.find('input[type=search]').setValue('DEMO-SO-10241')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('allocation')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.find('tbody').text()).toContain('DEMO-SO-10241')
    await router.push('/workbench/dispatch?queue=dispatch')
    await flushPromises()
    expect(wrapper.find('thead').text()).toContain('发运状态')
    expect(wrapper.find('thead').text()).not.toContain('配货状态')
    expect(wrapper.find('tbody').text()).not.toContain('DEMO-SO-10241')
    wrapper.unmount()
  })

  it('shows an empty state and rejects unsupported queue links', async () => {
    const { wrapper, router } = await setup('?queue=allocation&search=no-such-order')
    expect(wrapper.text()).toContain('暂无符合条件的订单')
    await router.push('/workbench/allocation?queue=unknown')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无效的清单类型')
    expect(wrapper.find('tbody').exists()).toBe(false)
    wrapper.unmount()
  })

  it('removes prior records when refreshed permissions reject access', async () => {
    const { wrapper } = await setup()
    expect(wrapper.find('tbody').exists()).toBe(true)
    const spy = vi.spyOn(orders, 'getFopOrders').mockRejectedValueOnce({ code: 'fop_binding_required' })
    await wrapper.find('button.action-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('tbody').exists()).toBe(false)
    expect(wrapper.find('[role=alert]').text()).toContain('员工账号尚未关联')
    wrapper.unmount()
    spy.mockRestore()
  })

  it('discards a slow previous queue response after navigation', async () => {
    const real = orders.getFopOrders
    let resolve!: (value: orders.FopOrderPage) => void
    const spy = vi.spyOn(orders, 'getFopOrders').mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const { wrapper, router } = await setup()
    await router.push('/workbench/dispatch?queue=dispatch')
    await flushPromises()
    resolve(await real({ queue: 'allocation', page: 1, pageSize: 10 }))
    await flushPromises()
    expect(wrapper.find('h2').text()).toContain('待发运')
    expect(wrapper.find('tbody').text()).not.toContain('DEMO-SO-10241')
    wrapper.unmount()
    spy.mockRestore()
  })
})

vi.mock('@/api/workbench-replica', () => ({ getWorkbenchReplicaStatus: vi.fn().mockResolvedValue({ readMode: 'live' }), requestWorkbenchReplicaSync: vi.fn(), getWorkbenchReplicaJob: vi.fn() }))
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { matchesFopQueue } from '@/api/fop-orders'
import api from '@/api/index'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<section>Sales activities</section>' } }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/api/index', () => ({ default: { get: vi.fn(async (_path, { params }) => {
  if (_path.endsWith('/purchase-groups')) return { source: 'mock', items: [], total: 0, page: params.page, pageSize: params.pageSize, departments: [], totals: { purchaseCount: 0, orderCount: 0, uncreatedCount: 0, unknownCount: 0 }, refreshedAt: '2026-10-29T00:00:00Z' }
  const items = mockFopOrders.filter(order => matchesFopQueue(order, params.queue))
  return { source: 'fop', items, total: items.length, page: params.page, pageSize: params.pageSize }
}) } }))

describe('role workbench content', () => {
  async function setup(path: string, roles = ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], chartVisibility?: any, isAdmin = false) {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: roles as never, isAdmin, chartVisibility })
    await refreshWorkbenchAccess()
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/workbench/:role', name: 'RoleWorkbench', component: WorkbenchView },
      { path: '/dashboard', name: 'FopDashboard', component: { template: '<div />' } },
    ] })
    await router.push(path)
    const wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { WorkbenchAnalytics: true, OrderVolumeAnalysis: true, SalesPerformanceView: true, FopFreightView: true, FopReceiptsView: true, OrderVolumeOrdersView: true } } })
    await vi.dynamicImportSettled()
    await flushPromises()
    return { wrapper, router }
  }

  it.each(['sales','dispatch','procurement','allocation','warehouse'])('retires order and freight analysis for every account in %s', async role => {
    for (const isAdmin of [false, true]) {
      const { wrapper, router } = await setup(`/workbench/${role}?queue=order-analysis`, undefined, undefined, isAdmin)
      for (const queue of ['order-analysis', 'order-volume', 'freight']) {
        await router.push(`/workbench/${role}?queue=${queue}`); await flushPromises()
        expect(wrapper.get('.workbench-queues').text()).not.toMatch(/订单分析|物流运费/)
        expect(wrapper.findComponent({ name: 'WorkbenchAnalytics' }).exists()).toBe(false)
        expect(wrapper.get('[role="alert"]').text()).toContain('该清单不属于当前工作台')
      }
      wrapper.unmount()
    }
  })

  it('removes prospecting content from the sales workbench while retaining performance', async () => {
    const {wrapper,router}=await setup('/workbench/sales?queue=performance',undefined,undefined,true)
    expect(wrapper.findComponent({name:'WorkbenchAnalytics'}).exists()).toBe(true)
    await router.push('/workbench/sales?queue=overview'); await flushPromises()
    expect(wrapper.findComponent({name:'WorkbenchAnalytics'}).exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Sales activities')
    expect(wrapper.get('.workbench-queues').text()).not.toContain('客户开发概览')
    await router.push('/workbench/sales?queue=performance'); await flushPromises()
    expect(wrapper.findComponent({name:'WorkbenchAnalytics'}).exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Sales activities')
    wrapper.unmount()
  })

  it('offers the same physical purchase returns page only in procurement and warehouse workbenches', async () => {
    for (const role of ['procurement', 'warehouse']) {
      const { wrapper } = await setup(`/workbench/${role}`)
      expect(wrapper.get('.workbench-queues').text()).toContain('采购退货清单')
      wrapper.unmount()
    }
    const { wrapper } = await setup('/workbench/sales')
    expect(wrapper.get('.workbench-queues').text()).not.toContain('采购退货清单')
    wrapper.unmount()
  })

  it('exposes RMA after-sales only in the sales workbench', async () => {
    const { wrapper } = await setup('/workbench/sales')
    expect(wrapper.get('.workbench-queues').text()).toContain('RMA售后清单')
    wrapper.unmount()
    const other = await setup('/workbench/procurement')
    expect(other.wrapper.get('.workbench-queues').text()).not.toContain('RMA售后清单')
    other.wrapper.unmount()
  })

  it('hides private analytics and prevents direct queue links from mounting denied views', async () => {
    const { wrapper, router } = await setup('/workbench/sales', undefined, { order_volume: true, customer_orders: false, sales_performance: false, salesperson_receipts: false, freight: false })
    expect(wrapper.find('.workbench-queues').text()).not.toContain('订单分析')
    expect(wrapper.find('.workbench-queues').text()).not.toContain('个人收款与毛利')
    expect(wrapper.find('.workbench-queues').text()).not.toContain('客户开发概览')
    expect(wrapper.find('.workbench-queues').text()).not.toContain('物流运费')
    await router.push('/workbench/sales?queue=order-analysis'); await flushPromises()
    expect(wrapper.findComponent({ name: 'WorkbenchAnalytics' }).exists()).toBe(false)
    await router.push('/workbench/sales?queue=performance'); await flushPromises()
    expect(wrapper.findComponent({ name: 'SalesPerformanceView' }).exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('retains the same navigation and refresh slot across every kind of workbench page', async () => {
    const { wrapper, router } = await setup('/workbench/sales')
    const navigation = wrapper.get('.workbench-queue-row').element
    const refresh = wrapper.get('.workbench-queue-refresh').element
    const tabs = wrapper.get('.workbench-queues').element
    for (const queue of ['performance', 'overview', 'receipts', 'stock', 'review']) {
      await router.push(`/workbench/sales?queue=${queue}`); await flushPromises()
      expect(wrapper.get('.workbench-queue-row').element).toBe(navigation)
      expect(wrapper.get('.workbench-queues').element).toBe(tabs)
      expect(wrapper.get('.workbench-queue-refresh').element).toBe(refresh)
      expect(tabs.nextElementSibling).toBe(refresh)
    }
    wrapper.unmount()
  })

  it('opens sales review by default with assigned workbench tabs and no duplicate prospecting entry', async () => {
    const { wrapper, router } = await setup('/workbench/sales', ['sales'], undefined, true)
    expect(wrapper.get('.role-tabs a[aria-current="page"]').text()).toBe('销售工作台')
    expect(wrapper.find('h2').text()).toContain('待审核清单')
    expect(wrapper.findAll('.workbench-queues a').slice(0, 6).map(a => a.text())).toEqual(['待支付清单', '待审核清单', '已审核清单', '备货清单', 'RMA售后清单', '异常订单清单'])
    expect(wrapper.find('.workbench-queues a.active').text()).toBe('待审核清单')
    expect(wrapper.findAll('.role-tabs a')).toHaveLength(1)
    expect(wrapper.find('.workbench-queues').text()).toContain('待审核清单')
    expect(wrapper.find('.workbench-queues').text()).toContain('异常订单清单')
    await wrapper.findAll('.workbench-queues a').find(a => a.text() === '待支付清单')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('unpaid')
    expect(wrapper.find('h2').text()).toContain('待支付清单')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.find('thead').text()).not.toContain('支付状态')
    await router.push('/workbench/sales'); await flushPromises()
    expect(wrapper.find('h2').text()).toContain('待审核清单')
    expect(wrapper.find('.workbench-queues a.active').text()).toBe('待审核清单')
    expect(wrapper.get('.workbench-queues').text()).not.toContain('客户开发概览')
    wrapper.unmount()
  })

  it('puts procurement details inside its workbench and rejects another role’s queue', async () => {
    const { wrapper, router } = await setup('/workbench/procurement?view=fulfillment')
    expect(wrapper.findAll('.role-tabs a').map(tab => tab.text())).toEqual(['销售工作台', '发运工作台', '采购工作台', '配货工作台', '仓库工作台'])
    expect(wrapper.get('.role-tabs a[aria-current="page"]').text()).toBe('采购工作台')
    expect(wrapper.find('.workbench-queues a').text()).toBe('待采购清单')
    expect(wrapper.find('.workbench-queues a').classes()).toContain('active')
    expect(wrapper.find('thead').text()).toContain('采购状态')
    expect(wrapper.find('thead').text()).not.toContain('配货单状态')
    expect(wrapper.findAll('tbody tr')).toHaveLength(5)
    await router.push('/workbench/procurement?queue=shipping')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('不属于当前工作台')
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clears procurement source filters when switching procurement tabs while retaining organization scope', async () => {
    const { wrapper, router } = await setup('/workbench/procurement?queue=procurement_shipping&view=fulfillment&departmentId=d1&ownerId=employee-1&procurementSource=deposit')
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="采购来源"]').element.value).toBe('deposit')
    await wrapper.findAll('.workbench-queues a').find(tab => tab.text() === '待采购清单')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ queue: 'procurement', view: 'fulfillment', departmentId: 'd1', ownerId: 'employee-1' })
    expect(router.currentRoute.value.query.procurementSource).toBeUndefined()
    expect(wrapper.get<HTMLSelectElement>('select[aria-label="采购来源"]').element.value).toBe('')
    wrapper.unmount()
  })

  it('clears fulfillment-only procurement source when switching to purchase orders', async () => {
    const { wrapper, router } = await setup('/workbench/procurement?queue=procurement_shipping&view=fulfillment&departmentId=d1&procurementSource=deposit')
    await wrapper.findAll('.purchase-view-switch button').find(button => button.text() === '按采购单查看')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ queue: 'procurement_shipping', view: 'purchase', departmentId: 'd1' })
    expect(router.currentRoute.value.query.procurementSource).toBeUndefined()
    expect(wrapper.find('select[aria-label="采购来源"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['allocation', '已齐套未审核', 'allocation_review', '发运单状态'],
    ['procurement', '已采购待发货', 'procurement_shipping', '供应商发货状态'],
  ])('opens the separate %s follow-up tab and retains department filters', async (role, label, queue, column) => {
    const { wrapper, router } = await setup(`/workbench/${role}?departmentId=d1${role === 'procurement' ? '&view=fulfillment' : ''}`)
    if (role === 'allocation') {
      expect(wrapper.find('h2').text()).toContain('已齐套未审核')
      expect(wrapper.find('.workbench-queues a.active').text()).toBe('已齐套未审核')
    }
    expect(wrapper.findAll('.workbench-queues a').slice(0, role === 'allocation' ? 2 : 3).map(a => a.text())).toEqual(role === 'allocation' ? ['未齐套清单', label] : ['待采购清单', label, '备货待采购清单'])
    await wrapper.findAll('.workbench-queues a').find(a => a.text() === label)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ queue, departmentId: 'd1', ...(role === 'procurement' ? { view: 'fulfillment' } : {}) })
    expect(wrapper.find('thead').text()).toContain(column)
    expect(wrapper.find('thead').text()).not.toContain('支付状态')
    expect(wrapper.findAll('tbody .order-cell').length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('does not mount the order list when the account has no access to the role', async () => {
    const { wrapper } = await setup('/workbench/warehouse?queue=shipping', ['sales'])
    expect(wrapper.find('[role=alert]').text()).toContain('暂时无法访问')
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })

  it('retains department and salesperson between todo queues and workbenches, but resets the page', async () => {
    const { wrapper, router } = await setup('/workbench/sales?queue=review&departmentId=d1&ownerId=employee-1&page=2&search=old', undefined, undefined, true)
    const exceptions = wrapper.findAll('.workbench-queues a').find(a => a.text().includes('异常订单'))!
    await exceptions.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ queue: 'exceptions', departmentId: 'd1', ownerId: 'employee-1' })
    await wrapper.findAll('.role-tabs a').find(a => a.text().includes('采购'))!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.params.role).toBe('procurement')
    expect(router.currentRoute.value.query).toEqual({ departmentId: 'd1', ownerId: 'employee-1' })
    expect(wrapper.get('.role-tabs a[aria-current="page"]').text()).toBe('采购工作台')
    wrapper.unmount()
  })
})

it.each([['sales', '已审核清单'], ['dispatch', '已履约订单'], ['procurement', '采购完成清单'], ['allocation', '配货完成清单'], ['warehouse', '已出库清单']])('offers the %s completed tab with its default time range', async (role, title) => {
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: [role as import('@/utils/workbench').WorkbenchRole], isAdmin: false })
  await refreshWorkbenchAccess()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/workbench/:role', name: 'RoleWorkbench', component: WorkbenchView }, { path: '/dashboard', name: 'FopDashboard', component: { template: '<div />' } }] })
  await router.push(`/workbench/${role}?queue=completed`)
  const wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  await vi.dynamicImportSettled(); await flushPromises()
  const tab = wrapper.findAll('.workbench-queues a').find(a => a.text() === title)!
  expect(tab.exists()).toBe(true)
  expect(tab.attributes('class')).toContain('active')
  expect(tab.attributes('href')).toContain('queue=completed')
  expect(tab.attributes('href')).toContain('timeRange=3m')
  expect(api.get).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ params: expect.objectContaining({ timeRange: '3m' }) }))
  wrapper.unmount()
})

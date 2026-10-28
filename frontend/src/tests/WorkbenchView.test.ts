import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchView from '@/views/autoflow/WorkbenchView.vue'
import { mockFopOrders } from '@/api/fop-order-fixtures'
import { matchesFopQueue } from '@/api/fop-orders'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/views/autoflow/DashboardView.vue', () => ({ default: { template: '<section>Sales activities</section>' } }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
vi.mock('@/components/FopDataAccessNotice.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/api/index', () => ({ default: { get: vi.fn(async (_path, { params }) => {
  const items = mockFopOrders.filter(order => matchesFopQueue(order, params.queue))
  return { source: 'fop', items, total: items.length, page: params.page, pageSize: params.pageSize }
}) } }))

describe('role workbench content', () => {
  async function setup(path: string, roles = ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse']) {
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: roles as never, isAdmin: false })
    await refreshWorkbenchAccess()
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/workbench/:role', name: 'RoleWorkbench', component: WorkbenchView },
      { path: '/dashboard', name: 'FopDashboard', component: { template: '<div />' } },
    ] })
    await router.push(path)
    const wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { OrderVolumeAnalysis: true, SalesPerformanceView: true, FopFreightView: true, FopReceiptsView: true, OrderVolumeOrdersView: true } } })
    await vi.dynamicImportSettled()
    await flushPromises()
    return { wrapper, router }
  }

  it('retains the same summary and tabs across every kind of workbench page', async () => {
    const { wrapper, router } = await setup('/workbench/sales')
    const summary = wrapper.get('.workbench-filter-summary').element
    const tabs = wrapper.get('.workbench-queues').element
    for (const queue of ['order-analysis', 'freight', 'performance', 'overview', 'receipts', 'order-volume', 'stock', 'review']) {
      await router.push(`/workbench/sales?queue=${queue}`); await flushPromises()
      expect(wrapper.get('.workbench-filter-summary').element).toBe(summary)
      expect(wrapper.get('.workbench-queues').element).toBe(tabs)
      expect(summary.nextElementSibling).toBe(tabs)
      expect(wrapper.get('.workbench-filter-summary p').text()).not.toBe('')
    }
    wrapper.unmount()
  })

  it('opens sales review by default while retaining the overview and assigned workbench tabs', async () => {
    const { wrapper, router } = await setup('/workbench/sales', ['sales'])
    expect(wrapper.find('h1').text()).toBe('销售工作台')
    expect(wrapper.find('h2').text()).toContain('待审核清单')
    expect(wrapper.findAll('.workbench-queues a').slice(0, 4).map(a => a.text())).toEqual(['待支付清单', '待审核清单', '备货清单', '异常订单清单'])
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
    await wrapper.findAll('.workbench-queues a').find(a => a.text().includes('客户开发概览'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Sales activities')
    wrapper.unmount()
  })

  it('puts procurement details inside its workbench and rejects another role’s queue', async () => {
    const { wrapper, router } = await setup('/workbench/procurement')
    expect(wrapper.findAll('.role-tabs a').map(tab => tab.text())).toEqual(['销售工作台', '发运工作台', '采购工作台', '配货工作台', '仓库工作台'])
    expect(wrapper.find('h1').text()).toBe('采购工作台')
    expect(wrapper.find('.workbench-queues a').text()).toBe('待采购清单')
    expect(wrapper.find('.workbench-queues a').classes()).toContain('active')
    expect(wrapper.find('thead').text()).toContain('采购进度')
    expect(wrapper.find('thead').text()).not.toContain('配货单状态')
    expect(wrapper.findAll('tbody tr')).toHaveLength(5)
    await router.push('/workbench/procurement?queue=shipping')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('不属于当前工作台')
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['allocation', '已齐套未审核', 'allocation_review', '发运单状态'],
    ['procurement', '已采购待发货', 'procurement_shipping', '供应商发货状态'],
  ])('opens the separate %s follow-up tab and retains department filters', async (role, label, queue, column) => {
    const { wrapper, router } = await setup(`/workbench/${role}?departmentId=d1`)
    if (role === 'allocation') {
      expect(wrapper.find('h2').text()).toContain('已齐套未审核')
      expect(wrapper.find('.workbench-queues a.active').text()).toBe('已齐套未审核')
    }
    expect(wrapper.findAll('.workbench-queues a').slice(0, role === 'allocation' ? 2 : 3).map(a => a.text())).toEqual(role === 'allocation' ? ['未齐套清单', label] : ['待采购清单', '待采购待备货清单', label])
    await wrapper.findAll('.workbench-queues a').find(a => a.text() === label)!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ queue, departmentId: 'd1' })
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
    const { wrapper, router } = await setup('/workbench/sales?queue=review&departmentId=d1&ownerId=employee-1&page=2&search=old')
    const exceptions = wrapper.findAll('.workbench-queues a').find(a => a.text().includes('异常订单'))!
    await exceptions.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ queue: 'exceptions', departmentId: 'd1', ownerId: 'employee-1' })
    await wrapper.findAll('.role-tabs a').find(a => a.text().includes('采购'))!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.params.role).toBe('procurement')
    expect(router.currentRoute.value.query).toEqual({ departmentId: 'd1', ownerId: 'employee-1' })
    await wrapper.findAll('.workbench-queues a').find(a => a.text().includes('订单分析'))!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.ownerId).toBeUndefined()
    wrapper.unmount()
  })
})

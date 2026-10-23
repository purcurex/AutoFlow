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
    const wrapper = mount(WorkbenchView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
    await vi.dynamicImportSettled()
    await flushPromises()
    return { wrapper, router }
  }

  it('keeps the sales overview and exposes only assigned workbench tabs', async () => {
    const { wrapper } = await setup('/workbench/sales', ['sales'])
    expect(wrapper.find('h1').text()).toBe('销售工作台')
    expect(wrapper.text()).toContain('Sales activities')
    expect(wrapper.findAll('.role-tabs a')).toHaveLength(1)
    expect(wrapper.find('.workbench-queues').text()).toContain('待审核清单')
    expect(wrapper.find('.workbench-queues').text()).toContain('异常订单清单')
    wrapper.unmount()
  })

  it('puts procurement details inside its workbench and rejects another role’s queue', async () => {
    const { wrapper, router } = await setup('/workbench/procurement')
    expect(wrapper.find('h1').text()).toBe('采购工作台')
    expect(wrapper.find('thead').text()).toContain('供应商发货状态')
    expect(wrapper.find('thead').text()).not.toContain('配货状态')
    expect(wrapper.findAll('tbody tr')).toHaveLength(8)
    await router.push('/workbench/procurement?queue=shipping')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('不属于当前工作台')
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not mount the order list when the account has no access to the role', async () => {
    const { wrapper } = await setup('/workbench/warehouse?queue=shipping', ['sales'])
    expect(wrapper.find('[role=alert]').text()).toContain('暂时无法访问')
    expect(wrapper.find('table').exists()).toBe(false)
    wrapper.unmount()
  })
})

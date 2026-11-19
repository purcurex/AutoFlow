import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { autoflowApi, type AutoFlowDashboard } from '@/api/autoflow'
import { getWorkbenchAccess } from '@/api/workbench-access'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { i18n } from '@/i18n'
import FollowUpView from '@/views/autoflow/FollowUpView.vue'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<main><slot /></main>' } }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))
vi.mock('@/api/autoflow', async load => ({ ...await load<typeof import('@/api/autoflow')>(), autoflowApi: { getDashboard: vi.fn(), getFollowUps: vi.fn() } }))
const fixture = (): AutoFlowDashboard => ({
  metrics: { activeWorkflows: 2, newLeads: 8, readyOutreach: 3, replies: 4, opportunities: 5 },
  funnel: [{ key: 'qualified', label: 'Qualified', count: 27, value: 0 }, { key: 'replied', label: 'Replied', count: 4, value: 0 }],
  recentWorkflows: [{ id: 'task1', displayId: '12', name: '宠物用品开发', createdAt: '2026-11-18T00:00:00Z', status: 'running', currentStage: 'ad_discovery', targetMarket: 'US', progress: 35, customerDiscoveryStatus: 'running' }] as any,
  topLeads: [{ id: 'lead1', brandName: 'Northstar', domain: 'northstar.example', country: 'US', category: 'Pets', totalScore: 91, status: 'qualified' }] as any,
  nextTasks: [{ id: 'out1', leadId: 'lead1', leadName: 'Northstar', channel: 'email', status: 'ready', message: '产品合作沟通草稿' }] as any,
})
const wrappers: ReturnType<typeof mount>[] = []
async function setup(admin = true, visible = true) {
  vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: admin, chartVisibility: { sales_performance: visible } } as any)
  await refreshWorkbenchAccess()
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/follow-ups', component: FollowUpView }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  await router.push('/follow-ups')
  const wrapper = mount(FollowUpView, { global: { plugins: [createPinia(), i18n, router] } })
  wrappers.push(wrapper); await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.clearAllMocks(); i18n.global.locale.value = 'zh-CN'
  vi.mocked(autoflowApi.getDashboard).mockResolvedValue(fixture())
  vi.mocked(autoflowApi.getFollowUps).mockResolvedValue(fixture().funnel)
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()) })

describe('merged customer follow-up', () => {
  it('retains all overview areas and stage navigation using full stage counts rather than five top leads', async () => {
    const { wrapper } = await setup()
    expect(wrapper.text()).toContain('宠物用品开发')
    expect(wrapper.text()).toContain('Northstar')
    expect(wrapper.findAll('a[href="/leads?status=qualified"]')).toHaveLength(1)
    expect(wrapper.get('a[href="/leads?status=qualified"]').text()).toContain('27')
    expect(wrapper.findAll('a[href="/leads"]')).toHaveLength(1)
    expect(wrapper.get('a[href="/leads"]').text()).toContain('31')
    expect(wrapper.get('.follow-up-stages a[href="/leads?status=replied"]').text()).toContain('4')
    const detail = wrapper.get('a[href*="/leads/lead1"]')
    expect(detail.attributes('href')).toContain('returnTo=/follow-ups')
    expect(autoflowApi.getDashboard).toHaveBeenCalledTimes(1)
    expect(autoflowApi.getFollowUps).not.toHaveBeenCalled()
  })
  it('combines task statistics with switchable task lists and retains communication filters without refetching', async () => {
    const { wrapper } = await setup()
    expect(wrapper.get('#development-task-tab').text()).toContain('2')
    expect(wrapper.get('#communication-task-tab').text()).toContain('3')
    expect(wrapper.text()).not.toContain('产品合作沟通草稿')
    await wrapper.get('#communication-task-tab').trigger('click')
    expect(wrapper.get('#communication-task-tab').attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toContain('产品合作沟通草稿')
    expect(wrapper.text()).not.toContain('宠物用品开发')
    expect(wrapper.find('a[href="/outreach?status=ready"]').exists()).toBe(true)
    expect(wrapper.find('a[href="/outreach"]').exists()).toBe(true)
    await wrapper.get('#communication-task-tab').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('#development-task-tab').attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toContain('宠物用品开发')
    expect(autoflowApi.getDashboard).toHaveBeenCalledTimes(1)
  })
  it.each([[false, true], [true, false]])('preserves stage access without fetching restricted overview data (%s, %s)', async (admin, visible) => {
    const { wrapper } = await setup(admin, visible)
    expect(wrapper.text()).toContain('已筛选')
    expect(wrapper.text()).not.toContain('Northstar')
    expect(autoflowApi.getDashboard).not.toHaveBeenCalled()
    expect(autoflowApi.getFollowUps).toHaveBeenCalledTimes(1)
  })
  it('keeps stage navigation usable when overview loading fails, and retries from the one refresh action', async () => {
    vi.mocked(autoflowApi.getDashboard).mockRejectedValueOnce(new Error('unavailable'))
    const { wrapper } = await setup()
    expect(wrapper.get('[role="alert"]').text()).toContain('重试')
    expect(wrapper.get('.follow-up-stages a[href="/leads?status=qualified"]').text()).toContain('27')
    await wrapper.get('button[aria-label="刷新客户跟进"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Northstar')
  })
  it('removes privileged content when its display grant is revoked', async () => {
    const { wrapper } = await setup()
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false } as any)
    await refreshWorkbenchAccess(); await flushPromises()
    expect(wrapper.text()).not.toContain('Northstar')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.get('.follow-up-stages').text()).toContain('27')
  })
  it('ignores a late overview response after its grant changes, without replacing current stage counts', async () => {
    let finish!: (result: AutoFlowDashboard) => void
    vi.mocked(autoflowApi.getDashboard).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const { wrapper } = await setup()
    expect(wrapper.get('.follow-up-stages a[href="/leads?status=qualified"]').text()).toContain('—')
    vi.mocked(autoflowApi.getFollowUps).mockResolvedValue([{ key: 'qualified', label: 'Qualified', count: 9, value: 0 }])
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: ['sales'], isAdmin: false } as any)
    await refreshWorkbenchAccess(); await flushPromises()
    finish(fixture()); await flushPromises()
    expect(wrapper.text()).not.toContain('Northstar')
    expect(wrapper.get('.follow-up-stages a[href="/leads?status=qualified"]').text()).toContain('9')
    expect(wrapper.get('.follow-up-stages a[href="/leads?status=qualified"]').text()).not.toContain('27')
    expect(wrapper.get('button[aria-label="刷新客户跟进"]').attributes('disabled')).toBeUndefined()
  })
})

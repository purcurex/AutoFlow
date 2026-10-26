import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchRoleAdminView from '@/views/WorkbenchRoleAdminView.vue'
import { getWorkbenchAccounts, testFopConnection, bindCurrentFopConnection } from '@/api/workbench-access'
import type { FopConnectionContext } from '@/api/fop-access'
import { useUserStore } from '@/stores/user'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/composables/useWorkbenchAccess', () => ({ refreshWorkbenchAccess: vi.fn() }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccounts: vi.fn(), updateWorkbenchRoles: vi.fn(), updateFopBinding: vi.fn(),
  updateBusinessScope: vi.fn(), updateManagementRole: vi.fn(), testFopConnection: vi.fn(), bindCurrentFopConnection: vi.fn() }))

const preview: FopConnectionContext = { subject: { tenantId: 'offline', userId: '100' }, username: 'kingdee-admin',
  currentOrganization: { id: '10', name: '测试公司' }, resources: ['orders'] }

function setup(currentId = 'admin', businessRole: 'admin' | 'none' = 'admin') {
  const account = { id: 'admin', displayId: '000001', email: 'admin@example.test', username: 'Admin', role: 'admin' as const,
    workbenchRoles: ['sales' as const], businessScope: { role: businessRole, departmentId: null, employeeId: null }, fopBinding: null }
  vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
  const pinia = createPinia(), store = useUserStore(pinia)
  store.$patch({ user: { id: currentId, username: 'Admin', email: 'admin@example.test', role: 'admin' } })
  const wrapper = mount(WorkbenchRoleAdminView, { global: { plugins: [pinia, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true } } })
  return { wrapper, account, store }
}

describe('current administrator Kingdee connection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('previews the company without writing a binding and saves only after explicit confirmation', async () => {
    vi.mocked(testFopConnection).mockResolvedValue(preview)
    const { wrapper, account } = setup()
    vi.mocked(bindCurrentFopConnection).mockResolvedValue({ ...account, fopBinding: preview.subject })
    await flushPromises()
    expect(wrapper.find('input[aria-label="Admin · FOP 用户 ID"]').exists()).toBe(false)
    await wrapper.get('[data-test-connection]').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-connection-preview]').text()).toContain('测试公司')
    expect(bindCurrentFopConnection).not.toHaveBeenCalled()
    await wrapper.get('[data-bind-connection]').trigger('click'); await flushPromises()
    expect(bindCurrentFopConnection).toHaveBeenCalledExactlyOnceWith(preview)
    expect(wrapper.get('[role=status]').text()).toContain('当前账号已绑定金蝶')
    expect(wrapper.find('[data-connection-preview]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([['another-user', 'admin'], ['admin', 'none']] as const)('keeps automated linking unavailable for %s with business role %s', async (id, role) => {
    const { wrapper } = setup(id, role)
    await flushPromises()
    expect(wrapper.find('[data-test-connection]').exists()).toBe(false)
    expect(wrapper.find('input[aria-label="Admin · FOP 用户 ID"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows an actionable token error and does not offer confirmation after a failed test', async () => {
    vi.mocked(testFopConnection).mockRejectedValue({ code: 'fop_authentication_expired' })
    const { wrapper } = setup()
    await flushPromises()
    await wrapper.get('[data-test-connection]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('认证已失效')
    expect(wrapper.find('[data-bind-connection]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('discards a connection result after the local account changes', async () => {
    let resolvePreview!: (value: FopConnectionContext) => void
    vi.mocked(testFopConnection).mockReturnValue(new Promise(resolve => { resolvePreview = resolve }))
    const { wrapper, store } = setup()
    await flushPromises()
    await wrapper.get('[data-test-connection]').trigger('click')
    store.$patch({ user: { id: 'another-user' } })
    resolvePreview(preview); await flushPromises()
    expect(wrapper.find('[data-connection-preview]').exists()).toBe(false)
    expect(bindCurrentFopConnection).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('preserves an unbound state and requests another test after a binding conflict', async () => {
    vi.mocked(testFopConnection).mockResolvedValue(preview)
    vi.mocked(bindCurrentFopConnection).mockRejectedValue({ statusCode: 409 })
    const { wrapper } = setup()
    await flushPromises()
    await wrapper.get('[data-test-connection]').trigger('click'); await flushPromises()
    await wrapper.get('[data-bind-connection]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('已绑定其他账号')
    expect(wrapper.get('[data-kingdee-connection]').text()).toContain('尚未连接金蝶')
    expect(wrapper.find('[data-bind-connection]').exists()).toBe(false)
    wrapper.unmount()
  })
})

import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import WorkbenchRoleAdminView from '@/views/WorkbenchRoleAdminView.vue'
import { getWorkbenchAccounts, updateWorkbenchRoles, updateFopBinding, updateBusinessScope, updateManagementRole, updateChartPermissions } from '@/api/workbench-access'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccounts: vi.fn(), updateWorkbenchRoles: vi.fn(), updateFopBinding: vi.fn(), updateBusinessScope: vi.fn(), updateManagementRole: vi.fn(), updateChartPermissions: vi.fn() }))

describe('workbench role administration', () => {
  it('saves selected roles and only marks them saved after server confirmation', async () => {
    const account = { chartPermissions: [], id: 'u1', displayId: '000001', email: 'sales@example.test', username: 'Alice', fopBinding: null, role: 'user' as const, workbenchRoles: ['sales' as const] }
    vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
    vi.mocked(updateWorkbenchRoles).mockRejectedValueOnce(new Error('Forbidden')).mockResolvedValueOnce({ ...account, workbenchRoles: ['sales', 'warehouse'] })
    const wrapper = mount(WorkbenchRoleAdminView, { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.find('input[value=warehouse]').setValue(true)
    await wrapper.find('button[data-save]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('保存失败')
    expect(wrapper.find('button[data-save]').attributes('disabled')).toBeUndefined()
    await wrapper.find('button[data-save]').trigger('click')
    await flushPromises()
    expect(updateWorkbenchRoles).toHaveBeenLastCalledWith('u1', ['sales', 'warehouse'])
    expect(wrapper.find('[role=status]').text()).toContain('已保存')
    expect(wrapper.find('button[data-save]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

 describe('FOP account bindings', () => {
  it('saves, reports duplicate identity errors, and unlinks only through the admin API', async () => {
    const account = { chartPermissions: [], id: 'u2', displayId: '000002', email: 'admin@example.test', username: 'Admin', role: 'admin' as const, workbenchRoles: [], fopBinding: null }
    vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
    vi.mocked(updateFopBinding).mockRejectedValueOnce({ statusCode: 409 }).mockResolvedValueOnce({ ...account, fopBinding: { tenantId: 'company', userId: 'employee-2' } }).mockResolvedValueOnce({ ...account, fopBinding: null })
    const wrapper = mount(WorkbenchRoleAdminView, { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.find('input[aria-label="Admin · FOP 租户 ID"]').setValue(' company ')
    await wrapper.find('input[aria-label="Admin · FOP 用户 ID"]').setValue('employee-2')
    const form = wrapper.find('button[data-save-binding]').element.closest('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('已绑定其他账号')
    expect(wrapper.text()).toContain('未绑定 · 不可访问')
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(updateFopBinding).toHaveBeenLastCalledWith('u2', { tenantId: 'company', userId: 'employee-2' })
    expect(wrapper.text()).toContain('已绑定 · 后台授权后可访问')
    await wrapper.find('button[data-unlink]').trigger('click')
    await flushPromises()
    expect(updateFopBinding).toHaveBeenLastCalledWith('u2', null)
    expect(wrapper.text()).toContain('未绑定 · 不可访问')
    wrapper.unmount()
  })
})


describe('business data scope editor', () => {
  it('requires manager assignment, handles rejection, and persists the server-confirmed role', async () => {
    const account = { chartPermissions: [], id: 'scope-user', displayId: '000003', email: 'scope@example.test', username: 'Scope', fopBinding: null, role: 'user' as const, workbenchRoles: ['sales' as const], businessScope: { role: 'salesperson' as const, departmentId: null, employeeId: 'employee-1' } }
    vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
    const wrapper = mount(WorkbenchRoleAdminView, { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true } } })
    await flushPromises()
    await wrapper.find('select[aria-label="Scope · 业务数据角色"]').setValue('department_manager')
    const submit = () => wrapper.find('button[data-save-scope]').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    submit(); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('部门经理必须绑定部门')
    expect(updateBusinessScope).not.toHaveBeenCalled()
    await wrapper.find('input[aria-label="Scope · 所属部门 ID"]').setValue(' sales-1 ')
    vi.mocked(updateBusinessScope).mockRejectedValueOnce(new Error('Forbidden')).mockResolvedValueOnce({ ...account, businessScope: { role: 'department_manager', departmentId: 'sales-1', employeeId: 'employee-1' } })
    submit(); await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('保存失败')
    submit(); await flushPromises()
    expect(updateBusinessScope).toHaveBeenLastCalledWith('scope-user', { role: 'department_manager', departmentId: 'sales-1', employeeId: 'employee-1' })
    expect(wrapper.find('[role=status]').text()).toContain('下次请求立即生效')
    expect(wrapper.find('button[data-save-scope]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})


describe('independent system administrator data access', () => {
  it('lets an administrator disable their business data without removing management rights', async () => {
    const account = { chartPermissions: [], id: 'admin-only', displayId: '000004', email: 'admin@example.test', username: 'Admin', fopBinding: null, role: 'admin' as const, workbenchRoles: [], businessScope: { role: 'admin' as const, departmentId: null, employeeId: null } }
    vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
    const wrapper = mount(WorkbenchRoleAdminView, { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true } } })
    await flushPromises()
    const select = wrapper.get('select[aria-label="Admin · 业务数据角色"]')
    expect(select.attributes('disabled')).toBeUndefined()
    expect(select.find('option[value="none"]').exists()).toBe(true)
    expect(wrapper.find('select[aria-label="Admin · 系统管理角色"]').exists()).toBe(true)
    await select.setValue('none')
    vi.mocked(updateBusinessScope).mockResolvedValue({ ...account, businessScope: { role: 'none', departmentId: null, employeeId: null } } as never)
    await wrapper.get('button[data-save-scope]').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(updateBusinessScope).toHaveBeenLastCalledWith('admin-only', { role: 'none', departmentId: null, employeeId: null })
    expect(account.role).toBe('admin')
    wrapper.unmount()
  })
})


it('saves management rights independently from the business scope', async () => {
  const account = { chartPermissions: [], id: 'manager', displayId: '000005', email: 'manager@example.test', username: 'Manager', fopBinding: null, role: 'user' as const, workbenchRoles: [], businessScope: { role: 'none' as const, departmentId: null, employeeId: null } }
  vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
  vi.mocked(updateManagementRole).mockResolvedValue({ ...account, role: 'admin' })
  const wrapper = mount(WorkbenchRoleAdminView, { global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true } } })
  await flushPromises()
  await wrapper.get('select[aria-label="Manager · 系统管理角色"]').setValue('admin')
  await wrapper.get('button[data-save-management]').element.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
  expect(updateManagementRole).toHaveBeenLastCalledWith('manager', 'admin')
  expect(wrapper.get('select[aria-label="Manager · 业务数据角色"]').element).toHaveProperty('value', 'none')
  expect(wrapper.find('[role=status]').text()).toContain('业务数据范围保持不变')
  wrapper.unmount()
})


it('configures chart visibility, scope, organization summaries and independent actions', async () => {
  const account = { chartPermissions: [], id: 'charts', displayId: '000007', email: 'chart@example.test', username: 'Charts', fopBinding: null, role: 'user' as const, workbenchRoles: [] }
  vi.mocked(getWorkbenchAccounts).mockResolvedValue({ items: [account], total: 1 })
  vi.mocked(updateChartPermissions).mockImplementation(async (_id, chartPermissions) => ({ ...account, chartPermissions }))
  const wrapper = mount(WorkbenchRoleAdminView, { attachTo: document.body, global: { plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: true, teleport: true } } })
  await flushPromises()
  await wrapper.get('[data-chart-permissions]').trigger('click')
  const row = wrapper.get('[data-chart-id="order_volume"]')
  await row.get('[aria-label="图表可见性"]').setValue('allow')
  await row.get('[aria-label="记录范围"]').setValue('self')
  await row.get('[aria-label="组织汇总"]').setValue('selected')
  await flushPromises()
  expect((row.get('[aria-label="组织汇总"]').element as HTMLSelectElement).value).toBe('selected')
  await wrapper.get('[data-chart-id="order_volume"] input[value="sales2"]').setValue(true)
  await row.get('[aria-label="明细权限"]').setValue('deny')
  await row.get('[aria-label="导出权限"]').setValue('allow')
  expect(wrapper.get('[data-chart-id="customer_orders"]').find('option[value="marketing"]').exists()).toBe(false)
  await wrapper.get('[data-save-chart-permissions]').trigger('click'); await flushPromises()
  expect(updateChartPermissions).toHaveBeenCalledWith('charts', expect.arrayContaining([{ chartId: 'order_volume', visibility: 'allow', dataScope: 'self', summaryMode: 'selected', summaryDepartments: ['sales2'], details: 'deny', export: 'allow' }]))
  expect(wrapper.text()).toContain('图表权限已保存')
  wrapper.unmount()
})

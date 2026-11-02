import { createPinia } from 'pinia'
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WorkbenchRoleAdminView from '@/views/WorkbenchRoleAdminView.vue'
import { getWorkbenchAccounts, updateAccountAccess, updateChartPermissions, type WorkbenchAccount } from '@/api/workbench-access'
import { workbenchRoles } from '@/utils/workbench'
import { useUserStore } from '@/stores/user'
import { invalidateSession } from '@/utils/session'
vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/api/workbench-access', async original => ({ ...await original<object>(), getWorkbenchAccounts: vi.fn(), updateAccountAccess: vi.fn(), updateChartPermissions: vi.fn() }))
const base: WorkbenchAccount = { chartPermissions: [], id: 'u1', displayId: '000001', email: 'alice@example.test', username: 'Alice', fopBinding: null, role: 'user', workbenchRoles: [...workbenchRoles], businessScope: { role: 'salesperson', departmentId: 'd1', employeeId: 'e1' }, employee: { id: 'e1', name: '张丽（Alice）', code: 'ID-001', department: { id: 'd1', name: '业务一部' } } }
let current: WorkbenchAccount
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.resetAllMocks(); current = structuredClone(base)
  vi.mocked(getWorkbenchAccounts).mockImplementation(async () => ({ items: [structuredClone(current)], total: 1 }))
  vi.mocked(updateAccountAccess).mockImplementation(async (_id, input) => { current = { ...current, role: input.accountRole === 'administrator' ? 'admin' : 'user', businessScope: input.businessScope, workbenchRoles: input.workbenchRoles }; return structuredClone(current) })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })
async function setup(self = false) {
  const pinia = createPinia()
  if (self) useUserStore(pinia).user = { id: current.id, role: 'admin' } as never
  const wrapper = mount(WorkbenchRoleAdminView, { attachTo: document.body, global: { plugins: [pinia, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { RouterLink: RouterLinkStub, teleport: true } } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
async function edit(wrapper: VueWrapper) { await wrapper.get('[data-edit-access]').trigger('click'); await flushPromises() }
async function submit(wrapper: VueWrapper) { await wrapper.get('.account-access-dialog form').trigger('submit'); await flushPromises() }
const roleButton = (role: string) => `[data-role="${role}"][aria-pressed]`
it('keeps the list compact and exposes exactly four roles on demand', async () => {
  const w = await setup()
  expect(w.find('.account-access-dialog').exists()).toBe(false)
  expect(w.find('tbody input, tbody select').exists()).toBe(false)
  expect(w.find('tbody').text()).toContain('外贸业务员')
  expect(w.find('tbody').text()).toContain('业务一部')
  expect(w.findAllComponents(RouterLinkStub).some(link => JSON.stringify(link.props('to')).includes('accountId'))).toBe(true)
  await edit(w)
  expect(w.findAll('.role-options button').map(b => b.get('span').text())).toEqual(['管理员', '部门经理', '外贸业务员', '协同管理岗'])
  expect(w.get('.account-access-dialog details').attributes('open')).toBeUndefined()
})
it('saves role, scope and workbenches in one confirmed request', async () => {
  const w = await setup(); await edit(w); await w.get(roleButton('department_manager')).trigger('click')
  expect(updateAccountAccess).not.toHaveBeenCalled()
  expect(w.find('tbody').text()).toContain('外贸业务员')
  await submit(w)
  expect(updateAccountAccess).toHaveBeenCalledExactlyOnceWith('u1', { accountRole: 'department_manager', businessScope: { role: 'department_manager', departmentId: 'd1', employeeId: 'e1' }, workbenchRoles: [...workbenchRoles] })
  expect(w.find('.account-access-dialog').exists()).toBe(false)
  expect(w.find('tbody').text()).toContain('部门经理')
  expect(w.get('[role=status]').text()).toContain('已保存')
})
it('retains failed drafts and permits retry without partial list updates', async () => {
  const w = await setup(); await edit(w); await w.get(roleButton('collaboration')).trigger('click')
  vi.mocked(updateAccountAccess).mockRejectedValueOnce(new Error('Forbidden')); await submit(w)
  expect(w.get('[role=alert]').text()).toContain('保存失败')
  expect(w.find('tbody').text()).toContain('外贸业务员')
  expect(w.get('[data-save-access]').attributes('disabled')).toBeUndefined()
  await submit(w); expect(w.find('tbody').text()).toContain('协同管理岗')
})
it('discards cancelled edits', async () => {
  const w = await setup(); await edit(w); await w.get(roleButton('administrator')).trigger('click'); await w.get('.access-close').trigger('click')
  expect(updateAccountAccess).not.toHaveBeenCalled()
  await edit(w); expect(w.get(roleButton('salesperson')).attributes('aria-pressed')).toBe('true')
})
it('validates assignments and preserves external FOP IDs', async () => {
  current.employee = null; current.businessScope = { role: 'admin', departmentId: null, employeeId: 'FOP-0001' }
  const w = await setup(); await edit(w); await w.get(roleButton('department_manager')).trigger('click'); await submit(w)
  expect(w.get('[role=alert]').text()).toContain('请补全'); expect(updateAccountAccess).not.toHaveBeenCalled()
  await w.get('input[aria-label="业务部门 ID"]').setValue(' FOP-D1 '); await submit(w)
  expect(updateAccountAccess).toHaveBeenCalledWith('u1', expect.objectContaining({ businessScope: { role: 'department_manager', departmentId: 'FOP-D1', employeeId: 'FOP-0001' } }))
})
it('preserves HR closed access and independent admin business scope', async () => {
  current.businessScope = { role: 'none', departmentId: 'd1', employeeId: 'e1' }; current.workbenchRoles = []
  const w = await setup(); await edit(w)
  expect(w.get('[aria-label="开通业务数据"]').element).toHaveProperty('checked', false)
  expect(w.get('[data-save-access]').attributes('disabled')).toBeDefined()
  await w.get(roleButton('administrator')).trigger('click'); await w.get('[aria-label="业务数据范围"]').setValue('none'); await submit(w)
  expect(updateAccountAccess).toHaveBeenCalledWith('u1', expect.objectContaining({ accountRole: 'administrator', businessScope: { role: 'none', departmentId: 'd1', employeeId: 'e1' } }))
})
it('disables self-demotion', async () => {
  current.role = 'admin'; current.businessScope!.role = 'admin'
  const w = await setup(true); await edit(w)
  expect(w.get(roleButton('collaboration')).attributes('disabled')).toBeDefined()
  expect(w.get(roleButton('administrator')).attributes('disabled')).toBeUndefined()
})
it('filters on the server with pagination reset', async () => {
  const w = await setup(); await w.get('input[type=search]').setValue('Alice'); await w.get('[data-filter-role="collaboration"]').trigger('click'); await flushPromises()
  expect(getWorkbenchAccounts).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, search: 'Alice', accountRole: 'collaboration' })
})
it('preserves custom workbench grants when role stays unchanged', async () => {
  const w = await setup(); await edit(w); await w.get('input[value=warehouse]').setValue(false); await submit(w)
  expect(updateAccountAccess).toHaveBeenCalledWith('u1', expect.objectContaining({ workbenchRoles: workbenchRoles.filter(role => role !== 'warehouse') }))
})
it('keeps detailed chart configuration available', async () => {
  vi.mocked(updateChartPermissions).mockImplementation(async (_id, chartPermissions) => ({ ...current, chartPermissions }))
  const w = await setup(); await edit(w); await w.get('[data-chart-permissions]').trigger('click'); await flushPromises()
  expect(w.find('.account-access-dialog').exists()).toBe(false)
  const row = w.get('[data-chart-id="order_volume"]')
  await row.get('[aria-label="图表可见性"]').setValue('allow'); await row.get('[aria-label="记录范围"]').setValue('self'); await row.get('[aria-label="组织汇总"]').setValue('selected'); await flushPromises(); await w.get('[data-chart-id="order_volume"] input[value="sales2"]').setValue(true); await row.get('[aria-label="明细权限"]').setValue('deny'); await row.get('[aria-label="导出权限"]').setValue('allow')
  await w.get('[data-save-chart-permissions]').trigger('click'); await flushPromises()
  expect(updateChartPermissions).toHaveBeenCalledWith('u1', expect.arrayContaining([{ chartId: 'order_volume', visibility: 'allow', dataScope: 'self', summaryMode: 'selected', summaryDepartments: ['sales2'], details: 'deny', export: 'allow' }]))
})
it('ignores late saves after a session reset', async () => {
  let finish!: (account: WorkbenchAccount) => void
  vi.mocked(updateAccountAccess).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const w = await setup(); await edit(w); await w.get(roleButton('department_manager')).trigger('click'); await submit(w)
  invalidateSession(); await flushPromises(); finish({ ...current }); await flushPromises()
  expect(w.find('.account-access-dialog').exists()).toBe(false)
  expect(w.find('[role=status]').exists()).toBe(false)
  expect(w.find('tbody').text()).not.toContain('Alice')
})

it('routes unverified FOP bindings to organization without raw identity editing', async () => {
  current.fopBinding = { tenantId: 'offline', userId: 'employee-legacy' }
  const w = await setup()
  expect(w.text()).toContain('原绑定需要重新验证')
  expect(w.find('[data-save-binding]').exists()).toBe(false)
  expect(w.find('input[aria-label*="FOP"]').exists()).toBe(false)
  expect(w.findAllComponents(RouterLinkStub).some(link => JSON.stringify(link.props('to')).includes('accountId'))).toBe(true)
})

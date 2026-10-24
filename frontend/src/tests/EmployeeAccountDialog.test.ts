import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmployeeAccountDialog from '@/components/admin/EmployeeAccountDialog.vue'
import * as api from '@/api/organization'
vi.mock('@/api/organization', () => ({ getOrganization: vi.fn(), createOrganizationEmployee: vi.fn(), createEmployeeAccount: vi.fn(), updateOrganizationEmployee: vi.fn() }))
const workspace: api.OrganizationWorkspace = { source: 'mock', canEdit: true, nodes: [
  { id: 'root', name: 'HyperZone', parentId: null, kind: 'organization', sortOrder: 0 },
  { id: 'sales', name: '业务一部', parentId: 'root', kind: 'department', sortOrder: 1 },
], employees: [] }
const member: api.OrganizationEmployee = { id: 'e1', name: '员工甲（Amy）', code: 'HZ101', email: 'amy@example.test', departmentId: 'sales', workbenchRoles: ['sales'], accountId: 'u1' }
async function setup(employee?: api.OrganizationEmployee) {
  const wrapper = mount(EmployeeAccountDialog, { props: { workspace, departmentId: 'sales', employee }, global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { teleport: true } } })
  await flushPromises(); return wrapper
}
describe('employee and login provisioning', () => {
  beforeEach(() => vi.resetAllMocks())
  it('creates an employee account with department, roles and optional binding only after confirmation', async () => {
    const wrapper = await setup()
    await wrapper.get('[aria-label="员工姓名"]').setValue(member.name)
    await wrapper.get('[aria-label="员工编号"]').setValue(member.code)
    await wrapper.get('[aria-label="员工邮箱"]').setValue(member.email)
    await wrapper.get('[aria-label="登录名称"]').setValue('amy')
    await wrapper.get('[aria-label="初始密码"]').setValue('EmployeeLocal123')
    await wrapper.get('[aria-label="确认初始密码"]').setValue('DifferentPassword')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('两次密码')
    expect(api.createOrganizationEmployee).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="确认初始密码"]').setValue('EmployeeLocal123')
    await wrapper.get('[aria-label="同时绑定 FOP 用户"]').setValue(true)
    await wrapper.get('[aria-label="FOP 租户 ID"]').setValue('tenant')
    await wrapper.get('[aria-label="FOP 用户 ID"]').setValue('fop-amy')
    vi.mocked(api.createOrganizationEmployee).mockResolvedValue({ ...workspace, employees: [member] })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.createOrganizationEmployee).toHaveBeenCalledWith({ name: member.name, code: member.code, email: member.email, departmentId: 'sales', workbenchRoles: ['sales'], jobTitle: '', phone: '', account: { username: 'amy', password: 'EmployeeLocal123', fopBinding: { tenantId: 'tenant', userId: 'fop-amy' } } })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ employee: member })
    expect((wrapper.get('[aria-label="初始密码"]').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
  it('can create a directory employee without a login and reports a duplicate without dismissing', async () => {
    const wrapper = await setup()
    await wrapper.get('[aria-label="员工姓名"]').setValue(member.name)
    await wrapper.get('[aria-label="员工编号"]').setValue(member.code)
    await wrapper.get('[aria-label="员工邮箱"]').setValue(member.email)
    await wrapper.get('[aria-label="同时开通登录账号"]').setValue(false)
    expect(wrapper.find('[aria-label="初始密码"]').exists()).toBe(false)
    vi.mocked(api.createOrganizationEmployee).mockRejectedValue({ statusCode: 409, message: '员工编号已存在' })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('员工编号已存在')
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(api.createOrganizationEmployee).toHaveBeenCalledWith(expect.objectContaining({ account: null }))
    wrapper.unmount()
  })
  it('opens a login for an existing employee without duplicating their directory record', async () => {
    const wrapper = await setup({ ...member, accountId: null })
    await wrapper.get('[aria-label="登录名称"]').setValue('amy')
    await wrapper.get('[aria-label="初始密码"]').setValue('EmployeeLocal123')
    await wrapper.get('[aria-label="确认初始密码"]').setValue('EmployeeLocal123')
    vi.mocked(api.createEmployeeAccount).mockResolvedValue({ ...workspace, employees: [member] })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.createEmployeeAccount).toHaveBeenCalledWith('e1', { username: 'amy', password: 'EmployeeLocal123', fopBinding: null })
    expect(api.createOrganizationEmployee).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })
})

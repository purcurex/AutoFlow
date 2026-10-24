import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EmployeeImportDialog from '@/components/admin/EmployeeImportDialog.vue'
import EmployeeLoginDialog from '@/components/admin/EmployeeLoginDialog.vue'
import * as api from '@/api/organization'
vi.mock('@/api/organization', () => ({ previewOrganizationImport: vi.fn(), importOrganizationEmployees: vi.fn(), getEmployeeLogin: vi.fn(), updateEmployeeLogin: vi.fn() }))
const global = () => ({ plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { teleport: true } })
describe('organization member administration dialogs', () => {
  beforeEach(() => vi.resetAllMocks())
  it('previews selected department import and blocks invalid rows before committing', async () => {
    const wrapper = mount(EmployeeImportDialog, { props: { departmentId: 'sales', departmentName: '业务一部' }, global: global() })
    const input = wrapper.get('input[type=file]'), file = new File(['姓名,员工编号,邮箱,职务,手机'], 'members.csv')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    const employees = [{ name: 'Amy', code: 'E01', email: 'amy@example.test' }]
    vi.mocked(api.previewOrganizationImport).mockResolvedValueOnce({ employees, rowNumbers: [2], errors: [{ row: 2, message: '重复编号' }] }).mockResolvedValueOnce({ employees, rowNumbers: [2], errors: [] })
    await input.trigger('change'); await flushPromises()
    expect(api.previewOrganizationImport).toHaveBeenCalledWith('sales', file)
    expect(wrapper.get('[role=alert]').text()).toContain('第2行')
    const submit = () => wrapper.findAll('button').find(button => button.text() === '确认导入')!
    expect(submit().attributes('disabled')).toBeDefined()
    await input.trigger('change'); await flushPromises()
    vi.mocked(api.importOrganizationEmployees).mockResolvedValue({ source: 'mock', canEdit: true, nodes: [], employees: [] })
    await submit().trigger('click'); await flushPromises()
    expect(api.importOrganizationEmployees).toHaveBeenCalledWith('sales', employees)
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })
  it('edits login and FOP identity without sending access grants and validates a password reset', async () => {
    vi.mocked(api.getEmployeeLogin).mockResolvedValue({ id: 'user', username: 'Amy', email: 'amy@example.test', fopBinding: null })
    const wrapper = mount(EmployeeLoginDialog, { props: { accountId: 'user' }, global: global() }); await flushPromises()
    await wrapper.get('[aria-label="新密码"]').setValue('NewPassword123')
    await wrapper.get('[aria-label="确认新密码"]').setValue('wrong')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.updateEmployeeLogin).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('两次输入需一致')
    await wrapper.get('[aria-label="确认新密码"]').setValue('NewPassword123')
    await wrapper.get('[aria-label="FOP 租户 ID"]').setValue('tenant')
    await wrapper.get('[aria-label="FOP 用户 ID"]').setValue('fop-amy')
    vi.mocked(api.updateEmployeeLogin).mockResolvedValue({ id: 'user', username: 'Amy', email: 'amy@example.test', fopBinding: { tenantId: 'tenant', userId: 'fop-amy' } })
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(api.updateEmployeeLogin).toHaveBeenCalledWith('user', { username: 'Amy', email: 'amy@example.test', password: 'NewPassword123', fopBinding: { tenantId: 'tenant', userId: 'fop-amy' } })
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })
})

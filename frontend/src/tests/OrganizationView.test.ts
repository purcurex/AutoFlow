import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganizationView from '@/views/OrganizationView.vue'
import * as organization from '@/api/organization'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/api/organization', () => ({ getOrganization: vi.fn(), createOrganizationNode: vi.fn(), updateOrganizationNode: vi.fn(), deleteOrganizationNode: vi.fn(), moveOrganizationEmployee: vi.fn(), removeOrganizationEmployees: vi.fn() }))
const initial: organization.OrganizationWorkspace = {
  source: 'mock', canEdit: true,
  nodes: [
    { id: 'root', parentId: null, name: 'HyperZone', kind: 'organization', sortOrder: 0 },
    { id: 'sales', parentId: 'root', name: '营销中心', kind: 'department', sortOrder: 10 },
    { id: 'team', parentId: 'sales', name: '业务一部', kind: 'department', sortOrder: 10 },
    { id: 'ops', parentId: 'root', name: '运营中心', kind: 'department', sortOrder: 20 },
  ],
  employees: [{ id: 'alice', name: '林晓', code: 'HZ001', email: 'lin@example.test', departmentId: 'team', workbenchRoles: ['sales'] }],
}
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/organization', component: OrganizationView }] })
  await router.push('/organization')
  const wrapper = mount(OrganizationView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })], stubs: { teleport: true } } })
  await flushPromises()
  return wrapper
}
describe('organization designer', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(organization.getOrganization).mockResolvedValue(structuredClone(initial)) })
  it('shows nested organization and members, prevents selecting descendants as parents', async () => {
    const wrapper = await setup()
    expect(wrapper.findAll('[role=treeitem]')).toHaveLength(4)
    expect(wrapper.text()).toContain('林晓')
    await wrapper.find('[data-node=sales]').trigger('click')
    const parentOptions = wrapper.find('select[aria-label="上级部门"]').findAll('option').map(option => option.attributes('value'))
    expect(parentOptions).toEqual(['root', 'ops'])
    expect(wrapper.findAll('button').find(button => button.text() === '删除部门')!.attributes('disabled')).toBeDefined()
    await wrapper.find('input[type=search]').setValue('业务一部')
    expect(wrapper.findAll('[role=treeitem]')).toHaveLength(3)
    wrapper.unmount()
  })
  it('persists a custom child and keeps edits pending after a server rejection', async () => {
    const wrapper = await setup()
    await wrapper.find('[data-node=ops]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '新增子部门')!.trigger('click')
    await wrapper.find('input[aria-label="部门名称"]').setValue('客户成功组')
    const next = structuredClone(initial)
    next.nodes.push({ id: 'custom', parentId: 'ops', name: '客户成功组', kind: 'department', sortOrder: 10 })
    vi.mocked(organization.createOrganizationNode).mockResolvedValue(next)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(organization.createOrganizationNode).toHaveBeenCalledWith({ parentId: 'ops', name: '客户成功组', sortOrder: 10 })
    expect(wrapper.find('[data-node=custom]').exists()).toBe(true)
    await wrapper.find('input[aria-label="部门名称"]').setValue('新名字')
    vi.mocked(organization.updateOrganizationNode).mockRejectedValue({ statusCode: 409 })
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role=alert]').text()).toContain('无法保存')
    expect(wrapper.find('[data-node=custom]').text()).toBe('客户成功组')
    wrapper.unmount()
  })
  it('moves a demo employee using the server response and deletes only an empty department', async () => {
    const wrapper = await setup()
    const moved = structuredClone(initial)
    moved.employees[0]!.departmentId = 'ops'
    vi.mocked(organization.moveOrganizationEmployee).mockResolvedValue(moved)
    await wrapper.find('select[aria-label="林晓 · 所属部门"]').setValue('ops')
    await flushPromises()
    expect(organization.moveOrganizationEmployee).toHaveBeenCalledWith('alice', 'ops')
    await wrapper.find('[data-node=team]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '删除部门')!.trigger('click')
    expect(organization.deleteOrganizationNode).not.toHaveBeenCalled()
    vi.mocked(organization.deleteOrganizationNode).mockResolvedValue({ ...moved, nodes: moved.nodes.filter(node => node.id !== 'team') })
    await wrapper.findAll('button').find(button => button.text() === '确认删除')!.trigger('click')
    await flushPromises()
    expect(organization.deleteOrganizationNode).toHaveBeenCalledWith('team')
    expect(wrapper.find('[data-node=team]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('lets administrators cancel deletion and keeps the department after a server conflict', async () => {
    const wrapper = await setup()
    await wrapper.find('[data-node=ops]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === '删除部门')!.trigger('click')
    await wrapper.get('[data-action=cancel-delete]').trigger('click')
    expect(wrapper.text()).not.toContain('确认删除空部门')
    expect(organization.deleteOrganizationNode).not.toHaveBeenCalled()
    await wrapper.findAll('button').find(button => button.text() === '删除部门')!.trigger('click')
    vi.mocked(organization.deleteOrganizationNode).mockRejectedValue({ statusCode: 409 })
    await wrapper.findAll('button').find(button => button.text() === '确认删除')!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-node=ops]').exists()).toBe(true)
    expect(wrapper.find('[role=alert]').text()).toContain('删除失败')
    expect(wrapper.find('[role=status]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('hides deletion for a read-only account and the root organization', async () => {
    const readOnly = { ...structuredClone(initial), canEdit: false }
    vi.mocked(organization.getOrganization).mockResolvedValue(readOnly)
    const wrapper = await setup()
    await wrapper.find('[data-node=ops]').trigger('click')
    expect(wrapper.text()).not.toContain('删除部门')
    expect(wrapper.text()).not.toContain('新增子部门')
    wrapper.unmount()
    vi.mocked(organization.getOrganization).mockResolvedValue(structuredClone(initial))
    const admin = await setup()
    expect(admin.text()).not.toContain('删除部门')
    admin.unmount()
  })
  it('adds members from the chosen department, edits a member and confirms selected removal', async () => {
    const wrapper = await setup()
    expect(wrapper.get('[data-add-member]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-node=team]').trigger('click')
    await wrapper.get('[data-add-member]').trigger('click')
    expect(wrapper.get('select[aria-label="所属部门"]').element).toHaveProperty('value', 'team')
    await wrapper.get('button[aria-label="关闭"]').trigger('click')
    await wrapper.get('[data-edit-member]').trigger('click')
    expect(wrapper.get('input[aria-label="员工姓名"]').element).toHaveProperty('value', '林晓')
    expect(wrapper.get('input[aria-label="员工姓名"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('button[aria-label="关闭"]').trigger('click')
    await wrapper.get('input[aria-label="选择 林晓"]').setValue(true)
    await wrapper.get('[data-remove-selected]').trigger('click')
    expect(organization.removeOrganizationEmployees).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('历史业务记录保留')
    vi.mocked(organization.removeOrganizationEmployees).mockRejectedValueOnce({ statusCode: 409, message: '不能删除系统管理员成员' }).mockResolvedValueOnce({ ...structuredClone(initial), employees: [] })
    await wrapper.get('[data-confirm-remove-members]').trigger('click'); await flushPromises()
    expect(wrapper.get('[role=alert]').text()).toContain('不能删除系统管理员')
    await wrapper.get('[data-confirm-remove-members]').trigger('click'); await flushPromises()
    expect(organization.removeOrganizationEmployees).toHaveBeenLastCalledWith(['alice'])
    expect(wrapper.find('[data-member-id=alice]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('clears checked members after a department move and caps selection at 100', async () => {
    const wrapper = await setup()
    await wrapper.get('[data-node=team]').trigger('click')
    await wrapper.get('input[aria-label="选择 林晓"]').setValue(true)
    const moved = structuredClone(initial); moved.employees[0]!.departmentId = 'ops'
    vi.mocked(organization.moveOrganizationEmployee).mockResolvedValue(moved)
    await wrapper.get('select[aria-label="林晓 · 所属部门"]').setValue('ops'); await flushPromises()
    expect(wrapper.get('[data-remove-selected]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
    const many = structuredClone(initial); many.employees = Array.from({ length: 101 }, (_, i) => ({ ...initial.employees[0]!, id: `e${i}`, name: `成员${i}` }))
    vi.mocked(organization.getOrganization).mockResolvedValue(many)
    const bulk = await setup()
    await bulk.get('input[aria-label="选择前100名成员"]').setValue(true)
    expect(bulk.findAll('tbody input[type=checkbox]').filter(input => (input.element as HTMLInputElement).checked)).toHaveLength(100)
    expect(bulk.get('input[aria-label="选择 成员100"]').attributes('disabled')).toBeDefined()
    bulk.unmount()
  })

})

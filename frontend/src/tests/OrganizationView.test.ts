import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrganizationView from '@/views/OrganizationView.vue'
import * as organization from '@/api/organization'

vi.mock('@/components/layout', () => ({ AppLayout: { template: '<div><slot /></div>' } }))
vi.mock('@/api/organization', () => ({ getOrganization: vi.fn(), createOrganizationNode: vi.fn(), updateOrganizationNode: vi.fn(), deleteOrganizationNode: vi.fn(), moveOrganizationEmployee: vi.fn() }))
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
  const wrapper = mount(OrganizationView, { global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
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
})

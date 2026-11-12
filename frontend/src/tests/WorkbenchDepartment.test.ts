import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import WorkbenchFilterSummary from '@/components/WorkbenchFilterSummary.vue'
import { clearWorkbenchAccess, useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { invalidateSession } from '@/utils/session'

afterEach(clearWorkbenchAccess)
it('updates scope labels with account changes and preserves explicit department filters', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: WorkbenchFilterSummary }] })
  await router.push('/')
  const { access } = useWorkbenchAccess()
  access.value = { roles: ['sales'], isAdmin: false, businessRole: 'salesperson', businessDepartment: { id: 'd1', name: '业务一部' } }
  const wrapper = mount(WorkbenchFilterSummary, { props: { queue: 'review', labels: { d2: '业务二部', external: '业务一部' } }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  try {
    expect(wrapper.text()).toContain('业务部门：业务一部')
    for (const isAdmin of [false, true]) {
      access.value = { roles: ['sales'], isAdmin, businessRole: 'admin', businessDepartment: null }
      await flushPromises()
      expect(wrapper.text()).toContain('业务部门：营销中心')
    }
    await router.push('/?departmentId=d2'); await flushPromises()
    expect(wrapper.text()).toContain('业务部门：业务二部')
    access.value = { roles: ['sales'], isAdmin: true, businessRole: 'department_manager', businessDepartment: { id: 'external', name: null } }
    await router.push('/'); await flushPromises()
    expect(wrapper.text()).toContain('业务部门：业务一部')
    await wrapper.setProps({ labels: { external: '信息管理部' } })
    expect(wrapper.text()).toContain('业务部门：本部门')
    expect(wrapper.text()).not.toContain('信息管理部')
    await wrapper.setProps({ labels: {} })
    expect(wrapper.text()).toContain('业务部门：本部门')
    invalidateSession(); await flushPromises()
    expect(wrapper.text()).not.toContain('信息管理部')
    expect(access.value).toBeUndefined()
  } finally { wrapper.unmount() }
})

it('shows Marketing for collaborative roles and removes non-business or duplicate default choices', async () => {
  const { defineComponent } = await import('vue')
  const { useWorkbenchDepartment } = await import('@/composables/useWorkbenchDepartment')
  const rows = [{id:'ops',name:'物流管理'},{id:'s4',name:'业务四部'},{id:'marketing',name:'营销中心'},{id:'s2',name:'业务二部'},{id:'it',name:'信息管理部'},{id:'s1',name:'业务一部'},{id:'s3',name:'业务三部'}]
  const Probe = defineComponent({ setup() { return { ...useWorkbenchDepartment(), rows } }, template: '<select><option :value="defaultDepartmentValue(rows, undefined)">{{ defaultDepartmentLabel }}</option><option v-for="d in departmentOptions(rows)" :key="d.id" :value="d.id">{{ d.name }}</option></select>' })
  const { access } = useWorkbenchAccess()
  access.value = {roles:['procurement'],isAdmin:false,businessRole:'admin',businessDepartment:{id:'ops',name:'物流管理'}}
  const wrapper=mount(Probe,{global:{plugins:[createI18n({legacy:false,locale:'zh-CN',messages:{}})]}})
  try {
    expect(wrapper.findAll('option').map(o=>o.text())).toEqual(['营销中心','业务一部','业务二部','业务三部','业务四部'])
    access.value={roles:['sales'],isAdmin:false,businessRole:'salesperson',businessDepartment:{id:'s1',name:'业务一部'}}
    await flushPromises()
    expect(wrapper.findAll('option').map(o=>o.text())).toEqual(['业务一部','业务二部','业务三部','业务四部'])
    // Server supplies only the authorized department for ordinary sales users; this helper never adds options.
    expect(wrapper.text()).not.toContain('物流管理')
    access.value={roles:['sales'],isAdmin:false,businessRole:'department_manager',businessDepartment:{id:'ops',name:'物流管理'}}
    await flushPromises()
    expect(wrapper.find('option').text()).toBe('本部门')
    expect(wrapper.text()).not.toContain('物流管理')
  } finally {wrapper.unmount()}
})

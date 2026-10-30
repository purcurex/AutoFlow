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
  const wrapper = mount(WorkbenchFilterSummary, { props: { queue: 'review', labels: { d2: '业务二部', external: 'FOP业务一部' } }, global: { plugins: [router, createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
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
    expect(wrapper.text()).toContain('业务部门：FOP业务一部')
    await wrapper.setProps({ labels: {} })
    expect(wrapper.text()).toContain('业务部门：本部门')
    invalidateSession(); await flushPromises()
    expect(wrapper.text()).not.toContain('FOP业务一部')
    expect(access.value).toBeUndefined()
  } finally { wrapper.unmount() }
})

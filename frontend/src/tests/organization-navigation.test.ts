import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '@/components/layout/Sidebar.vue'
import { i18n } from '@/i18n'
import { useUserStore } from '@/stores/user'
import { clearWorkbenchAccess, refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { getWorkbenchAccess } from '@/api/workbench-access'
import type { User } from '@/types'

vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn() }))

describe('organization management navigation', () => {
  beforeEach(clearWorkbenchAccess)

  it.each([{ isAdmin: true, businessRole: 'admin' }, { isAdmin: true, businessRole: 'none' }, { isAdmin: false, businessRole: 'salesperson' }, { isAdmin: false, businessRole: 'department_manager' }, { isAdmin: false, businessRole: 'admin' }, { isAdmin: false, businessRole: 'none' }] as const)('shows management only for system administrators: %o', async ({ isAdmin, businessRole }) => {
    const pinia = createPinia()
    const user = useUserStore(pinia)
    // A stale or tampered local administrator role cannot override server grants.
    user.user = { role: 'admin', businessRole: 'admin' } as User
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: [], isAdmin, businessRole })
    await refreshWorkbenchAccess()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/')
    const wrapper = mount(Sidebar, { props: { collapsed: false }, global: { plugins: [pinia, router, i18n] } })
    expect(wrapper.find('nav a[href="/organization"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/organization"]').exists()).toBe(isAdmin)
    expect(wrapper.find('a[href="/admin/workbenches"]').exists()).toBe(isAdmin)
    if (isAdmin) {
      expect(wrapper.find('[data-management-nav] a[href="/organization"]').exists()).toBe(true)
      expect(wrapper.find('[data-management-nav]').findAll('a').map(link => link.attributes('href'))).toEqual(['/organization', '/admin/workbenches'])
    }
    wrapper.unmount()
  })
})

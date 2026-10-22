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

  it.each([false, true])('shows the bottom management group only with system management rights: %s', async isAdmin => {
    const pinia = createPinia()
    const user = useUserStore(pinia)
    // A stale or tampered local administrator role cannot override server grants.
    user.user = { role: 'admin', businessRole: 'admin' } as User
    vi.mocked(getWorkbenchAccess).mockResolvedValue({ roles: [], isAdmin, businessRole: isAdmin ? 'none' : 'admin' })
    await refreshWorkbenchAccess()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
    await router.push('/')
    const wrapper = mount(Sidebar, { props: { collapsed: false }, global: { plugins: [pinia, router, i18n] } })
    expect(wrapper.find('nav a[href="/organization"]').exists()).toBe(false)
    expect(wrapper.find('a[href="/organization"]').exists()).toBe(isAdmin)
    if (isAdmin) {
      expect(wrapper.find('[data-management-nav] a[href="/organization"]').exists()).toBe(true)
      expect(wrapper.findAll('a').at(-1)?.attributes('href')).toBe('/organization')
    }
    wrapper.unmount()
  })
})

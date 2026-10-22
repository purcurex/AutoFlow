import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminView from '@/views/AdminView.vue'
import router from '@/router'
import { i18n } from '@/i18n'

const { adminGetAll } = vi.hoisted(() => ({ adminGetAll: vi.fn() }))

vi.mock('@/api/notes', () => ({
  notesApi: {
    adminGetAll,
    adminDelete: vi.fn(),
  },
}))

vi.mock('@/api/workbench-access', () => ({ getWorkbenchAccess: vi.fn().mockResolvedValue({ roles: ['sales', 'procurement', 'allocation', 'dispatch', 'warehouse'], isAdmin: false }) }))

describe('security and compatibility routing', () => {
  beforeEach(async () => {
    localStorage.clear()
    adminGetAll.mockReset()
    await router.push('/login')
  })

  it('sanitizes stored rich text before rendering the admin preview', async () => {
    adminGetAll.mockResolvedValue([{
      id: 'note-1',
      userId: 'user-1',
      title: 'Unsafe record',
      content: '<img src=x onerror="window.hacked=true"><script>window.hacked=true</script><p>Safe text</p>',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      user: { username: 'admin', email: 'admin@autoflow.test' },
    }])

    const wrapper = mount(AdminView, {
      global: {
        plugins: [createPinia(), router, i18n],
        stubs: { AppLayout: { template: '<div><slot /></div>' } },
      },
    })
    await flushPromises()
    await wrapper.get('button.bg-blue-100').trigger('click')

    const html = wrapper.html()
    expect(html).toContain('Safe text')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script>')
  })

  it('rejects the admin route when the local user record is absent', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'user' }))

    await router.push('/admin')

    expect(router.currentRoute.value.name).toBe('Dashboard')
  })

  it('redirects the legacy CRM route to lightweight follow-up', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'user' }))

    await router.push('/crm')

    expect(router.currentRoute.value.name).toBe('FollowUps')
  })

  it('exposes AI prompt templates as an authenticated top-level route', async () => {
    localStorage.setItem('user', JSON.stringify({ role: 'user' }))

    await router.push('/prompt-templates')

    expect(router.currentRoute.value.name).toBe('PromptTemplates')
  })
})

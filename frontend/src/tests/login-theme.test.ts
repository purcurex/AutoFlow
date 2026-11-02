import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LoginView from '@/views/LoginView.vue'
import { useTheme } from '@/composables/useTheme'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'
import { i18n } from '@/i18n'

vi.mock('@/api/auth', () => ({ authApi: { login: vi.fn(), logout: vi.fn() } }))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.mocked(authApi.login).mockResolvedValue({ user: { id: 'theme-user', email: 'theme@example.com', username: 'Theme' } } as Awaited<ReturnType<typeof authApi.login>>)
  vi.mocked(authApi.logout).mockResolvedValue({ success: true })
})
afterEach(() => vi.clearAllMocks())

describe('login theme continuity', () => {
  it.each([false, true])('keeps the selected theme through login, refresh and logout (dark=%s)', async dark => {
    const theme = useTheme()
    theme.setTheme(dark)
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/login', component: LoginView },
      { path: '/', component: { template: '<div>Workspace</div>' } },
      { path: '/register', component: { template: '<div />' } },
    ] })
    await router.push('/login')
    const wrapper = mount(LoginView, { global: { plugins: [router, i18n] } })
    await wrapper.get('input[type="email"]').setValue('theme@example.com')
    await wrapper.get('input[type="password"]').setValue('test-password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
    expect(document.documentElement.classList.contains('dark')).toBe(dark)
    expect(localStorage.getItem('autoflow-theme')).toBe(dark ? 'dark' : 'light')
    await useUserStore().logout()
    expect(document.documentElement.classList.contains('dark')).toBe(dark)
    vi.resetModules()
    const freshTheme = await import('@/composables/useTheme')
    freshTheme.initializeTheme()
    expect(freshTheme.useTheme().isDark.value).toBe(dark)
    wrapper.unmount()
  })
})

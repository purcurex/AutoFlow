import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import api from '@/api'
import SettingsView from '@/views/SettingsView.vue'
import { i18n } from '@/i18n'

vi.mock('@/stores', async importOriginal => ({
  ...await importOriginal<typeof import('@/stores')>(),
  useUserStore: () => ({ user: { username: 'Admin', email: 'admin@example.test' }, fetchUser: async () => {} }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(() => vi.restoreAllMocks())

describe('personal settings after business record retirement', () => {
  it('keeps profile and appearance available without querying or offering retired records', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([])
    const wrapper = mount(SettingsView, { global: {
      plugins: [createPinia(), i18n],
      stubs: { AppLayout: { template: '<div><slot /></div>' }, AvatarPicker: true, LanguageSwitch: true },
    } })
    await flushPromises()
    expect(wrapper.findAll('input').map(input => input.element.value)).toEqual(['Admin', 'admin@example.test'])
    expect(wrapper.text()).toContain('界面偏好')
    expect(wrapper.text()).not.toContain('导出所有业务记录')
    expect(get.mock.calls.filter(([url]) => /^\/(notes|folders)(\/|$)/.test(url))).toEqual([])
    wrapper.unmount()
  })
})

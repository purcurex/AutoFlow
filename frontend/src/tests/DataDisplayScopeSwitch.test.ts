import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DataDisplayScopeSwitch from '@/components/layout/DataDisplayScopeSwitch.vue'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'
import { captureSession, isCurrentSession } from '@/utils/session'
import type { User } from '@/types'
vi.mock('@/api/auth', () => ({ authApi: { updateProfile: vi.fn(), getProfile: vi.fn() } }))
const manager = { id: 'manager', username: 'Manager', role: 'user', businessRole: 'department_manager', dataDisplayScope: 'department' } as User
function render() { return mount(DataDisplayScopeSwitch, { global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } }) }
beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); vi.clearAllMocks(); useUserStore().user = { ...manager } })
describe('global manager display switch', () => {
  it('persists the selection, resets business state, and keeps the authenticated manager', async () => {
    vi.mocked(authApi.updateProfile).mockResolvedValue({ ...manager, dataDisplayScope: 'self' })
    const epoch = captureSession(), wrapper = render()
    await wrapper.get('select').setValue('self'); await flushPromises()
    expect(authApi.updateProfile).toHaveBeenCalledWith({ dataDisplayScope: 'self' })
    expect(isCurrentSession(epoch)).toBe(false)
    expect(useUserStore().user).toMatchObject({ id: 'manager', businessRole: 'department_manager', dataDisplayScope: 'self' })
    expect(JSON.parse(localStorage.getItem('user')!).dataDisplayScope).toBe('self')
    wrapper.unmount()
  })
  it('retains the old scope and shows an error if persistence fails', async () => {
    vi.mocked(authApi.updateProfile).mockRejectedValue(new Error('offline'))
    const epoch = captureSession(), wrapper = render()
    await wrapper.get('select').setValue('self'); await flushPromises()
    expect(wrapper.get('select').element.value).toBe('department')
    expect(wrapper.get('[role=alert]').text()).toContain('保存失败')
    expect(isCurrentSession(epoch)).toBe(true)
    wrapper.unmount()
  })
  it('is hidden for non-manager accounts', () => {
    useUserStore().user = { ...manager, businessRole: 'salesperson' }
    const wrapper = render(); expect(wrapper.find('select').exists()).toBe(false); wrapper.unmount()
  })
  it('invalidates current business state on a same-account scope change in another tab', () => {
    const epoch = captureSession()
    window.dispatchEvent(new StorageEvent('storage', { key: 'user', oldValue: JSON.stringify(manager), newValue: JSON.stringify({ ...manager, dataDisplayScope: 'self' }) }))
    expect(isCurrentSession(epoch)).toBe(false)
  })
})


it('defaults an unset manager preference to personal and lets the manager save department', async () => {
  useUserStore().user = { ...manager, dataDisplayScope: undefined }
  vi.mocked(authApi.updateProfile).mockResolvedValue({ ...manager, dataDisplayScope: 'department' })
  const wrapper = render()
  expect(wrapper.get('select').element.value).toBe('self')
  await wrapper.get('select').setValue('department'); await flushPromises()
  expect(authApi.updateProfile).toHaveBeenCalledWith({ dataDisplayScope: 'department' })
  expect(useUserStore().user?.dataDisplayScope).toBe('department')
  wrapper.unmount()
})

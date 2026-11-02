import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import AvatarPicker from '@/components/ui/AvatarPicker.vue'
import { useUserStore } from '@/stores/user'
import { authApi } from '@/api/auth'
import { englishDisplayName } from '@/utils/user-display'
import type { User } from '@/types'

vi.mock('@/api/auth', () => ({ authApi: { updateProfile: vi.fn(), uploadAvatar: vi.fn() } }))
const account = { id: 'test', username: 'admin@hzdrop.com', email: 'admin@hzdrop.com', avatarUrl: '' } as User
beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks(); useUserStore().user = { ...account } })

it('shows a capitalized English name instead of the login email', () => {
  expect(englishDisplayName(account)).toBe('Admin')
  expect(englishDisplayName({ username: '中文名', email: 'ethan@hzdrop.com' })).toBe('Ethan')
  expect(englishDisplayName({ username: 'NORA' })).toBe('Nora')
  expect(englishDisplayName(null)).toBe('User')
})
it('persists a preset through the profile API and updates the active avatar', async () => {
  vi.mocked(authApi.updateProfile).mockResolvedValue({ ...account, avatarUrl: '/avatars/preset-mint.svg' })
  const wrapper = mount(AvatarPicker, { global: { plugins: [i18n] } })
  await wrapper.get('button[aria-label="青绿"]').trigger('click'); await flushPromises()
  expect(authApi.updateProfile).toHaveBeenCalledWith({ avatarUrl: '/avatars/preset-mint.svg' })
  expect(useUserStore().avatarUrl).toBe('/avatars/preset-mint.svg')
  expect(wrapper.get('button[aria-label="青绿"]').attributes('aria-pressed')).toBe('true')
  wrapper.unmount()
})
it('keeps the old avatar when saving fails and permits retry', async () => {
  vi.mocked(authApi.updateProfile).mockRejectedValue(new Error('offline'))
  const wrapper = mount(AvatarPicker, { global: { plugins: [i18n] } })
  await wrapper.get('button[aria-label="海蓝"]').trigger('click'); await flushPromises()
  expect(useUserStore().avatarUrl).toBeNull()
  expect(wrapper.get('[role="status"]').text()).toBe('保存失败')
  expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})
it('uploads a selected photo and rejects oversized files before sending', async () => {
  vi.mocked(authApi.uploadAvatar).mockResolvedValue({ ...account, avatarUrl: '/uploads/avatars/photo.png' })
  const wrapper = mount(AvatarPicker, { global: { plugins: [i18n] } })
  const input = wrapper.get('input[type="file"]')
  const photo = new File(['photo'], 'photo.png', { type: 'image/png' })
  Object.defineProperty(input.element, 'files', { value: [photo], configurable: true })
  await input.trigger('change'); await flushPromises()
  expect(authApi.uploadAvatar).toHaveBeenCalledWith(photo)
  const large = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
  Object.defineProperty(input.element, 'files', { value: [large], configurable: true })
  await input.trigger('change'); await flushPromises()
  expect(authApi.uploadAvatar).toHaveBeenCalledTimes(1)
  expect(wrapper.get('[role="status"]').text()).toContain('5 MB')
  wrapper.unmount()
})

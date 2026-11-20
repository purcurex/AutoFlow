import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { isValidAccountPassword } from '@/utils/account-password'
import RegisterView from '@/views/RegisterView.vue'
import { i18n } from '@/i18n'

const { register, push } = vi.hoisted(() => ({ register: vi.fn(), push: vi.fn() }))
vi.mock('@/stores', () => ({ useUserStore: () => ({ register }) }))
vi.mock('vue-router', async importOriginal => ({ ...await importOriginal<typeof import('vue-router')>(), useRouter: () => ({ push }) }))
const accepted = ['abc123', 'ABC123', '12345a', 'abc12!', ' a123 ', 'a1' + 'x'.repeat(70), 'a1中' + 'x'.repeat(67)]
const rejected: unknown[] = ['', 'ab123', 'abcdefghijk', '123456789012', 'a1' + 'x'.repeat(71), 'a1中' + 'x'.repeat(68), null, 123456]

describe('password entry policy', () => {
  beforeEach(() => { vi.clearAllMocks(); register.mockResolvedValue({}) })
  it('accepts letters and digits without a case or symbol requirement', () => {
    for (const password of accepted) expect(isValidAccountPassword(password)).toBe(true)
    for (const password of rejected) expect(isValidAccountPassword(password)).toBe(false)
  })
  it('validates registration before sending and submits a six-character password unchanged', async () => {
    const wrapper = mount(RegisterView, { global: { plugins: [i18n], stubs: { BrandLogo: true, LanguageSwitch: true, ThemeToggle: true, RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('test@example.invalid')
    await inputs[1]!.setValue('123456')
    await inputs[2]!.setValue('test-user')
    for (const password of ['123456', 'abcdef', 'ab123', 'a1中' + 'x'.repeat(68)]) {
      await inputs[3]!.setValue(password); await inputs[4]!.setValue(password)
      await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(register).not.toHaveBeenCalled()
    }
    await inputs[3]!.setValue('abc123'); await inputs[4]!.setValue('abc123')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(register).toHaveBeenCalledWith('test@example.invalid', 'test-user', 'abc123', '123456')
    expect(push).toHaveBeenCalledWith('/')
    wrapper.unmount()
  })
})

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n, setLocale } from '@/i18n'
import LanguageSwitch from '@/components/ui/LanguageSwitch.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'

describe('localization and theme preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('zh-CN')
    document.documentElement.classList.remove('dark')
  })

  it('switches between Simplified Chinese and English and persists the choice', async () => {
    const wrapper = mount(LanguageSwitch, { global: { plugins: [i18n] } })
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')
    await wrapper.get('button[role="menuitemradio"][aria-checked="false"]').trigger('click')

    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem('autoflow-locale')).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('shows the current locale once and only the alternative in the compact menu', async () => {
    const wrapper = mount(LanguageSwitch, { global: { plugins: [i18n] } })
    await wrapper.get('button[aria-haspopup="menu"]').trigger('click')

    expect(wrapper.findAll('[role="menuitemradio"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('简体中文')
    expect(wrapper.text()).toContain('English')
    expect(wrapper.findAll('img')).toHaveLength(2)
  })

  it('starts in dark mode and persists manual theme switching', async () => {
    const wrapper = mount(ThemeToggle, { global: { plugins: [i18n] } })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await wrapper.get('button').trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('autoflow-theme')).toBe('light')

    await wrapper.get('button').trigger('click')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('autoflow-theme')).toBe('dark')
  })

  it('separates discovery history from the lead review lifecycle', () => {
    expect(i18n.global.t('status.new')).toBe('待筛选')
    expect(i18n.global.t('leads.discovery_first_seen')).toBe('首次发现')
    expect(i18n.global.t('leads.discovery_seen_before', { count: 2 })).toBe('历史已发现 2 次')
  })

  it('uses Title Case for fixed two-word English UI phrases', () => {
    function collectStrings(value: unknown): string[] {
      if (typeof value === 'string') return [value]
      if (!value || typeof value !== 'object') return []
      return Object.values(value).flatMap(collectStrings)
    }

    const invalidPhrases = collectStrings(i18n.global.getLocaleMessage('en')).filter((value) => {
      if (/[.!?]$/.test(value.trim())) return false
      const withoutPlaceholders = value.replace(/\{[^}]+\}/g, '')
      const words = withoutPlaceholders.match(/[A-Za-z][A-Za-z-]*/g) || []
      return words.length === 2 && /^[a-z]/.test(words[1])
    })

    expect(invalidPhrases).toEqual([])
  })
})

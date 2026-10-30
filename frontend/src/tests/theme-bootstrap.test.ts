import bootstrap from '../../public/theme-init.js?raw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const runBootstrap = () => new Function('document', 'localStorage', bootstrap)(document, localStorage)

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.head.innerHTML = '<meta name="theme-color" content="#f5f7fa">'
})
afterEach(() => vi.restoreAllMocks())

it.each([
  [null, false], ['light', false], ['dark', true], ['invalid', false],
] as const)('restores %s before app startup and retains it at mount', async (saved, dark) => {
  if (saved !== null) localStorage.setItem('autoflow-theme', saved)
  runBootstrap()
  expect(document.documentElement.classList.contains('dark')).toBe(dark)
  expect(document.documentElement.style.colorScheme).toBe(dark ? 'dark' : 'light')
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(dark ? '#0d131d' : '#f5f7fa')
  const { useTheme } = await import('@/composables/useTheme')
  expect(useTheme().isDark.value).toBe(dark)
  expect(document.documentElement.classList.contains('dark')).toBe(dark)
})

it('allows startup and manual switching when storage is disabled', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  runBootstrap()
  const { useTheme } = await import('@/composables/useTheme')
  const theme = useTheme()
  expect(theme.isDark.value).toBe(false)
  theme.setTheme(true)
  expect(theme.isDark.value).toBe(true)
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})

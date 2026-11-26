import { computed, ref } from 'vue'

import palettes from '@/theme/palettes.json'
export type Palette = keyof typeof palettes
const palette = ref<Palette>('blue')
const isDark = ref(true)
let initialized = false

function applyTheme(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101720' : '#f5f7fa')
}
export function initializeTheme() {
  if (initialized) return
  initialized = true
  let dark = true
  try { dark = localStorage.getItem('autoflow-theme') !== 'light' } catch { /* Use the same dark default as the pre-paint script. */ }
  try { const saved = localStorage.getItem('autoflow-palette'); if (saved && Object.hasOwn(palettes, saved)) palette.value = saved as Palette } catch {}
  document.documentElement.dataset.palette = palette.value
  applyTheme(dark)
}

export function useTheme() {
  initializeTheme()

  function setTheme(dark: boolean) {
    applyTheme(dark)
    try {
      localStorage.setItem('autoflow-theme', dark ? 'dark' : 'light')
      localStorage.setItem('darkMode', String(dark))
    } catch { /* Theme switching still works when browser storage is unavailable. */ }
  }

  function setPalette(value: Palette) {
    if (!Object.hasOwn(palettes, value)) return
    palette.value = value
    document.documentElement.dataset.palette = value
    try { localStorage.setItem('autoflow-palette', value) } catch {}
  }

  return {
    palette: computed(() => palette.value),
    palettes,
    setPalette,
    isDark: computed(() => isDark.value),
    toggleTheme: () => setTheme(!isDark.value),
    setTheme,
  }
}

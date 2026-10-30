import { computed, ref } from 'vue'

const isDark = ref(false)
let initialized = false

function applyTheme(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d131d' : '#f5f7fa')
}
export function initializeTheme() {
  if (initialized) return
  initialized = true
  let dark = document.documentElement.classList.contains('dark')
  try { dark = localStorage.getItem('autoflow-theme') === 'dark' } catch { /* Keep the pre-paint theme when storage is unavailable. */ }
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

  return {
    isDark: computed(() => isDark.value),
    toggleTheme: () => setTheme(!isDark.value),
    setTheme,
  }
}

import { computed, ref } from 'vue'

const isDark = ref(false)
let initialized = false

function applyTheme(dark: boolean) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}
export function initializeTheme() {
  if (initialized) return
  initialized = true
  applyTheme(localStorage.getItem('autoflow-theme') === 'dark')
}

export function useTheme() {
  initializeTheme()

  function setTheme(dark: boolean) {
    applyTheme(dark)
    localStorage.setItem('autoflow-theme', dark ? 'dark' : 'light')
    localStorage.setItem('darkMode', String(dark))
  }

  return {
    isDark: computed(() => isDark.value),
    toggleTheme: () => setTheme(!isDark.value),
    setTheme,
  }
}

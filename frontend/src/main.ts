import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'
import { i18n, setLocale } from './i18n'
import { initializeTheme } from './composables/useTheme'
import { installExternalLinkPolicy } from './utils/externalLinks'

const app = createApp(App)

initializeTheme()
installExternalLinkPolicy()
setLocale(i18n.global.locale.value as 'zh-CN' | 'en')
app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')

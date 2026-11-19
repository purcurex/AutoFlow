import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'
import './theme/palettes.css'
import './theme/components.css'
import './styles/workbench-list.css'
import { i18n, setLocale } from './i18n'
import { initializeTheme } from './composables/useTheme'
import { installExternalLinkPolicy } from './utils/externalLinks'
import { installSelectDropdowns } from './utils/selectDropdowns'
import './styles/select-dropdowns.css'
import { installTextTooltips } from './utils/textTooltips'
import './styles/text-tooltips.css'

const app = createApp(App)

initializeTheme()
installExternalLinkPolicy()
setLocale(i18n.global.locale.value as 'zh-CN' | 'en')
app.use(createPinia())
app.use(router)
app.use(i18n)

app.mount('#app')
const disposeDropdowns = installSelectDropdowns(document.getElementById('app')!)
const disposeTextTooltips = installTextTooltips()
if (import.meta.hot) import.meta.hot.dispose(() => { disposeDropdowns(); disposeTextTooltips() })

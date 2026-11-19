<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Moon, Save, Sun, UserRound } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { LanguageSwitch, PageHeader } from '@/components/ui'
import { useTheme } from '@/composables/useTheme'
import AvatarPicker from '@/components/ui/AvatarPicker.vue'

const router = useRouter()
const userStore = useUserStore()
const { t } = useI18n()
const { isDark, setTheme, palette, palettes, setPalette } = useTheme()
const username = ref('')
const email = ref('')
const isSaving = ref(false)
const saveMessage = ref('')

onMounted(async () => {
  await userStore.fetchUser()
  if (userStore.user) { username.value = userStore.user.username; email.value = userStore.user.email }
})

async function updateProfile() {
  if (!username.value.trim()) { saveMessage.value = t('settings.usernameRequired'); return }
  isSaving.value = true; saveMessage.value = ''
  try { await userStore.updateProfile({ username: username.value }); saveMessage.value = t('settings.saved'); setTimeout(() => { saveMessage.value = '' }, 2000) }
  catch (error: unknown) { saveMessage.value = (error as { message?: string }).message || t('settings.saveFailed') }
  finally { isSaving.value = false }
}

function logout() { userStore.logout(); router.push('/login') }
</script>

<template>
  <AppLayout>
    <div class="app-page mx-auto max-w-5xl">
      <PageHeader :eyebrow="t('nav.settings')" :title="t('settings.title')" :description="t('settings.description')" />
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section class="panel overflow-hidden">
          <div class="panel-header"><div><h2 class="panel-title">{{ t('settings.profile') }}</h2></div><UserRound class="h-5 w-5 text-slate-400" /></div>
          <div class="space-y-5 p-5">
            <AvatarPicker />
            <label><span class="field-label">{{ t('settings.username') }}</span><input v-model="username" type="text" class="input" /></label>
            <label><span class="field-label">{{ t('settings.email') }}</span><input v-model="email" type="email" class="input cursor-not-allowed bg-slate-50 text-slate-500 dark:bg-[var(--color-surface)]" disabled /><span class="field-help">{{ t('settings.emailLocked') }}</span></label>
            <div class="flex flex-wrap items-center gap-3"><button class="btn btn-account" :disabled="isSaving" @click="updateProfile"><Save class="h-4 w-4" />{{ isSaving ? t('settings.saving') : t('settings.saveChanges') }}</button><span v-if="saveMessage" class="text-sm text-slate-600 dark:text-slate-300">{{ saveMessage }}</span></div>
          </div>
        </section>

        <div class="flex flex-col gap-5">
          <section class="panel overflow-hidden lg:flex-1"><div class="panel-header"><div><h2 class="panel-title">{{ t('settings.appearance') }}</h2></div></div><div class="space-y-5 p-5"><div><p class="field-label">{{ t('common.language') }}</p><LanguageSwitch class="w-full justify-between" /></div><div><p class="field-label">{{ t('settings.theme') }}</p><div class="theme-picker" aria-label="主题色系"><button v-for="(theme, key) in palettes" :key="key" type="button" class="theme-choice" :class="{ 'selection-active': palette === key }" :aria-pressed="palette === key" @click="setPalette(key)"><span class="theme-swatch" :style="{ background: theme[isDark ? 'dark' : 'light'][0] }"></span>{{ theme.name }}</button></div><div class="grid grid-cols-2 gap-2"><button class="flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold" :class="!isDark ? 'selection-active' : 'border-slate-200 text-slate-500 dark:border-slate-700'" @click="setTheme(false)"><Sun class="h-4 w-4" />{{ t('common.light') }}</button><button class="flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold" :class="isDark ? 'selection-active' : 'border-slate-200 text-slate-500 dark:border-slate-700'" @click="setTheme(true)"><Moon class="h-4 w-4" />{{ t('common.dark') }}</button></div></div></div></section>

          <section class="panel p-5"><h2 class="panel-title">{{ t('settings.account') }}</h2><button class="btn btn-account mt-4 w-full" @click="logout"><LogOut class="h-4 w-4" />{{ t('settings.logout') }}</button></section>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

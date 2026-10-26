<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Camera, Download, LogOut, Moon, Save, Sun, Upload, UserRound } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUserStore, useNoteStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { LanguageSwitch, PageHeader } from '@/components/ui'
import { useTheme } from '@/composables/useTheme'
import { exportNotesToPdf } from '@/utils/export'
import type { Note } from '@/types'

const router = useRouter()
const userStore = useUserStore()
const noteStore = useNoteStore()
const { t } = useI18n()
const { isDark, setTheme } = useTheme()
const username = ref('')
const email = ref('')
const isSaving = ref(false)
const isUploadingAvatar = ref(false)
const saveMessage = ref('')
const avatarInput = ref<HTMLInputElement | null>(null)
const isExporting = ref(false)

onMounted(async () => {
  await userStore.fetchUser()
  if (userStore.user) { username.value = userStore.user.username; email.value = userStore.user.email }
  await noteStore.fetchNotes()
})

async function updateProfile() {
  if (!username.value.trim()) { saveMessage.value = t('settings.usernameRequired'); return }
  isSaving.value = true; saveMessage.value = ''
  try { await userStore.updateProfile({ username: username.value }); saveMessage.value = t('settings.saved'); setTimeout(() => { saveMessage.value = '' }, 2000) }
  catch (error: unknown) { saveMessage.value = (error as { message?: string }).message || t('settings.saveFailed') }
  finally { isSaving.value = false }
}

function triggerAvatarUpload() { avatarInput.value?.click() }
async function handleAvatarChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.type.match(/image\/(jpg|jpeg|png|gif|webp)/)) { saveMessage.value = t('settings.invalidImage'); return }
  if (file.size > 5 * 1024 * 1024) { saveMessage.value = t('settings.imageTooLarge'); return }
  isUploadingAvatar.value = true; saveMessage.value = ''
  try { await userStore.uploadAvatar(file); saveMessage.value = t('settings.avatarSuccess'); setTimeout(() => { saveMessage.value = '' }, 2000) }
  catch (error: unknown) { saveMessage.value = (error as { message?: string }).message || t('settings.uploadFailed') }
  finally { isUploadingAvatar.value = false; input.value = '' }
}
function logout() { userStore.logout(); router.push('/login') }
async function exportAllNotes() {
  if (isExporting.value) return
  const notes = noteStore.notes as Note[]
  if (!notes?.length) { saveMessage.value = t('settings.noRecords'); setTimeout(() => { saveMessage.value = '' }, 2000); return }
  isExporting.value = true; saveMessage.value = ''
  try { await exportNotesToPdf(notes, userStore.user?.username); saveMessage.value = t('settings.exported', { count: notes.length }); setTimeout(() => { saveMessage.value = '' }, 3000) }
  catch { saveMessage.value = t('settings.exportFailed'); setTimeout(() => { saveMessage.value = '' }, 2000) }
  finally { isExporting.value = false }
}
</script>

<template>
  <AppLayout>
    <div class="app-page mx-auto max-w-5xl">
      <PageHeader :eyebrow="t('nav.settings')" :title="t('settings.title')" :description="t('settings.description')" />
      <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section class="panel overflow-hidden">
          <div class="panel-header"><div><h2 class="panel-title">{{ t('settings.profile') }}</h2><p class="panel-description">{{ t('settings.description') }}</p></div><UserRound class="h-5 w-5 text-slate-400" /></div>
          <div class="space-y-5 p-5">
            <div class="flex flex-col gap-5 border-b pb-5 sm:flex-row sm:items-center" style="border-color: var(--color-border)">
              <button class="group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-orange-600 text-2xl font-bold text-white" :disabled="isUploadingAvatar" @click="triggerAvatarUpload"><img v-if="userStore.avatarUrl" :src="userStore.avatarUrl" alt="Avatar" class="h-full w-full object-cover" /><span v-else>{{ (username || 'U').charAt(0).toUpperCase() }}</span><span class="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100"><Camera class="h-5 w-5" /></span></button>
              <div><p class="font-semibold text-slate-950 dark:text-white">{{ t('settings.avatar') }}</p><p class="mt-1 text-sm text-slate-500">{{ t('settings.avatarHint') }}</p><p class="mt-1 text-xs text-slate-400">{{ t('settings.avatarLimit') }}</p><input ref="avatarInput" type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" @change="handleAvatarChange" /></div>
            </div>
            <label><span class="field-label">{{ t('settings.username') }}</span><input v-model="username" type="text" class="input" /></label>
            <label><span class="field-label">{{ t('settings.email') }}</span><input v-model="email" type="email" class="input cursor-not-allowed bg-slate-50 text-slate-500 dark:bg-[#171b21]" disabled /><span class="field-help">{{ t('settings.emailLocked') }}</span></label>
            <div class="flex flex-wrap items-center gap-3"><button class="btn btn-primary" :disabled="isSaving" @click="updateProfile"><Save class="h-4 w-4" />{{ isSaving ? t('settings.saving') : t('settings.saveChanges') }}</button><span v-if="saveMessage" class="text-sm text-slate-600 dark:text-slate-300">{{ saveMessage }}</span></div>
          </div>
        </section>

        <div class="space-y-5">
          <section class="panel overflow-hidden"><div class="panel-header"><div><h2 class="panel-title">{{ t('settings.appearance') }}</h2><p class="panel-description">{{ t('settings.themeHint') }}</p></div></div><div class="space-y-5 p-5"><div><p class="field-label">{{ t('common.language') }}</p><LanguageSwitch class="w-full justify-between" /></div><div><p class="field-label">{{ t('settings.theme') }}</p><div class="grid grid-cols-2 gap-2"><button class="flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold" :class="!isDark ? 'selection-active' : 'border-slate-200 text-slate-500 dark:border-slate-700'" @click="setTheme(false)"><Sun class="h-4 w-4" />{{ t('common.light') }}</button><button class="flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-semibold" :class="isDark ? 'selection-active' : 'border-slate-200 text-slate-500 dark:border-slate-700'" @click="setTheme(true)"><Moon class="h-4 w-4" />{{ t('common.dark') }}</button></div></div></div></section>

          <section class="panel overflow-hidden"><div class="panel-header"><div><h2 class="panel-title">{{ t('settings.data') }}</h2></div></div><div class="space-y-2 p-5"><button class="btn btn-secondary w-full justify-start" :disabled="isExporting" @click="exportAllNotes"><Download class="h-4 w-4" />{{ isExporting ? t('settings.exporting') : t('settings.export') }}</button><button class="btn btn-secondary w-full justify-start" disabled><Upload class="h-4 w-4" />{{ t('settings.import') }} · {{ t('common.developing') }}</button></div></section>
          <section class="panel p-5"><h2 class="panel-title">{{ t('settings.account') }}</h2><button class="btn btn-danger mt-4 w-full" @click="logout"><LogOut class="h-4 w-4" />{{ t('settings.logout') }}</button></section>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

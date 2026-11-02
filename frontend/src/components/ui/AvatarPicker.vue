<script setup lang="ts">
import { ref } from 'vue'
import { Camera, Check } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import { PRESET_AVATARS } from '@/utils/user-display'

const userStore = useUserStore()
const { t, locale } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const text = (zh: string, en: string) => locale.value.startsWith('zh') ? zh : en
const presetSrc = (url: string) => `${import.meta.env.BASE_URL}${url.slice(1)}`

async function save(action: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true; message.value = ''; failed.value = false
  try { await action(); message.value = text('头像已更新', 'Avatar updated') }
  catch { failed.value = true; message.value = t('settings.saveFailed') }
  finally { busy.value = false }
}
async function upload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file || busy.value) return
  failed.value = true
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) { message.value = t('settings.invalidImage'); return }
  if (file.size > 5 * 1024 * 1024) { message.value = t('settings.imageTooLarge'); return }
  await save(() => userStore.uploadAvatar(file))
}
</script>

<template>
  <div class="space-y-4 border-b pb-5" style="border-color: var(--color-border)" :aria-busy="busy">
    <div class="flex items-center gap-4">
      <button type="button" class="group relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full brand-avatar text-xl font-semibold focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50" :aria-label="text('上传头像', 'Upload avatar')" :disabled="busy" @click="input?.click()">
        <img v-if="userStore.avatarUrl" :src="userStore.avatarUrl" alt="" class="h-full w-full object-cover" />
        <span v-else>{{ userStore.displayName.charAt(0) }}</span>
        <span class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Camera class="h-5 w-5" /></span>
      </button>
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-slate-950 dark:text-white">{{ userStore.displayName }}</p>
        <button type="button" class="mt-1 text-sm font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400" :disabled="busy" @click="input?.click()">{{ busy ? t('settings.saving') : text('上传头像', 'Upload avatar') }}</button>
        <p class="mt-1 text-xs text-slate-500">JPG / PNG / GIF / WebP · {{ t('settings.avatarLimit') }}</p>
      </div>
      <input ref="input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" :disabled="busy" @change="upload" />
    </div>
    <fieldset :disabled="busy">
      <legend class="mb-2.5 text-xs text-slate-500">{{ text('或选择预置头像', 'Or choose a preset') }}</legend>
      <div class="flex flex-wrap gap-3">
        <button v-for="avatar in PRESET_AVATARS" :key="avatar.id" type="button" class="relative h-11 w-11 rounded-full ring-2 ring-offset-2 ring-offset-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500 disabled:opacity-50 dark:ring-offset-[#15181d]" :class="userStore.user?.avatarUrl === avatar.url ? 'ring-blue-500' : 'ring-transparent'" :aria-label="text(avatar.zh, avatar.en)" :title="text(avatar.zh, avatar.en)" :aria-pressed="userStore.user?.avatarUrl === avatar.url" @click="save(() => userStore.updateProfile({ avatarUrl: avatar.url }))">
          <img :src="presetSrc(avatar.url)" alt="" class="h-full w-full rounded-full" />
          <span v-if="userStore.user?.avatarUrl === avatar.url" class="absolute -bottom-0.5 -right-0.5 rounded-full bg-blue-600 p-0.5 text-white"><Check class="h-2.5 w-2.5" /></span>
        </button>
      </div>
    </fieldset>
    <p v-if="message" role="status" class="text-xs" :class="failed ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Camera, Check } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import { AVATAR_GROUPS, presetAvatarSrc as presetSrc } from '@/utils/user-display'

const userStore = useUserStore()
const { t, locale } = useI18n()
const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const text = (zh: string, en: string) => locale.value.startsWith('zh') ? zh : en
const selectedGroup = ref(AVATAR_GROUPS.find(group => group.avatars.some(avatar => avatar.url === userStore.user?.avatarUrl))?.id ?? 'pets')

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
  <div class="avatar-picker space-y-4 border-b pb-5" style="border-color: var(--color-border)" :aria-busy="busy">
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
    <div class="avatar-style-switch" :aria-label="text('头像风格', 'Avatar styles')">
      <button v-for="group in AVATAR_GROUPS" :key="group.id" type="button" :data-avatar-group="group.id" :aria-pressed="selectedGroup === group.id" @click="selectedGroup = group.id">{{ text(group.zh, group.en) }}</button>
    </div>
    <fieldset v-for="group in AVATAR_GROUPS" v-show="selectedGroup === group.id" :key="group.id" :disabled="busy" :aria-label="text(group.zh, group.en)">
      <div class="pet-avatar-grid">
        <button v-for="avatar in group.avatars" :key="avatar.id" type="button" class="pet-avatar-option" :class="{ selected: userStore.avatarUrl === presetSrc(avatar.url) }" :aria-label="text(avatar.zh, avatar.en)" :title="text(avatar.zh, avatar.en)" :aria-pressed="userStore.avatarUrl === presetSrc(avatar.url)" @click="save(() => userStore.updateProfile({ avatarUrl: avatar.url }))">
          <img :src="presetSrc(avatar.url)" alt="" class="pet-avatar-art" />
          <span class="pet-avatar-name">{{ text(avatar.zh, avatar.en) }}</span>
          <span v-if="userStore.avatarUrl === presetSrc(avatar.url)" class="pet-avatar-check"><Check class="h-3 w-3" /></span>
        </button>
      </div>
    </fieldset>
    <p v-if="message" role="status" class="text-xs" :class="failed ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'">{{ message }}</p>
  </div>
</template>

<style scoped>
.avatar-picker { container-type:inline-size; }
.avatar-style-switch { display:flex; gap:4px; padding:4px; width:fit-content; max-width:100%; border-radius:10px; background:var(--color-bg); border:1px solid var(--color-border); }
.avatar-style-switch button { padding:7px 10px; border-radius:7px; color:var(--color-text-secondary); font-size:11px; white-space:nowrap; transition:background .16s, color .16s; }
.avatar-style-switch button[aria-pressed=true] { color:var(--color-text); background:var(--color-surface); box-shadow:0 1px 3px #0000000c; }
.avatar-style-switch button:focus-visible { outline:2px solid #687bd2; outline-offset:2px; }
.pet-avatar-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 76px)); gap:10px; }
.pet-avatar-option { position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; padding:9px 5px 8px; border:1px solid var(--color-border); border-radius:16px; background:var(--color-surface); transition:background .16s, border-color .16s; }
.pet-avatar-option:hover { background:var(--color-bg); border-color:#9aa9de; }
.pet-avatar-option:focus-visible { outline:2px solid #687bd2; outline-offset:3px; }
.pet-avatar-option.selected { border-color:#687bd2; background:color-mix(in srgb, #687bd2 10%, var(--color-surface)); }
.pet-avatar-option:disabled { opacity:.5; }
.pet-avatar-art { width:52px; height:52px; border-radius:50%; }
.pet-avatar-name { font-size:10px; line-height:1.4; color:var(--color-text-secondary); }
.pet-avatar-check { position:absolute; right:7px; top:7px; padding:2px; border-radius:50%; color:white; background:#5c70c4; }
@container(min-width:510px) { .pet-avatar-grid { grid-template-columns:repeat(6, minmax(0, 76px)); } }
</style>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { Camera, Check, Palette } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '@/stores/user'
import { AVATAR_GROUPS, presetAvatarSrc } from '@/utils/user-display'
import { useTheme } from '@/composables/useTheme'

const userStore = useUserStore()
const { t, locale } = useI18n()
const { palette, isDark } = useTheme()
const presetSrc = (url: string) => presetAvatarSrc(url, palette.value, isDark.value)
const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const text = (zh: string, en: string) => locale.value.startsWith('zh') ? zh : en
const selectedGroup = ref(AVATAR_GROUPS.find(group => group.avatars.some(avatar => avatar.url === userStore.user?.avatarUrl))?.id ?? 'pets')
watch(() => userStore.user?.avatarUrl, value => {
  const group = AVATAR_GROUPS.find(item => item.avatars.some(avatar => avatar.url === value))
  if (group) selectedGroup.value = group.id
})

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
      <button type="button" class="profile-avatar avatar-current group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full text-xl font-semibold focus-visible:ring-2 focus-visible:ring-[var(--color-link)] disabled:opacity-50" :aria-label="text('上传头像', 'Upload avatar')" :disabled="busy" @click="input?.click()">
        <img v-if="userStore.avatarUrl" :src="userStore.avatarUrl" alt="" class="h-full w-full object-cover" />
        <span v-else>{{ userStore.displayName.charAt(0) }}</span>
        <span class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"><Camera class="h-5 w-5" /></span>
      </button>
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-[var(--color-text)]">{{ userStore.displayName }}</p>
        <button type="button" class="avatar-upload-action mt-1 text-sm font-medium disabled:opacity-50" :disabled="busy" @click="input?.click()">{{ busy ? t('settings.saving') : text('上传头像', 'Upload avatar') }}</button>
        <p class="mt-1 text-xs text-[var(--color-text-secondary)]">JPG / PNG / GIF / WebP · {{ t('settings.avatarLimit') }}</p>
      </div>
      <input ref="input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" class="hidden" :disabled="busy" @change="upload" />
    </div>
    <div class="avatar-library-heading">
      <span>{{ text('预置头像', 'Preset avatars') }}</span>
      <span class="avatar-theme-note" :title="text('配色自动匹配当前色系及深浅模式', 'Colors adapt to the current palette and light or dark mode')"><Palette :size="12" />{{ text('随主题配色', 'Theme-adaptive') }}</span>
    </div>
    <div class="avatar-style-switch" :aria-label="text('头像风格', 'Avatar styles')">
      <button v-for="group in AVATAR_GROUPS" :key="group.id" type="button" :data-avatar-group="group.id" :aria-pressed="selectedGroup === group.id" :disabled="busy" @click="selectedGroup = group.id">{{ text(group.zh, group.en) }}</button>
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
    <p role="status" class="avatar-feedback text-xs" :class="failed ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'">{{ message || '\u00a0' }}</p>
  </div>
</template>

<style scoped>
.avatar-upload-action { color:var(--color-link); transition:color .16s; }
.avatar-upload-action:hover:not(:disabled) { text-decoration:underline; text-underline-offset:3px; }
.avatar-upload-action:focus-visible { outline:2px solid var(--color-link); outline-offset:3px; border-radius:3px; }
.avatar-picker { container-type:inline-size; }
.avatar-current { box-shadow:0 0 0 5px var(--color-surface),0 0 0 6px var(--color-selection-border); margin:6px; }
.avatar-library-heading { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; color:var(--color-text); font-size:12px; font-weight:600; }
.avatar-theme-note { display:inline-flex; align-items:center; gap:5px; color:var(--color-text-secondary); font-size:10px; font-weight:400; }
.avatar-feedback { min-height:1rem; }
.avatar-style-switch { display:flex; gap:4px; padding:4px; width:fit-content; max-width:100%; border-radius:10px; background:var(--color-bg); border:1px solid var(--color-border); }
.avatar-style-switch button { padding:7px 10px; border-radius:7px; color:var(--color-text-secondary); font-size:11px; white-space:nowrap; transition:background .16s, color .16s; }
.avatar-style-switch button[aria-pressed=true] { color:var(--color-selection-text); background:var(--color-selection-surface); box-shadow:0 1px 3px #0000000c; }
.avatar-style-switch button:focus-visible { outline:2px solid var(--color-link); outline-offset:2px; }
.pet-avatar-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
.pet-avatar-option { position:relative; display:flex; flex-direction:column; align-items:center; gap:10px; padding:12px 5px 10px; border:1px solid var(--color-border); border-radius:12px; background:var(--color-surface); transition:background .16s, border-color .16s; }
.pet-avatar-option:hover { background:var(--color-bg); border-color:var(--color-primary); }
.pet-avatar-option:focus-visible { outline:2px solid var(--color-link); outline-offset:3px; }
.pet-avatar-option.selected { border-color:var(--color-link); background:var(--color-selection-surface); }
.pet-avatar-option:disabled { opacity:.5; }
.pet-avatar-art { width:56px; height:56px; border-radius:50%; box-shadow:0 0 0 1px var(--color-selection-border); }
.pet-avatar-name { font-size:10px; line-height:1.4; color:var(--color-text-secondary); }
.pet-avatar-check { position:absolute; right:7px; top:7px; padding:2px; border-radius:50%; color:var(--color-on-primary); background:var(--color-primary); }
@container(min-width:460px) { .pet-avatar-grid { grid-template-columns:repeat(6, minmax(0, 1fr)); } }
</style>

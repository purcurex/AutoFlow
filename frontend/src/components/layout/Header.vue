<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, ChevronDown, Copy, PanelLeft } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { useUserStore } from '@/stores'
import { isWorkbenchRole, workbenchNames } from '@/utils/workbench'
import { LanguageSwitch, ThemeToggle } from '@/components/ui'

defineProps<{ sidebarCollapsed: boolean }>()
const emit = defineEmits<{ 'toggle-sidebar': [] }>()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const userMenu = ref<HTMLElement | null>(null)
const showUserMenu = ref(false)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
const { t, locale } = useI18n()

const pageTitle = computed(() => ({
  FopDashboard: t('nav.overview'),
  Organization: t('nav.organization'),
  RoleWorkbench: isWorkbenchRole(route.params.role) ? workbenchNames[route.params.role][locale.value.startsWith('zh') ? 0 : 1] : t('nav.dashboard'),
  RoleWorkbenchReceipts: locale.value.startsWith('zh') ? '回款明细' : 'Receipt details',
  RoleWorkbenchFreight: locale.value.startsWith('zh') ? '实际运费明细' : 'Actual freight details',
  WorkbenchRoleAdmin: t('nav.workbenchRoles'),
  Dashboard: t('nav.dashboard'), Workflows: t('nav.workflows'), NewWorkflow: t('nav.newWorkflow'), Leads: t('nav.leads'),
  LeadDetail: t('leads.detailEyebrow'), Outreach: t('nav.outreach'), Quotes: t('nav.quotes'), FollowUps: t('nav.followUps'),
  NoteDetail: t('legacy.record'), Settings: t('nav.settings'), Admin: t('nav.admin'),
  ReviseWorkflow: t('workflows.reviseTitle'), WorkflowSourcing: t('sourcing.title'), PromptTemplates: t('prompts.title'),
}[String(route.name)] || t('brand.fullName')))

onMounted(() => userStore.fetchUser())
onClickOutside(userMenu, () => { showUserMenu.value = false })

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

async function copyDisplayId() {
  const displayId = userStore.user?.displayId
  if (!displayId) return

  try {
    await navigator.clipboard.writeText(displayId)
  } catch {
    const input = document.createElement('textarea')
    input.value = displayId
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    input.remove()
  }
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copied.value = false }, 1600)
}

function handleLogout() {
  showUserMenu.value = false
  userStore.logout()
  router.push('/login')
}
</script>

<template>
  <header class="relative z-20 h-[72px] shrink-0 border-b bg-white/95 px-3 backdrop-blur dark:bg-[#0d0f13]/95 sm:px-5" style="border-color: var(--color-border)">
    <div class="flex h-full min-w-0 items-center gap-3">
      <button class="icon-btn" :title="sidebarCollapsed ? t('nav.expand') : t('nav.collapse')" @click="emit('toggle-sidebar')"><PanelLeft class="h-5 w-5" /></button>
      <div class="min-w-0">
        <p class="truncate text-sm font-bold text-slate-950 dark:text-white">{{ pageTitle }}</p>
        <p class="hidden truncate text-xs text-slate-500 sm:block">{{ t('brand.fullName') }}</p>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <LanguageSwitch class="hidden sm:inline-flex" />
        <ThemeToggle />

        <div ref="userMenu" class="relative">
          <button class="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-1.5 pr-2 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#15181d] dark:hover:bg-[#20242b]" :aria-expanded="showUserMenu" aria-haspopup="menu" @click="showUserMenu = !showUserMenu">
            <span class="flex h-7 w-7 items-center justify-center overflow-hidden rounded bg-orange-600 text-xs font-bold text-white">
              <img v-if="userStore.avatarUrl" :src="userStore.avatarUrl" alt="Avatar" class="h-full w-full object-cover" /><span v-else>{{ (userStore.username || 'U').charAt(0).toUpperCase() }}</span>
            </span>
            <span class="hidden max-w-28 truncate font-semibold text-slate-700 dark:text-slate-200 xl:block">{{ userStore.username }}</span>
            <ChevronDown class="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
          </button>

          <div v-if="showUserMenu" class="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border bg-white py-2 shadow-xl dark:bg-[#15181d]" style="border-color: var(--color-border)" role="menu">
            <div class="flex items-center gap-3 border-b px-4 py-3.5" style="border-color: var(--color-border)">
              <span class="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-orange-600 text-base font-bold text-white">
                <img v-if="userStore.avatarUrl" :src="userStore.avatarUrl" alt="Avatar" class="h-full w-full object-cover" /><span v-else>{{ (userStore.username || 'U').charAt(0).toUpperCase() }}</span>
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-bold text-slate-950 dark:text-white">{{ userStore.username }}</p>
                <p class="mt-0.5 truncate text-xs text-slate-500">{{ userStore.user?.email }}</p>
              </div>
            </div>
            <div class="border-b px-4 py-2.5" style="border-color: var(--color-border)">
              <div class="flex items-center justify-between gap-3 rounded bg-slate-50 px-3 py-2 dark:bg-white/5">
                <div>
                  <p class="text-[10px] font-semibold uppercase text-slate-400">{{ t('common.userId') }}</p>
                  <p class="mt-0.5 font-mono text-sm font-semibold tracking-normal text-slate-700 dark:text-slate-200">ID: {{ userStore.user?.displayId || '------' }}</p>
                </div>
                <button type="button" class="icon-btn h-8 w-8" :title="copied ? t('common.copied') : t('common.copyId')" :aria-label="copied ? t('common.copied') : t('common.copyId')" :disabled="!userStore.user?.displayId" @click="copyDisplayId">
                  <Check v-if="copied" class="h-4 w-4 text-emerald-600" />
                  <Copy v-else class="h-4 w-4" />
                </button>
              </div>
            </div>
            <RouterLink to="/settings" class="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5" @click="showUserMenu = false">{{ t('nav.settings') }}</RouterLink>
            <RouterLink v-if="userStore.isAdmin" to="/admin" class="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5" @click="showUserMenu = false">{{ t('nav.admin') }}</RouterLink>
            <button class="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950" @click="handleLogout">{{ t('nav.signOut') }}</button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

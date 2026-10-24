<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Calculator, GitBranch, LayoutDashboard, ListTodo, MessageSquareText, Settings, Shield, Sparkles, Users, Workflow } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { useUserStore } from '@/stores'
import { BrandLogo } from '@/components/ui'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const userStore = useUserStore()
const { t } = useI18n()

const { access } = useWorkbenchAccess()
const hasBusinessAccess = computed(() => (access.value?.businessRole ?? userStore.user?.businessRole) !== 'none')
const canManage = computed(() => access.value?.isAdmin === true)
const navItems = computed(() => [
  { label: t('nav.overview'), to: '/dashboard', match: ['FopDashboard'], icon: LayoutDashboard },
  { label: t('nav.dashboard'), to: '/', match: ['Dashboard', 'RoleWorkbench', 'WorkbenchAccessDenied'], icon: LayoutDashboard },
  { label: t('nav.workflows'), to: '/workflows', match: ['Workflows', 'NewWorkflow'], icon: Workflow },
  { label: t('nav.leads'), to: '/leads', match: ['Leads', 'LeadDetail'], icon: Users },
  { label: t('nav.outreach'), to: '/outreach', match: ['Outreach'], icon: MessageSquareText },
  { label: t('nav.quotes'), to: '/quotes', match: ['Quotes'], icon: Calculator },
  { label: t('nav.followUps'), to: '/follow-ups', match: ['FollowUps'], icon: ListTodo },
].filter(() => hasBusinessAccess.value))

function isActive(item: { match: string[] }) {
  return item.match.includes(String(route.name))
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col border-r bg-white transition-all duration-200 dark:bg-[var(--color-shell)] md:relative"
    :class="props.collapsed ? '-translate-x-full md:w-20 md:translate-x-0' : 'w-72 translate-x-0 md:w-64'"
    style="border-color: var(--color-border)"
  >
    <div class="flex h-[72px] items-center border-b px-4" style="border-color: var(--color-border)">
      <BrandLogo :compact="props.collapsed" />
    </div>

    <nav class="flex-1 space-y-1.5 overflow-y-auto px-3 py-5">
      <RouterLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :title="props.collapsed ? item.label : undefined"
        class="group relative flex h-11 items-center rounded-md text-sm font-semibold transition"
        :class="[
          props.collapsed ? 'justify-center px-2' : 'px-3',
          isActive(item)
            ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white',
        ]"
        @click="emit('navigate')"
      >
        <component :is="item.icon" class="h-[18px] w-[18px] shrink-0" :class="props.collapsed ? '' : 'mr-3'" />
        <span v-if="!props.collapsed" class="truncate">{{ item.label }}</span>
        <span v-if="isActive(item)" class="h-1.5 w-1.5 rounded-full bg-orange-500" :class="props.collapsed ? 'absolute right-2' : 'ml-auto'" />
      </RouterLink>
    </nav>

    <div class="space-y-1 border-t p-3" style="border-color: var(--color-border)">
      <RouterLink v-if="hasBusinessAccess" to="/prompt-templates" :title="props.collapsed ? t('nav.promptTemplates') : undefined" class="flex h-10 items-center rounded-md text-sm font-semibold transition" :class="[props.collapsed ? 'justify-center' : 'px-3', route.name === 'PromptTemplates' ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white']" @click="emit('navigate')">
        <Sparkles class="h-[18px] w-[18px]" :class="props.collapsed ? '' : 'mr-3'" /><span v-if="!props.collapsed">{{ t('nav.promptTemplates') }}</span>
      </RouterLink>
      <RouterLink to="/settings" :title="props.collapsed ? t('nav.settings') : undefined" class="flex h-10 items-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white" :class="props.collapsed ? 'justify-center' : 'px-3'" @click="emit('navigate')">
        <Settings class="h-[18px] w-[18px]" :class="props.collapsed ? '' : 'mr-3'" /><span v-if="!props.collapsed">{{ t('nav.settings') }}</span>
      </RouterLink>
      <RouterLink v-if="canManage && (access?.businessRole ?? userStore.user?.businessRole) === 'admin'" to="/admin" :title="props.collapsed ? t('nav.admin') : undefined" class="flex h-10 items-center rounded-md text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white" :class="props.collapsed ? 'justify-center' : 'px-3'" @click="emit('navigate')">
        <Shield class="h-[18px] w-[18px]" :class="props.collapsed ? '' : 'mr-3'" /><span v-if="!props.collapsed">{{ t('nav.admin') }}</span>
      </RouterLink>
    </div>
    <div v-if="canManage" data-management-nav class="shrink-0 space-y-1 border-t p-3" style="border-color: var(--color-border)">
      <p v-if="!props.collapsed" class="px-3 pb-1 text-[11px] font-semibold text-slate-400">{{ t('nav.systemManagement') }}</p>

      <RouterLink to="/organization" :title="t('nav.organization')" class="flex h-10 items-center rounded-md text-sm font-semibold transition" :class="[props.collapsed ? 'justify-center' : 'px-3', route.name === 'Organization' ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white']" @click="emit('navigate')">
        <GitBranch class="h-[18px] w-[18px]" :class="props.collapsed ? '' : 'mr-3'" /><span v-if="!props.collapsed">{{ t('nav.organization') }}</span>
      </RouterLink>
      <RouterLink to="/admin/workbenches" :title="t('nav.workbenchRoles')" class="flex h-10 items-center rounded-md text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-400" :class="props.collapsed ? 'justify-center' : 'px-3'" @click="emit('navigate')"><Shield class="h-[18px] w-[18px]" :class="props.collapsed ? '' : 'mr-3'" /><span v-if="!props.collapsed">{{ t('nav.workbenchRoles') }}</span></RouterLink>
    </div>
  </aside>
</template>

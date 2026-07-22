<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Calculator, LayoutDashboard, ListTodo, MessageSquareText, Settings, Shield, Users, Workflow } from 'lucide-vue-next'
import { useUserStore } from '@/stores'

defineProps<{
  collapsed: boolean
}>()

const route = useRoute()
const userStore = useUserStore()

const navItems = computed(() => [
  { label: 'Dashboard', to: '/', match: ['Dashboard'], icon: LayoutDashboard },
  { label: 'Workflows', to: '/workflows', match: ['Workflows', 'NewWorkflow'], icon: Workflow },
  { label: 'Leads', to: '/leads', match: ['Leads', 'LeadDetail'], icon: Users },
  { label: 'Outreach', to: '/outreach', match: ['Outreach'], icon: MessageSquareText },
  { label: 'Quotes', to: '/quotes', match: ['Quotes'], icon: Calculator },
  { label: 'Follow-up', to: '/follow-ups', match: ['FollowUps'], icon: ListTodo },
])

function isActive(item: { match: string[] }) {
  return item.match.includes(String(route.name))
}
</script>

<template>
  <aside
    class="h-full border-r border-[var(--color-border)] bg-white text-slate-900 transition-all dark:bg-slate-950 dark:text-slate-100"
    :class="collapsed ? 'w-0 overflow-hidden' : 'w-64'"
  >
    <div class="flex h-full flex-col">
      <div class="border-b border-[var(--color-border)] px-5 py-4">
        <RouterLink to="/" class="block">
          <div class="text-lg font-semibold tracking-tight text-primary-600">AutoFlow</div>
          <div class="mt-1 text-xs font-medium text-slate-500">Outbound sales workspace</div>
        </RouterLink>
      </div>

      <nav class="flex-1 space-y-1 px-3 py-4">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
          :class="isActive(item)
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-200'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white'"
        >
          <component :is="item.icon" class="mr-3 h-4 w-4 shrink-0" />
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="space-y-1 border-t border-[var(--color-border)] p-3">
        <RouterLink
          to="/settings"
          class="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          <Settings class="mr-3 h-4 w-4" />
          Settings
        </RouterLink>
        <RouterLink
          v-if="userStore.isAdmin"
          to="/admin"
          class="flex items-center rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          <Shield class="mr-3 h-4 w-4" />
          Admin
        </RouterLink>
      </div>
    </div>
  </aside>
</template>

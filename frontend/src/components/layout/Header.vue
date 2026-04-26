<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores'

const emit = defineEmits<{
  'toggle-sidebar': []
}>()

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const showUserMenu = ref(false)

const pageTitle = computed(() => {
  const names: Record<string, string> = {
    Dashboard: 'Dashboard',
    Workflows: 'Workflows',
    NewWorkflow: 'New workflow',
    Leads: 'Lead pool',
    LeadDetail: 'Lead detail',
    Outreach: 'Outreach',
    CRM: 'CRM',
    Settings: 'Settings',
    Admin: 'Admin',
  }
  return names[String(route.name)] || 'AutoFlow'
})

onMounted(() => {
  userStore.fetchUser()
})

function handleLogout() {
  showUserMenu.value = false
  userStore.logout()
  router.push('/login')
}
</script>

<template>
  <header class="h-14 border-b border-[var(--color-border)] bg-white px-4 dark:bg-slate-950">
    <div class="flex h-full items-center gap-3">
      <button
        class="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-900 dark:hover:text-white"
        @click="emit('toggle-sidebar')"
      >
        <span class="sr-only">Toggle sidebar</span>
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{{ pageTitle }}</p>
        <p class="truncate text-xs text-slate-500">AutoFlow sales operations</p>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <RouterLink to="/workflows/new" class="btn btn-primary hidden text-sm sm:inline-flex">New workflow</RouterLink>

        <div class="relative">
          <button
            class="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary-600 text-sm font-semibold text-white"
            @click="showUserMenu = !showUserMenu"
          >
            <img v-if="userStore.avatarUrl" :src="userStore.avatarUrl" alt="Avatar" class="h-full w-full object-cover" />
            <span v-else>{{ (userStore.username || 'U').charAt(0).toUpperCase() }}</span>
          </button>

          <div
            v-if="showUserMenu"
            class="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-[var(--color-border)] bg-white py-2 shadow-lg dark:bg-slate-900"
          >
            <div class="border-b border-[var(--color-border)] px-4 py-3">
              <p class="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{{ userStore.username }}</p>
              <p class="truncate text-xs text-slate-500">{{ userStore.user?.email }}</p>
            </div>
            <RouterLink
              to="/settings"
              class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="showUserMenu = false"
            >
              Settings
            </RouterLink>
            <RouterLink
              v-if="userStore.isAdmin"
              to="/admin"
              class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="showUserMenu = false"
            >
              Admin
            </RouterLink>
            <button
              class="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              @click="handleLogout"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

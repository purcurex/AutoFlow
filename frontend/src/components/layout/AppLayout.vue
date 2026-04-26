<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUserStore } from '@/stores'
import Sidebar from './Sidebar.vue'
import Header from './Header.vue'

const userStore = useUserStore()
const isSidebarCollapsed = ref(false)

onMounted(async () => {
  if (userStore.isLoggedIn) {
    await userStore.fetchUser()
  }
})

function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}
</script>

<template>
  <div class="h-screen flex bg-[var(--color-background)]">
    <Sidebar :collapsed="isSidebarCollapsed" />

    <div class="flex-1 flex flex-col overflow-hidden">
      <Header @toggle-sidebar="toggleSidebar" />
      <main class="flex-1 overflow-auto">
        <slot />
      </main>
    </div>
  </div>
</template>

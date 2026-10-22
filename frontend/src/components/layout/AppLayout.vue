<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useUserStore } from '@/stores'
import Sidebar from './Sidebar.vue'
import Header from './Header.vue'
import { scrollOuterPage } from '@/utils/pageWheel'

const userStore = useUserStore()
const isSidebarCollapsed = ref(false)
const pageScroller = ref<HTMLElement>()

onMounted(async () => {
  if (window.innerWidth < 768) isSidebarCollapsed.value = true
  if (userStore.isLoggedIn) await userStore.fetchUser()
})

function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}

function closeMobileSidebar() {
  if (window.innerWidth < 768) isSidebarCollapsed.value = true
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-[var(--color-background)]" @wheel.capture="scrollOuterPage($event, pageScroller)">
    <button v-if="!isSidebarCollapsed" class="fixed inset-0 z-30 bg-black/45 md:hidden" aria-label="Close Navigation" @click="closeMobileSidebar" />
    <Sidebar :collapsed="isSidebarCollapsed" @navigate="closeMobileSidebar" />
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Header :sidebar-collapsed="isSidebarCollapsed" @toggle-sidebar="toggleSidebar" />
      <main ref="pageScroller" data-page-scroll class="flex-1 overflow-auto bg-[var(--color-background)]"><slot /></main>
    </div>
  </div>
</template>

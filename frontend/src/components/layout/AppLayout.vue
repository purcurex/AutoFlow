<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUserStore, useNoteStore } from '@/stores'
import Sidebar from './Sidebar.vue'
import Header from './Header.vue'

const userStore = useUserStore()
const noteStore = useNoteStore()

const isSidebarCollapsed = ref(false)

onMounted(async () => {
  if (userStore.isLoggedIn) {
    await Promise.all([
      userStore.fetchUser(),
      noteStore.fetchFolders(),
      noteStore.fetchNotes()
    ])
  }
})

function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}
</script>

<template>
  <div class="h-screen flex bg-[var(--color-background)]">
    <!-- 侧边栏 -->
    <Sidebar :collapsed="isSidebarCollapsed" @toggle="toggleSidebar" />

    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <Header @toggle-sidebar="toggleSidebar" />
      <main class="flex-1 overflow-auto">
        <slot />
      </main>
    </div>
  </div>
</template>

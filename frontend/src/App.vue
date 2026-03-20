<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  // 恢复深色模式设置，默认为深色模式
  const darkMode = localStorage.getItem('darkMode')
  if (darkMode !== 'false') {
    document.documentElement.classList.add('dark')
  }
})
</script>

<template>
  <RouterView />
</template>

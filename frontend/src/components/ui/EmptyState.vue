<script setup lang="ts">
import { Inbox } from 'lucide-vue-next'
defineProps<{ message: string }>()
</script>

<template>
  <div class="empty-state">
    <span class="empty-state-icon"><Inbox class="h-5 w-5" /></span>
    <p>{{ message }}</p>
    <slot />
  </div>
</template>

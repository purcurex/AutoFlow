<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <header class="workbench-task-heading">
    <div class="task-heading-copy">
      <h2>{{ title }}</h2>
      <p v-if="description" class="task-heading-description" :title="description">{{ description }}</p>
    </div>
    <slot />
  </header>
</template>

<style scoped>
.workbench-task-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; margin-bottom: 20px; }
h2 { font-size: 21px; font-weight: 750; letter-spacing: -.03em; line-height: 1.4; }
@media (max-width: 700px) { h2 { font-size: 18px; } }
</style>

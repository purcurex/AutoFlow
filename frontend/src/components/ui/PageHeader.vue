<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description?: string }>()
</script>

<template>
  <div class="page-header">
    <div class="min-w-0">
      <p v-if="eyebrow" class="page-eyebrow">{{ eyebrow }}</p>
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="description" class="page-description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

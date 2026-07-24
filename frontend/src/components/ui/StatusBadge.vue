<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

const tone = computed(() => {
  if (['completed', 'succeeded', 'won', 'replied', 'verified'].includes(props.status)) return 'success'
  if (['running', 'ready', 'qualified', 'contacted'].includes(props.status)) return 'info'
  if (['failed', 'lost', 'invalid'].includes(props.status)) return 'danger'
  if (['pending', 'draft', 'requires_review'].includes(props.status)) return 'warning'
  return 'neutral'
})
</script>

<template>
  <span class="status-badge" :class="`status-${tone}`">{{ $te(`status.${status}`) ? $t(`status.${status}`) : status }}</span>
</template>

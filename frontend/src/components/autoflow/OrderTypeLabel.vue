<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'
const props = defineProps<{ code?: string | null; name?: string | null }>()
const { locale } = useI18n()
const sample = computed(() => props.code?.trim()
  ? props.code.trim() === 'hzkj_orders_BT_Sample'
  : props.name?.trim() === '样品订单')
</script>

<template><div v-if="sample" class="order-type-label"><WorkbenchStatusBadge tone="info">{{ locale.startsWith('zh') ? '样品订单' : 'Sample order' }}</WorkbenchStatusBadge></div></template>

<style scoped>
.order-type-label{display:flex;justify-content:flex-start;margin-top:6px;white-space:nowrap}
.order-type-label :deep(.workbench-status-badge){color:color-mix(in srgb,var(--color-selection-text) 88%,#000);background:var(--color-selection-surface);border-color:var(--color-selection-border)}
:global(.dark) .order-type-label :deep(.workbench-status-badge){color:var(--color-selection-text)}
</style>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ selectedCount: number }>()
defineEmits<{ clear: [] }>()
const { locale } = useI18n()
</script>

<template>
  <div class="workbench-list-actions">
    <slot />
    <div class="workbench-selection-controls">
      <span class="workbench-selection-summary">{{ String(locale).startsWith('zh') ? `已选 ${selectedCount} 笔 · 全选仅选当前页` : `${selectedCount} selected · Select all on this page` }}</span>
      <button type="button" class="workbench-clear-selection" :style="{ visibility: selectedCount ? 'visible' : 'hidden' }" :disabled="!selectedCount" :tabindex="selectedCount ? 0 : -1" :aria-hidden="!selectedCount" @click="$emit('clear')">{{ String(locale).startsWith('zh') ? '清空' : 'Clear' }}</button>
    </div>
    <div v-if="$slots.pagination" class="workbench-list-pagination"><slot name="pagination" /></div>
    <div v-if="$slots.export" class="workbench-list-export"><slot name="export" /></div>
  </div>
</template>

<style scoped>
.workbench-list-actions{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--color-border);background:color-mix(in srgb,var(--color-chart-link) 4%,var(--color-surface));font-size:12px;color:var(--color-text-secondary);line-height:20px}
.workbench-selection-controls{display:flex;align-items:center;gap:10px;width:310px;max-width:100%;flex-shrink:0}
.workbench-clear-selection{flex-shrink:0;color:var(--color-chart-link);font-size:inherit}
.workbench-selection-summary{flex:1;min-width:0;white-space:nowrap;font-variant-numeric:tabular-nums}
.workbench-list-export{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
</style>

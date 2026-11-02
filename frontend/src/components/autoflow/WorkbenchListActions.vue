<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ selectedCount: number }>()
defineEmits<{ clear: [] }>()
const { locale } = useI18n()
</script>

<template>
  <div class="workbench-list-actions">
    <slot />
    <span>{{ String(locale).startsWith('zh') ? `已选 ${selectedCount} 笔 · 全选仅选当前页` : `${selectedCount} selected · Select all on this page` }}</span>
    <button v-if="selectedCount" type="button" class="workbench-clear-selection" @click="$emit('clear')">{{ String(locale).startsWith('zh') ? '清空' : 'Clear' }}</button>
    <div class="workbench-list-export"><slot name="export" /></div>
  </div>
</template>

<style scoped>
.workbench-list-actions{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--color-border);background:color-mix(in srgb,var(--color-chart-link) 4%,var(--color-surface));font-size:12px;color:var(--color-text-secondary);line-height:20px}
.workbench-clear-selection{color:var(--color-chart-link);font-size:inherit}
.workbench-list-export{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}
</style>

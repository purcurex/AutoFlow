<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-vue-next'
const props = defineProps<{ label: string; direction?: 'asc' | 'desc'; disabled?: boolean; hint?: string }>()
defineEmits<{ sort: [] }>()
const { locale } = useI18n()
const action = computed(() => String(locale.value).startsWith('zh')
  ? props.direction === 'asc' ? '点击按状态降序排列' : '点击按状态升序排列'
  : props.direction === 'asc' ? 'Sort status descending' : 'Sort status ascending')
</script>

<template>
  <th :aria-sort="direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'">
    <button type="button" class="sort-status" :disabled="disabled" :aria-label="`${label}：${action}`" :title="hint ? `${action} · ${hint}` : action" @click="$emit('sort')">
      {{ label }}<component :is="direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown" :size="13" aria-hidden="true" />
    </button>
  </th>
</template>

<style scoped>
.sort-status { display: inline-flex; align-items: center; gap: 5px; color: inherit; font: inherit; white-space: nowrap; cursor: pointer; }
.sort-status svg { color: var(--color-chart-link); }
.sort-status:disabled { cursor: wait; opacity: .6; }
</style>

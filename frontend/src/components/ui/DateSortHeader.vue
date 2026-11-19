<script setup lang="ts">
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-vue-next'
defineProps<{ label: string; direction?: 'asc' | 'desc'; disabled?: boolean }>()
defineEmits<{ sort: [] }>()
</script>
<template>
  <th :aria-sort="direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'">
    <button type="button" class="date-sort" :class="{ active: direction }" :disabled="disabled" :aria-label="`${label}：按时间${direction === 'asc' ? '降序' : '升序'}排列`" @click="$emit('sort')">
      {{ label }}<component :is="direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown" :size="13" aria-hidden="true" />
    </button>
  </th>
</template>
<style scoped>
.date-sort{display:inline-flex;align-items:center;gap:5px;color:inherit;font:inherit;white-space:nowrap;background:none;border:0;padding:2px 0;cursor:pointer}.date-sort svg{color:var(--color-text-secondary)}.date-sort.active svg,.date-sort:hover{color:var(--color-primary)}.date-sort:focus-visible{outline:2px solid var(--color-primary);outline-offset:4px;border-radius:2px}.date-sort:disabled{cursor:wait;opacity:.65}
</style>

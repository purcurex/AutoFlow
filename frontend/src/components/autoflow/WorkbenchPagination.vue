<script setup lang="ts">
import { inject } from 'vue'
import { workbenchListScrollKey } from '@/composables/useWorkbenchListScroll'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, ArrowUpToLine, ArrowDownToLine } from 'lucide-vue-next'
defineProps<{ page: number; pageSize: number; pages: number; disabled?: boolean; pageSizeLabel?: string }>()
defineEmits<{ page: [value: number]; pageSize: [value: number] }>()
const { locale } = useI18n()
const listScroll = inject(workbenchListScrollKey, undefined)
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
</script>

<template>
  <nav class="workbench-pagination" :aria-label="text('列表分页', 'List pagination')">
    <label>{{ pageSizeLabel || text('每页', 'Per page') }}<select class="workbench-filter-select" :value="pageSize" :disabled="disabled" :aria-label="text('每页条数', 'Page size')" @change="$emit('pageSize', Number(($event.target as HTMLSelectElement).value))"><option v-for="size in [20, 50, 100, 200, 500, 1000]" :key="size" :value="size">{{ size }}</option></select></label>
    <button type="button" class="workbench-button" :disabled="disabled || page <= 1" :aria-label="text('上一页', 'Previous page')" @click="$emit('page', page - 1)"><ChevronLeft :size="14" /><span>{{ text('上一页', 'Previous') }}</span></button>
    <span class="page-number" aria-live="polite">{{ page }} / {{ Math.max(1, pages) }}</span>
    <button type="button" class="workbench-button" :disabled="disabled || page >= Math.max(1, pages)" :aria-label="text('下一页', 'Next page')" @click="$emit('page', page + 1)"><span>{{ text('下一页', 'Next') }}</span><ChevronRight :size="14" /></button>
    <div v-if="listScroll?.available.value" class="workbench-scroll-shortcuts">
      <button type="button" :disabled="listScroll.atTop.value" :title="text('到顶', 'Top')" :aria-label="text('列表到顶', 'Scroll list to top')" @click="listScroll.jump(false)"><ArrowUpToLine :size="15" /></button>
      <button type="button" :disabled="listScroll.atBottom.value" :title="text('到底', 'Bottom')" :aria-label="text('列表到底', 'Scroll list to bottom')" @click="listScroll.jump(true)"><ArrowDownToLine :size="15" /></button>
    </div>
  </nav>
</template>

<style scoped>
.workbench-pagination{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px;font-size:12px;color:var(--color-text-secondary)}
.workbench-pagination label{display:flex;align-items:center;gap:8px;white-space:nowrap}
.workbench-pagination select{width:76px}
.workbench-pagination .workbench-button{padding:8px 10px}
.page-number{width:64px;flex-shrink:0;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
@media(max-width:500px){.workbench-pagination .workbench-button span{display:none}}
</style>

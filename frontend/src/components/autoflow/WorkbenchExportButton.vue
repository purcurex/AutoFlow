<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download } from 'lucide-vue-next'

const props = defineProps<{ selectedCount: number; total: number; disabled?: boolean; busy?: boolean }>()
const emit = defineEmits<{ export: [mode: 'selected' | 'filtered'] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const unavailable = computed(() => props.disabled || props.busy || !props.total)
const hint = computed(() => props.selectedCount > 0
  ? text(`导出已选 ${props.selectedCount} 笔订单`, `Export ${props.selectedCount} selected orders`)
  : text('导出当前筛选下的全部订单，包含其他分页', 'Export all matching orders across pages'))
function download() {
  if (!unavailable.value) emit('export', props.selectedCount > 0 ? 'selected' : 'filtered')
}
</script>

<template>
  <button type="button" class="workbench-export-trigger workbench-button" data-testid="export-orders" :disabled="unavailable" :title="hint" @click="download">
    <Download :size="15" /><span>{{ busy ? text('导出中…', 'Exporting…') : text('导出 Excel', 'Export Excel') }}</span>
  </button>
</template>

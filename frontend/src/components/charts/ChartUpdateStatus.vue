<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ busy: boolean; asOf?: string; locale?: string }>(), { locale: 'zh-CN' })
const zh = computed(() => String(props.locale).startsWith('zh'))
function formatted(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(String(props.locale), { timeZone: 'Asia/Shanghai', hour12: false })
}
</script>
<template>
  <div class="chart-update-meta">
    <small v-if="asOf">{{ zh ? '更新' : 'Updated' }} {{ formatted(asOf) }}</small>
    <span class="chart-update-slot" aria-live="polite" aria-atomic="true"><span v-if="busy" class="chart-update-badge" role="status">{{ zh ? '更新中' : 'Updating' }}</span></span>
  </div>
</template>
<style scoped>
.chart-update-meta{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-left:auto;flex-wrap:wrap;min-height:20px;color:var(--color-text-secondary)}
.chart-update-meta small{font-size:11px;line-height:18px;font-weight:400;white-space:nowrap}
.chart-update-slot{display:inline-flex;min-width:46px;min-height:20px;align-items:center}
.chart-update-badge{display:inline-flex;align-items:center;white-space:nowrap;padding:1px 6px;border-radius:4px;font-size:10px;line-height:16px;font-weight:500;color:var(--color-selection-text);background:var(--color-selection-surface);border:1px solid var(--color-selection-border)}
</style>

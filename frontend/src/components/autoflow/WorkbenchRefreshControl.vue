<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from 'lucide-vue-next'

defineProps<{ busy?: boolean; disabled?: boolean; offline?: boolean; refreshedAt?: string | null }>()
defineEmits<{ refresh: [] }>()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
function time(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(zh.value ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
    : '—'
}
</script>

<template>
  <div class="workbench-refresh-control">
    <button type="button" class="workbench-button workbench-refresh refresh-orders" :disabled="busy || disabled || offline" :aria-busy="!!busy" @click="$emit('refresh')">
      <RefreshCw :size="15" :class="{ spinning: busy }" />{{ text('刷新', 'Refresh') }}
    </button>
    <span class="workbench-refresh-status" aria-live="polite">
      <span>{{ offline ? text('网络已断开', 'Offline') : busy ? text('正在查询…', 'Loading…') : text('手动刷新', 'Manual refresh') }}</span>
      <span>{{ text('最近查询', 'Last queried') }} {{ time(refreshedAt) }} · UTC+8</span>
    </span>
  </div>
</template>

<style scoped>
.workbench-refresh-control{display:grid;grid-template-columns:max-content 190px;align-items:center;gap:12px;flex-shrink:0}
.workbench-refresh-status{display:grid;grid-template-rows:20px 20px;font-size:11px;line-height:20px;color:var(--color-text-secondary);white-space:nowrap;font-variant-numeric:tabular-nums}
.spinning{animation:workbench-refresh-spin 1s linear infinite}
@keyframes workbench-refresh-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.spinning{animation:none}}
</style>

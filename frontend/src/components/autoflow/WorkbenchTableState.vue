<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ columns: number; loading?: boolean; error?: string; message?: string }>()
const { locale } = useI18n()
</script>
<template>
  <tr class="workbench-state-row"><td :colspan="columns"><div class="workbench-table-state" :role="error ? 'alert' : 'status'">
    <span>{{ error || (loading ? String(locale).startsWith('zh') ? '正在查询…' : 'Loading…' : message) }}</span><slot />
  </div></td></tr>
</template>
<style scoped>
.workbench-state-row>td{grid-column:1 / -1;padding:0!important;border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border)}
.workbench-table-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:180px;padding:24px;box-sizing:border-box;color:var(--color-text-secondary);font-size:13px;line-height:1.7;white-space:normal}
.workbench-table-state[role=alert]{color:var(--color-warning,#9a6700)}
</style>

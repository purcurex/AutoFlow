<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DispatchDocument } from '@/api/fop-orders'

defineProps<{ documents?: DispatchDocument[] | null }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const labels = computed(() => ({ draft: text('暂存', 'Draft'), submitted: text('已提交', 'Submitted'), approved: text('已审核', 'Approved'), unknown: text('待确认', 'Unconfirmed') }))
</script>

<template>
  <div class="dispatch-status">
    <template v-if="documents?.length">
      <div v-for="document in documents" :key="document.id" class="dispatch-document">
        <span class="dispatch-stage" :class="document.status">{{ labels[document.status] || labels.unknown }}</span>
        <span class="dispatch-number">{{ document.number }}</span>
      </div>
    </template>
    <span v-else class="dispatch-stage unknown">{{ documents ? text('未生成发运单', 'No dispatch document') : labels.unknown }}</span>
  </div>
</template>

<style scoped>
.dispatch-status { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; min-width: 110px; padding: 4px 0; }
.dispatch-document { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.dispatch-stage { display: inline-flex; padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.dispatch-number { color: var(--color-text-secondary); font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.draft { color: #956b2c; background: #f8efdf; }
.submitted { color: #536da1; background: #edf1fa; }
.approved { color: #327c6e; background: #e8f3ee; }
.unknown { color: #69778d; background: #eef1f6; }
.dark .draft { color: #c9b896; background: #292720; }
.dark .submitted { color: #a6b8d8; background: #233044; }
.dark .approved { color: #94baad; background: #20332f; }
.dark .unknown { color: #acb9cd; background: #263346; }
</style>

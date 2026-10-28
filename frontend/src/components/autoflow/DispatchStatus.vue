<script setup lang="ts">
import { computed } from 'vue'
import { getDispatchTaskStatus, getDispatchCompletionStatus, taskStatusLabel } from '@/utils/workbench-status'
import { useI18n } from 'vue-i18n'
import type { DispatchDocument, FulfillmentProgress } from '@/api/fop-orders'

const props = defineProps<{ documents?: DispatchDocument[] | null; shopifySync?: FulfillmentProgress['shopifySync']; queue?: string }>()
const { locale } = useI18n()
const status = computed(() => props.queue === 'allocation_review' ? getDispatchCompletionStatus(props.documents) : getDispatchTaskStatus(props.documents, props.shopifySync))
</script>

<template>
  <div class="dispatch-status">
    <span class="dispatch-stage" :class="(props.queue ?? 'dispatch') === 'dispatch' && status === 'dispatch_approved' ? 'sync-pending' : status.replace('dispatch_', '')">{{ taskStatusLabel(status, props.queue ?? 'dispatch')[String(locale).startsWith('zh') ? 0 : 1] }}</span>
  </div>
</template>
<style scoped>
.dispatch-status { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; min-width: 110px; padding: 4px 0; }
.dispatch-stage { display: inline-flex; padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.sync-pending, .draft { color: #956b2c; background: #f8efdf; }
.submitted { color: #536da1; background: #edf1fa; }
.approved, .complete { color: #327c6e; background: #e8f3ee; }
.incomplete { color: #956b2c; background: #f8efdf; }
.unknown { color: #69778d; background: #eef1f6; }
.dark .sync-pending, .dark .draft { color: #c9b896; background: #292720; }
.dark .submitted { color: #a6b8d8; background: #233044; }
.dark .approved, .dark .complete { color: #94baad; background: #20332f; }
.dark .incomplete { color: #c9b896; background: #292720; }
.dark .unknown { color: #acb9cd; background: #263346; }
</style>

<style scoped>
.missing { color: #b69c7a; background: color-mix(in srgb, #b69c7a 12%, transparent); }
</style>

<style scoped>
.synced { color: #327c6e; background: #e8f3ee; }
.dark .synced { color: #94baad; background: #20332f; }
</style>

<script setup lang="ts">
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'
import { computed } from 'vue'
import { getDispatchTaskStatus, getDispatchCompletionStatus, taskStatusLabel } from '@/utils/workbench-status'
import { useI18n } from 'vue-i18n'
import type { DispatchDocument, FulfillmentProgress } from '@/api/fop-orders'

const props = defineProps<{ documents?: DispatchDocument[] | null; shopifySync?: FulfillmentProgress['shopifySync']; queue?: string }>()
const { locale } = useI18n()
const status = computed(() => props.queue === 'allocation_review' ? getDispatchCompletionStatus(props.documents) : getDispatchTaskStatus(props.documents, props.shopifySync))
const tone = computed(() => {
  if (status.value === 'dispatch_approved') return (props.queue ?? 'dispatch') === 'dispatch' ? 'danger' : 'success'
  if (['dispatch_draft', 'dispatch_missing', 'dispatch_incomplete'].includes(status.value)) return 'warning'
  if (['dispatch_complete', 'dispatch_synced'].includes(status.value)) return 'success'
  return status.value === 'dispatch_submitted' ? 'info' : 'neutral'
})
</script>

<template>
  <div class="dispatch-status">
    <WorkbenchStatusBadge :tone="tone" class="dispatch-stage" :class="(props.queue ?? 'dispatch') === 'dispatch' && status === 'dispatch_approved' ? 'sync-pending' : status.replace('dispatch_', '')">{{ taskStatusLabel(status, props.queue ?? 'dispatch')[String(locale).startsWith('zh') ? 0 : 1] }}</WorkbenchStatusBadge>
  </div>
</template>
<style scoped>
.dispatch-status{display:flex;align-items:flex-start;min-width:0;padding:4px 0}
</style>

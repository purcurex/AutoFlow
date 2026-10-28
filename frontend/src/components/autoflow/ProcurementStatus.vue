<script setup lang="ts">
import { computed } from 'vue'
import { getProcurementTaskStatus, taskStatusLabels } from '@/utils/workbench-status'
import { useI18n } from 'vue-i18n'
import type { FulfillmentProgress, ProcurementProgress } from '@/api/fop-orders'

const props = defineProps<{ progress?: ProcurementProgress; shipment: FulfillmentProgress['supplierShipment'] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const stage = computed(() => {
  const value = getProcurementTaskStatus(props.progress, props.shipment)
  const labels = taskStatusLabels[value]
  return { label: text(labels[0], labels[1]), tone: ['refund_pending', 'cancelled', 'dispatch_preparation'].includes(value) ? 'attention'
    : ['unknown', 'not_required'].includes(value) ? 'neutral'
      : ['supplier_pending', 'supplier_partial', 'shipped'].includes(value) ? 'shipping' : 'waiting' }
})
</script>

<template>
  <div class="procurement-status">
    <span class="procurement-stage" :class="stage.tone">{{ stage.label }}</span>
  </div>
</template>

<style scoped>
.procurement-status { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 138px; padding: 4px 0; }
.procurement-stage { display: inline-flex; padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.waiting { color: #a56720; background: #fbf1df; }.shipping { color: #208477; background: #e5f4f0; }
.attention { color: #b65757; background: #fbecec; }.neutral { color: #69778d; background: #eef1f6; }
.dark .waiting { color: #e5bc7f; background: #392f23; }.dark .shipping { color: #79d2b8; background: #203b38; }
.dark .attention { color: #e6a5a5; background: #402c34; }.dark .neutral { color: #acb9cd; background: #263346; }
</style>

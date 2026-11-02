<script setup lang="ts">
import SupplierShipmentStatus from './SupplierShipmentStatus.vue'
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'
import { computed } from 'vue'
import { getProcurementTaskStatus, taskStatusLabels } from '@/utils/workbench-status'
import { useI18n } from 'vue-i18n'
import type { FulfillmentProgress, ProcurementProgress } from '@/api/fop-orders'

const props = defineProps<{ progress?: ProcurementProgress; shipment: FulfillmentProgress['supplierShipment']; paidAt?: string | null; now?: number }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const stage = computed(() => {
  const value = getProcurementTaskStatus(props.progress, props.shipment)
  const labels = taskStatusLabels[value]
  return { value, label: text(labels[0], labels[1]), tone: ['refund_pending', 'cancelled'].includes(value) ? 'attention'
    : ['unknown', 'not_required'].includes(value) ? 'neutral'
      : ['supplier_pending', 'supplier_partial', 'shipped'].includes(value) ? 'shipping' : 'waiting' }
})
</script>

<template>
  <div class="procurement-status">
    <SupplierShipmentStatus v-if="stage.value === 'supplier_pending' || stage.value === 'supplier_partial'" class="procurement-stage" :shipment="stage.value === 'supplier_partial' ? 'partial' : 'pending'" :paid-at="paidAt" :now="now ?? Date.now()" />
    <WorkbenchStatusBadge v-else :tone="stage.tone === 'attention' ? 'danger' : stage.tone === 'shipping' ? 'success' : stage.tone === 'waiting' ? 'warning' : 'neutral'" class="procurement-stage" :class="stage.tone">{{ stage.label }}</WorkbenchStatusBadge>
  </div>
</template>

<style scoped>
.procurement-status{display:flex;align-items:flex-start;min-width:0;padding:4px 0}
</style>

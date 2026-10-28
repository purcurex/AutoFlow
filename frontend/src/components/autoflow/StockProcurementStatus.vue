<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'
import SupplierShipmentStatus from './SupplierShipmentStatus.vue'
import { stockStatuses, type StockPurchaseStatus } from '@/api/fop-stock'

defineProps<{ status: StockPurchaseStatus; paidAt?: string | null; now: number }>()
const { locale } = useI18n()
</script>

<template>
  <SupplierShipmentStatus v-if="status === 'purchased'" :paid-at="paidAt" :now="now" />
  <WorkbenchStatusBadge v-else :tone="['unpurchased', 'partial'].includes(status) ? 'info' : ['shipped', 'received'].includes(status) ? 'success' : 'neutral'">{{ stockStatuses[status]?.[String(locale).startsWith('zh') ? 0 : 1] ?? '—' }}</WorkbenchStatusBadge>
</template>

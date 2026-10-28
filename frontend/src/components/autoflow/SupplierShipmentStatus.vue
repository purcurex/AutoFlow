<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'
import { supplierShipmentAging } from '@/utils/procurement-payment'
import { procurementStageLabels } from '@/utils/procurement-stage'

const props = withDefaults(defineProps<{ paidAt?: string | null; now: number; shipment?: 'pending' | 'partial' }>(), { shipment: 'pending' })
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const aging = computed(() => supplierShipmentAging(props.paidAt, props.now))
const label = computed(() => procurementStageLabels[props.shipment === 'partial' ? 'supplier_partial' : 'supplier_pending'][zh.value ? 0 : 1])
const hint = computed(() => aging.value === 'danger'
  ? zh.value ? '采购付款已超过48小时，仍有商品待供应商发货' : 'Over 48 hours since procurement payment; supplier shipment still pending'
  : aging.value === 'warning' ? zh.value ? '采购付款已超过24小时，仍有商品待供应商发货' : 'Over 24 hours since procurement payment; supplier shipment still pending' : undefined)
</script>

<template>
  <WorkbenchStatusBadge class="supplier-shipment-pill" :tone="aging === 'normal' ? 'success' : aging" :data-aging="aging" :title="hint">{{ label }}</WorkbenchStatusBadge>
</template>

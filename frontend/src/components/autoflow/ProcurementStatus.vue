<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FulfillmentProgress, ProcurementProgress } from '@/api/fop-orders'

const props = defineProps<{ progress?: ProcurementProgress; shipment: FulfillmentProgress['supplierShipment'] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const placement = computed(() => props.progress?.purchaseOrder ?? 'unknown')
const payment = computed(() => props.progress?.supplierPayment ?? 'unknown')
const orderLabels = computed(() => ({ not_ordered: text('未下单', 'Not placed'), partial: text('部分下单', 'Partly placed'), ordered: text('已下单', 'Placed'), cancelled: text('已取消', 'Cancelled'), not_required: text('无需采购', 'Not required'), unknown: text('待确认', 'Unconfirmed') }))
const paymentLabels = computed(() => ({ unpaid: text('未支付', 'Unpaid'), partial: text('部分支付', 'Partly paid'), paid: text('已支付', 'Paid'), refunded: text('退款待跟进', 'Refund follow-up'), not_required: text('暂无应付', 'Nothing payable'), unknown: text('待确认', 'Unconfirmed') }))
// Show the earliest outstanding step; independent facts remain visible for mixed purchases.
const stage = computed(() => {
  if (payment.value === 'refunded') return { label: text('采购退款待跟进', 'Purchase refund follow-up'), tone: 'attention' }
  switch (placement.value) {
    case 'cancelled': return { label: text('采购单已取消', 'Purchase order cancelled'), tone: 'attention' }
    case 'not_ordered': return { label: text('待下采购单', 'Purchase order pending'), tone: 'waiting' }
    case 'partial': return { label: text('部分下单', 'Partly ordered'), tone: 'waiting' }
    case 'not_required': return { label: text('无需采购', 'Purchase not required'), tone: 'neutral' }
    case 'ordered': break
    default: return { label: text('采购下单待确认', 'Purchase placement unconfirmed'), tone: 'neutral' }
  }
  if (payment.value === 'unpaid') return { label: text('待付采购款', 'Supplier payment pending'), tone: 'waiting' }
  if (payment.value === 'partial') return { label: text('采购款部分支付', 'Supplier partly paid'), tone: 'waiting' }
  if (payment.value !== 'paid') return { label: text('采购付款待确认', 'Supplier payment unconfirmed'), tone: 'neutral' }
  if (props.shipment === 'partial') return { label: text('供应商部分发货', 'Supplier partly shipped'), tone: 'shipping' }
  if (props.shipment === 'pending') return { label: text('供应商待发货', 'Awaiting supplier shipment'), tone: 'shipping' }
  if (props.shipment === 'shipped') return { label: text('供应商已发货', 'Supplier shipped'), tone: 'shipping' }
  return { label: text('供应商发货待确认', 'Supplier shipment unconfirmed'), tone: 'neutral' }
})
</script>

<template>
  <div class="procurement-status">
    <span class="procurement-stage" :class="stage.tone">{{ stage.label }}</span>
    <span class="procurement-fact">{{ text('下单', 'Placement') }}：{{ orderLabels[placement] }}</span>
    <span class="procurement-fact">{{ text('采购款', 'Supplier payment') }}：{{ paymentLabels[payment] }}</span>
  </div>
</template>

<style scoped>
.procurement-status { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 138px; padding: 4px 0; }
.procurement-stage { display: inline-flex; padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: 500; white-space: nowrap; }
.procurement-fact { color: var(--color-text-secondary); font-size: 10px; white-space: nowrap; line-height: 1.5; }
.waiting { color: #a56720; background: #fbf1df; }.shipping { color: #208477; background: #e5f4f0; }
.attention { color: #b65757; background: #fbecec; }.neutral { color: #69778d; background: #eef1f6; }
.dark .waiting { color: #e5bc7f; background: #392f23; }.dark .shipping { color: #79d2b8; background: #203b38; }
.dark .attention { color: #e6a5a5; background: #402c34; }.dark .neutral { color: #acb9cd; background: #263346; }
</style>

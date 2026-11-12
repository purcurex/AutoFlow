<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FopOrderAmountBreakdown } from '@/api/fop-orders'
import { formatKnownCurrency } from '@/utils/currency'
import InfoTip from './InfoTip.vue'

const props = defineProps<{ amount: number | null; currency: string | null; breakdown?: FopOrderAmountBreakdown | null }>()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const money = (value: number | null) => formatKnownCurrency(value, props.currency, String(locale.value))
const details = computed(() => [
  { key: 'productAmount' as const, label: zh.value ? '产品' : 'Products' },
  { key: 'shippingFee' as const, label: zh.value ? '运费' : 'Shipping' },
  { key: 'taxAmount' as const, label: zh.value ? '税费' : 'Tax' },
  { key: 'discountAmount' as const, label: zh.value ? '优惠' : 'Discount' },
].map(row => {
  const value = props.breakdown?.[row.key]
  return { ...row, value: typeof value !== 'number' || !Number.isFinite(value) ? '—'
    : row.key === 'discountAmount' && value !== 0 ? `${value > 0 ? '−' : '+'}${money(Math.abs(value))}` : money(value) }
}))
</script>

<template>
  <InfoTip class="order-amount" placement="top" :label="`${zh ? '订单金额明细' : 'Order amount breakdown'} ${money(amount)}`">
    <template #trigger>{{ money(amount) }}</template>
    <div class="amount-popover">
      <dl class="order-amount-details">
        <div v-for="detail in details" :key="detail.key" class="order-amount-detail"><dt>{{ detail.label }}</dt><dd>{{ detail.value }}</dd></div>
      </dl>
      <div class="amount-popover-total"><span>{{ zh ? '总金额' : 'Total' }}</span><strong>{{ money(amount) }}</strong></div>
    </div>
  </InfoTip>
</template>

<style scoped>
.order-amount { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.order-amount :deep(.info-tip-trigger) { border-bottom: 1px dashed var(--color-text-secondary); line-height: 1.65; }
.amount-popover { width: 256px; max-width: calc(100vw - 64px); padding: 3px 6px; font-variant-numeric: tabular-nums; }
.order-amount-details { display: grid; gap: 7px; margin: 0; font-size: 13px; line-height: 1.5; }
.order-amount-detail { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: baseline; gap: 24px; }
.order-amount-detail dt { color: var(--color-text-secondary); }
.order-amount-detail dd { margin: 0; color: var(--color-text); text-align: right; overflow-wrap: anywhere; }
.amount-popover-total { display: flex; justify-content: space-between; align-items: baseline; gap: 24px; margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--color-border); color: var(--color-text); font-size: 13px; font-weight: 600; line-height: 1.5; }
.amount-popover-total strong { font-weight: 650; overflow-wrap: anywhere; }
</style>

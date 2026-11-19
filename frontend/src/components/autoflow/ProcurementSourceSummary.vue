<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProcurementSource } from '@/api/fop-orders'

const props = defineProps<{ source?: ProcurementSource | null }>()
defineEmits<{ open: [] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const summary = computed(() => {
  if (!props.source) return ''
  const quantities = [
    [text('全款', 'Full'), props.source.fullPaymentQuantity],
    [text('押金', 'Deposit'), props.source.depositQuantity],
    [text('直采', 'Direct'), props.source.directQuantity],
  ].filter(([, value]) => typeof value === 'string' && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && /[1-9]/.test(value))
    .map(([label, value]) => `${label} ${value}`).join(' · ')
  return quantities || (!props.source.complete ? text('来源数据待补齐', 'Source details incomplete') : '')
})
const hint = computed(() => [props.source && props.source.lineIds.length > 1 ? text('SKU合计', 'SKU total') : '', summary.value, props.source && !props.source.complete && summary.value !== text('来源数据待补齐', 'Source details incomplete') ? text('其余来源数据待补齐', 'Remaining source details incomplete') : ''].filter(Boolean).join(' · '))
</script>

<template>
  <button v-if="summary" type="button" class="procurement-source-summary" :title="hint" :aria-label="`${text('查看采购来源', 'View procurement sources')} · ${source?.sku || source?.skuId} · ${hint}`" aria-haspopup="dialog" @click="$emit('open')">{{ summary }}</button>
</template>

<style scoped>
.procurement-source-summary { display: block; align-self: start; min-width: 0; width: 100%; padding: 1px 0; border: 0; border-radius: 3px; background: transparent; color: var(--color-text-secondary); font: inherit; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: left; cursor: pointer; }
.procurement-source-summary:hover { color: var(--color-text); text-decoration: underline; text-underline-offset: 3px; }
.procurement-source-summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
</style>

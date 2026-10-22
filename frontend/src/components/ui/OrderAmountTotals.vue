<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { FopOrderTotals } from '@/api/fop-orders'
import { formatCurrency } from '@/utils/currency'
defineProps<{ totals?: FopOrderTotals }>()
const { locale } = useI18n()
</script>

<template>
  <span v-if="!totals">—</span>
  <span v-else-if="!totals.orderCount">{{ formatCurrency(0, 'USD', String(locale)) }}</span>
  <template v-else><span v-for="item in totals.amountsByCurrency" :key="item.currency" class="order-currency-total">{{ formatCurrency(item.amount, item.currency, String(locale)) }}</span></template>
</template>

<style scoped>
.order-currency-total { display: block; white-space: nowrap; line-height: 1.7; }
</style>

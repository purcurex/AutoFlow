<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatReceiptChange, type ReceiptChange } from '@/utils/receiptChanges'
const props = defineProps<{ value?: ReceiptChange }>()
const { locale } = useI18n()
const formatted = computed(() => formatReceiptChange(props.value, String(locale.value)))
</script>
<template><span class="receipt-change"><span class="change-amount">{{ formatted.amount }}</span><span class="change-percent" :class="formatted.direction">{{ formatted.percent }}</span></span></template>
<style scoped>
.receipt-change{display:inline-flex;flex-direction:column;align-items:flex-end;gap:4px;font-variant-numeric:tabular-nums}
.change-amount{font-weight:600}.change-percent{font-size:10px;font-weight:500;line-height:1.5;padding:1px 5px;border-radius:4px;white-space:nowrap}
.up{color:#267e6f;background:#64bdb116}.down{color:#b65b6d;background:#e49aa51b}.flat{color:#8793a7;background:#8793a70d}
:global(.dark) .up{color:#7ccdbb}:global(.dark) .down{color:#e8a1ae}
</style>

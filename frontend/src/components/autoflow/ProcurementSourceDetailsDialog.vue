<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import StockCopy from './StockCopy.vue'
import type { ProcurementSource, ProcurementSourceRecord } from '@/api/fop-orders'
import { orderTimestamp } from '@/utils/order-timestamp'

const props = defineProps<{ source: ProcurementSource; orderNumber: string }>()
defineEmits<{ close: [] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const known = (value: string | null | undefined) => value?.trim() || '—'
const documentLabels = { full_payment: ['全款采购单', 'Fully paid stock purchase order'], deposit: ['押金备货单', 'Deposit stock order'], direct: ['直采采购单', 'Direct purchase order'] } as const
const documentGroups = computed(() => (['full_payment', 'deposit', 'direct'] as const).filter(key => Number(props.source[{ full_payment: 'fullPaymentQuantity', deposit: 'depositQuantity', direct: 'directQuantity' }[key] as keyof ProcurementSource]) > 0).map(key => props.source.documentGroups?.find(group => group.source === key) ?? { source: key, documents: [], unresolved: true }))
const stockType = (value: ProcurementSourceRecord['stockType']) => value === '1' ? text('全款备货', 'Fully paid stock') : value === '2' ? text('押金备货', 'Deposit stock') : '—'
const status = (value: ProcurementSourceRecord['status']) => value === '0' ? text('待使用（预占）', 'Reserved (awaiting use)') : value === '1' ? text('已使用（支付确认）', 'Used (payment confirmed)') : '—'
const stockPurchaseLabels: Record<string, readonly [string, string]> = { '0': ['未采购', 'Not purchased'], '1': ['采购中', 'Procurement in progress'], '2': ['已采购', 'Purchased'], '4': ['已发货', 'Shipped'], '3': ['已入库', 'Received'] }
const stockPurchaseLabel = (value: ProcurementSourceRecord['stockPurchaseStatus']) => {
  const label = value && Object.hasOwn(stockPurchaseLabels, value) ? stockPurchaseLabels[value] : undefined
  return label ? text(...label) : '—'
}
function usedTime(value: string | null) {
  const timestamp = orderTimestamp(value)
  return timestamp === null ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
}
</script>

<template>
  <OrganizationModal :title="text('采购来源明细', 'Procurement source details')" size="compact" @close="$emit('close')">
    <div class="procurement-source-details">
      <div class="source-identity">
        <strong>SKU · {{ source.sku || source.skuId }}</strong>
        <div v-for="group in documentGroups" :key="group.source" class="source-documents" :data-document-source="group.source">
          <span class="source-document-label">{{ text(documentLabels[group.source][0], documentLabels[group.source][1]) }}</span>
          <div class="source-document-values"><StockCopy v-for="document in group.documents" :key="document.id" class="source-document-number" :value="document.number" /><span v-if="group.unresolved" class="source-document-missing">{{ group.documents.length ? text('部分单据暂未关联', 'Some documents are not linked yet') : text('暂未关联', 'Not linked yet') }}</span></div>
        </div>
      </div>
      <div class="source-demand"><p><span>{{ text('SKU需求数量', 'SKU demand') }}</span><strong>{{ known(source.demandQuantity) }}</strong></p><p data-source="direct"><span>{{ text('直接采购', 'Direct purchase') }}</span><strong>{{ known(source.directQuantity) }}</strong></p></div>
      <p v-if="!source.complete" class="source-incomplete">{{ text('来源数据待补齐', 'Source details incomplete') }}</p>
      <table class="source-balances">
        <caption>{{ text('备货数量', 'Stock quantities') }}</caption>
        <thead><tr><th scope="col">{{ text('来源', 'Source') }}</th><th scope="col">{{ text('数量', 'Quantity') }}</th><th scope="col">{{ text('预占', 'Reserved') }}</th><th scope="col">{{ text('已使用', 'Used') }}</th></tr></thead>
        <tbody>
          <tr data-source="full_payment"><th scope="row">{{ text('全款备货', 'Fully paid stock') }}</th><td>{{ known(source.fullPaymentQuantity) }}</td><td>{{ known(source.fullPaymentReserved) }}</td><td>{{ known(source.fullPaymentUsed) }}</td></tr>
          <tr data-source="deposit"><th scope="row">{{ text('押金备货', 'Deposit stock') }}</th><td>{{ known(source.depositQuantity) }}</td><td>{{ known(source.depositReserved) }}</td><td>{{ known(source.depositUsed) }}</td></tr>
        </tbody>
      </table>
      <div class="source-record-scroll">
        <table class="procurement-source-records">
          <caption>{{ text('备货耗用记录', 'Stock consumption records') }}</caption>
          <thead><tr><th scope="col">{{ text('备货单号 / 记录ID', 'Stock order / Record ID') }}</th><th scope="col">{{ text('类型', 'Type') }}</th><th scope="col">{{ text('数量', 'Quantity') }}</th><th scope="col">{{ text('状态', 'Status') }}</th><th scope="col">{{ text('使用时间', 'Used at') }}<small>UTC+8</small></th></tr></thead>
          <tbody><tr v-for="(record, index) in source.records" :key="`${record.stockId}:${record.recordId}:${index}`"><td><template v-if="record.stockNumber?.trim()">{{ record.stockNumber.trim() }}</template><template v-else><small class="source-id-label">{{ text('备货记录ID', 'Stock record ID') }}</small>{{ known(record.stockId) }}</template></td><td>{{ stockType(record.stockType) }}<small class="source-stock-purchase-status" :title="text('备货采购状态', 'Stock purchase status')">{{ stockPurchaseLabel(record.stockPurchaseStatus) }}</small></td><td>{{ known(record.quantity) }}</td><td>{{ status(record.status) }}</td><td>{{ usedTime(record.usedAt) }}</td></tr><tr v-if="!source.records.length"><td colspan="5" class="source-empty">{{ source.complete ? text('暂无备货耗用记录', 'No stock consumption records') : text('耗用明细待补齐', 'Stock consumption details incomplete') }}</td></tr></tbody>
        </table>
      </div>
    </div>
  </OrganizationModal>
</template>

<style scoped>
.procurement-source-details { color: var(--color-text); font-size: 12px; }
.source-identity { display: flex; flex-direction: column; gap: 5px; overflow-wrap: anywhere; }
.source-identity strong { font-size: 15px; font-weight: 600; }
.source-documents { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 10px; align-items: baseline; line-height: 1.7; }
.source-document-label, .source-document-missing, .source-demand span, .source-incomplete { color: var(--color-text-secondary); }
.source-document-values { display: flex; flex-wrap: wrap; column-gap: 14px; row-gap: 3px; }
.source-document-number { white-space: nowrap; font-variant-numeric: tabular-nums; }
.source-demand { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 14px 0; }
.source-demand p { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.source-demand strong { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
.source-incomplete { margin: 0 0 12px; font-size: 11px; }
.procurement-source-details table { width: 100%; border-collapse: collapse; text-align: left; font-variant-numeric: tabular-nums; }
.procurement-source-details caption { padding: 0 0 9px; text-align: left; color: var(--color-text); font-size: 12px; font-weight: 600; }
.procurement-source-details th, .procurement-source-details td { padding: 9px 8px; border-bottom: 1px solid var(--color-border); line-height: 1.5; overflow-wrap: anywhere; }
.procurement-source-details thead { color: var(--color-text-secondary); background: var(--color-surface-muted); }
.procurement-source-details th { font-weight: 500; }
.source-record-scroll { margin-top: 20px; overflow-x: auto; }
.procurement-source-records { min-width: 450px; font-size: 11px; }
.procurement-source-records small { display: block; font-size: 10px; font-weight: 400; }
.source-id-label, .source-stock-purchase-status { color: var(--color-text-secondary); }
.procurement-source-records .source-empty { text-align: center; color: var(--color-text-secondary); }
</style>

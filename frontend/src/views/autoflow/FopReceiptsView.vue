<script setup lang="ts">
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import TableTotals from '@/components/ui/TableTotals.vue'
import { getFopReceipts, type FopReceiptPage, type FopReceiptQuery, type ReceiptSource } from '@/api/fop-receipts'
import { getOrderVolumeReceipts, type OrderVolumeDetailsQuery } from '@/api/fop-order-volume'
import { fopAccessError } from '@/api/fop-access'
import { formatChartCurrency } from '@/utils/currency'
import { isWorkbenchRole } from '@/utils/workbench'
import { onSessionReset } from '@/utils/session'
import '@/components/order-volume/order-volume.css'

const route = useRoute(), router = useRouter(), { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const data = ref<FopReceiptPage>(), busy = ref(false), error = ref(''), failedImages = ref(new Set<string>())
const textQuery = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : undefined
const page = computed(() => Number(textQuery('page') || 1)), pageSize = computed(() => Number(textQuery('pageSize') || 20))
const departmentNames = computed<Record<string, string>>(() => ({ sales1: t('业务一部', 'Sales I'), sales2: t('业务二部', 'Sales II'), sales3: t('业务三部', 'Sales III'), sales4: t('业务四部', 'Sales IV') }))
const warehouseNames = computed<Record<string, string>>(() => ({ ALL: t('全部仓库', 'All warehouses'), HZ: t('杭州仓', 'Hangzhou'), SZ: t('深圳仓', 'Shenzhen') }))
const selectedOwnerName = computed(() => {
  const ownerId = textQuery('ownerId')
  return ownerId ? data.value?.items.find(receipt => receipt.owner?.id === ownerId)?.owner?.name || t('所选业务员', 'Selected salesperson') : undefined
})
const summary = computed(() => [
  textQuery('periodId') || `${textQuery('from') || '—'} — ${textQuery('to') || '—'}`,
  textQuery('department') ? departmentNames.value[textQuery('department')!] || t('所选部门', 'Selected department') : t('获授权范围', 'Authorized scope'),
  selectedOwnerName.value,
  warehouseNames.value[textQuery('detailWarehouse') || textQuery('warehouse') || 'ALL'] || t('所选仓库', 'Selected warehouse'),
].filter(Boolean).join(' · '))
const carrierName = (code: string | null) => code ? ({ YT: '云途YT', '4PX': '4PX', WB: '万邦WB', YW: '燕文YW', JS: '极速JS', OTHER: t('其他', 'Other') } as Record<string, string>)[code] || t('其他', 'Other') : '—'
const sourceName = (source: ReceiptSource) => source === 'fulfillment' ? t('履约订单', 'Fulfillment') : source === 'full_payment_stock' ? t('全款备货', 'Full-payment stocking') : t('押金备货', 'Deposit stocking')
const money = (amount: number) => formatChartCurrency(amount, String(locale.value))
const date = (value: string) => new Date(value).toLocaleString(String(locale.value), { timeZone: 'Asia/Shanghai', hour12: false })
const { requireDetails } = useChartAccess(() => textQuery('mode') === 'customer' ? 'customer_orders' : 'salesperson_receipts')
let requestId = 0
async function load() {
  const id = ++requestId
  data.value = undefined; error.value = ''; busy.value = true
  try {
    if (textQuery('chartId') && textQuery('chartId') !== 'salesperson_receipts') throw { code: 'chart_details_denied' }
    await requireDetails()
    if (id !== requestId) return
    const role = route.params.role
    if (!isWorkbenchRole(role)) throw new Error('Invalid role')
    const base = { warehouse: textQuery('warehouse') || 'ALL', workbenchRole: role, page: page.value, pageSize: pageSize.value }
    let result: FopReceiptPage
    if (textQuery('mode') === 'customer') {
      const query = { ...base, category: 'customer' } as OrderVolumeDetailsQuery
      for (const key of ['from', 'to', 'department', 'objectId', 'customerId', 'grain', 'weekOf', 'seriesId', 'periodId', 'detailWarehouse'] as const) {
        const value = textQuery(key); if (value) Object.assign(query, { [key]: value })
      }
      for (const key of ['year', 'month'] as const) if (textQuery(key)) query[key] = Number(textQuery(key))
      result = await getOrderVolumeReceipts(query)
    } else {
      const query = { ...base, from: textQuery('from') || '', to: textQuery('to') || '' } as FopReceiptQuery
      for (const key of ['department', 'ownerId', 'customerId', 'sourceType'] as const) {
        const value = textQuery(key); if (value) Object.assign(query, { [key]: value })
      }
      result = await getFopReceipts(query)
    }
    if (id === requestId) data.value = result
  } catch (cause) { if (id === requestId) error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) }
  finally { if (id === requestId) busy.value = false }
}
watch(() => route.fullPath, load, { immediate: true })
const off = onSessionReset(() => { requestId++; data.value = undefined; error.value = ''; busy.value = false })
onBeforeUnmount(() => { requestId++; off() })
function changeSource(event: Event) {
  const sourceType = (event.target as HTMLSelectElement).value || undefined
  void router.push({ query: { ...route.query, sourceType, page: 1 } })
}
function navigate(value: number) { void router.push({ query: { ...route.query, page: value } }) }
</script>

<template>
  <section class="ov-panel receipt-list">
    <header class="ov-header"><div class="ov-heading"><h2>{{ t('回款明细', 'Receipt details') }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2><p>{{ summary }}</p><p>{{ t('UTC+8 · 已支付、已审核的履约订单及全款备货实际收款 · 押金备货不计入 · $', 'UTC+8 · Actual receipts for paid, approved fulfillment and full-payment stocking · Deposits excluded · $') }}</p></div><div class="ov-filters"><label v-if="textQuery('mode') !== 'customer'">{{ t('回款来源', 'Source') }}<select :value="textQuery('sourceType') || ''" :aria-label="t('回款来源', 'Receipt source')" @change="changeSource"><option value="">{{ t('全部来源', 'All sources') }}</option><option value="fulfillment">{{ t('履约订单', 'Fulfillment') }}</option><option value="full_payment_stock">{{ t('全款备货', 'Full-payment stocking') }}</option></select></label><button class="ov-secondary" @click="router.back()">{{ t('返回分析', 'Back to analysis') }}</button><button class="ov-secondary" :disabled="busy" @click="load">{{ t('刷新', 'Refresh') }}</button></div></header>
    <div class="ov-body"><p v-if="busy" class="ov-empty" role="status">{{ t('正在读取回款…', 'Loading receipts…') }}</p><p v-else-if="error" class="ov-error" role="alert">{{ error }}</p><template v-else-if="data">
      <div class="ov-kpis"><div><span>{{ t('回款业绩金额', 'Collections performance') }}</span><strong>{{ money(data.totals.amount) }}</strong></div><div><span>{{ t('履约订单', 'Fulfillment') }}</span><b>{{ money(data.totals.fulfillmentAmount) }}</b></div><div><span>{{ t('全款备货', 'Full-payment stocking') }}</span><b>{{ money(data.totals.fullPaymentStockAmount) }}</b></div></div>
      <div class="ov-pagination"><span>{{ t('共', 'Total') }} {{ data.total }} {{ t('笔回款', 'receipts') }}</span><button :disabled="page <= 1" @click="navigate(page - 1)">{{ t('上一页', 'Previous') }}</button><span>{{ page }} / {{ Math.max(1, Math.ceil(data.total / pageSize)) }}</span><button :disabled="page * pageSize >= data.total" @click="navigate(page + 1)">{{ t('下一页', 'Next') }}</button></div>
      <div class="ov-table-scroll"><table class="ov-table"><thead><tr><th>{{ t('回款来源 / 单据', 'Source / Document') }}</th><th>{{ t('客户 / 编码', 'Customer / Code') }}</th><th>{{ t('商品 / SKU / 数量', 'Product / SKU / Quantity') }}</th><th>{{ t('实际收款', 'Actual receipt') }}</th><th>{{ t('单据金额 / 手续费', 'Document amount / Fee') }}</th><th>{{ t('组织 / 部门', 'Organization / Department') }}</th><th>{{ t('业务员', 'Salesperson') }}</th><th>{{ t('仓库 / 物流服务商', 'Warehouse / Logistics provider') }}</th><th>{{ t('支付时间 · UTC+8', 'Paid at · UTC+8') }}</th></tr></thead>
      <tbody><tr v-for="receipt in data.items" :key="receipt.id"><td><strong>{{ sourceName(receipt.sourceType) }}</strong><small class="receipt-block">{{ receipt.documentNumber }}</small></td><td>{{ receipt.customerName }}<small class="receipt-block">{{ receipt.customerCode }}</small></td><td><div v-for="item in receipt.items" :key="item.sku" class="receipt-product"><img v-if="item.imageUrl && !failedImages.has(item.sku)" :src="item.imageUrl" :alt="item.name" @error="failedImages.add(item.sku)"><span v-else class="receipt-product-placeholder">SKU</span><span>{{ item.name }}<small class="receipt-block">{{ item.sku }} · {{ item.variant }} · ×{{ item.quantity }}</small></span></div></td><td>{{ money(receipt.amount) }}</td><td>{{ money(receipt.orderAmount) }}<small class="receipt-block">{{ t('手续费', 'Fee') }} {{ money(receipt.handlingFee) }}</small></td><td>{{ receipt.organization?.name || '—' }}<small class="receipt-block">{{ receipt.department?.name || '—' }}</small></td><td>{{ receipt.owner?.name || '—' }}</td><td>{{ receipt.warehouse }}<small class="receipt-block">{{ receipt.sourceType === 'full_payment_stock' ? t('不适用', 'Not applicable') : carrierName(receipt.carrierCode) }}</small></td><td>{{ date(receipt.paidAt) }}</td></tr><tr v-if="!data.items.length"><td colspan="9" class="ov-empty">{{ t('当前条件下无可查看的回款。', 'No authorized receipts match these filters.') }}</td></tr></tbody>
      <TableTotals><th scope="row" colspan="3">{{ t('筛选合计', 'Filtered total') }} · {{ data.totals.receiptCount.toLocaleString() }} {{ t('笔回款', 'receipts') }}</th><td>{{ money(data.totals.amount) }}</td><td>{{ money(data.totals.orderAmount) }}<small class="receipt-block">{{ t('手续费', 'Fee') }} {{ money(data.totals.handlingFee) }}</small></td><td colspan="4">{{ t('履约订单', 'Fulfillment') }} {{ money(data.totals.fulfillmentAmount) }} · {{ t('全款备货', 'Full-payment stocking') }} {{ money(data.totals.fullPaymentStockAmount) }}</td></TableTotals></table></div>
    </template></div>
  </section>
</template>
<style scoped>
.receipt-list{margin-top:0}.receipt-list .ov-table :is(th,td){text-align:left;vertical-align:middle}.receipt-block{display:block;margin:6px 0 0!important;font-weight:400;color:#8793a7}.receipt-product{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:11px}.receipt-product img,.receipt-product-placeholder{height:42px;width:42px;flex-shrink:0;object-fit:contain;background:#f2f5fa;border-radius:6px}.receipt-product-placeholder{display:grid;place-items:center;color:#8793a7;font-size:9px}
</style>

<script setup lang="ts">
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import TableTotals from '@/components/ui/TableTotals.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getOrderVolumeDetails, type OrderVolumeDetailsQuery } from '@/api/fop-order-volume'
import type { FopOrderPage } from '@/api/fop-orders'
import { fopAccessError } from '@/api/fop-access'
import { formatCurrency } from '@/utils/currency'
import { isWorkbenchRole } from '@/utils/workbench'
import { onSessionReset } from '@/utils/session'
import '@/components/order-volume/order-volume.css'
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const data = ref<FopOrderPage>(), busy = ref(false), error = ref(''), failedImages = ref(new Set<string>())
const page = computed(() => Number(route.query.page ?? 1)), pageSize = computed(() => Number(route.query.pageSize ?? 20))
const textQuery = (name: string) => typeof route.query[name] === 'string' ? route.query[name] as string : undefined
const summary = computed(() => [textQuery('periodId') || (textQuery('from') && textQuery('to') ? `${textQuery('from')} — ${textQuery('to')}` : textQuery('grain') === 'day' ? `${textQuery('year')}-${textQuery('month')}` : textQuery('grain') === 'week' ? `${textQuery('weekOf')} ${t('所在周及前三周', 'and preceding three weeks')}` : `${textQuery('year')} ${t('年', '')}`), textQuery('department') ? ({ sales1: '业务一部', sales2: '业务二部', sales3: '业务三部', sales4: '业务四部' } as Record<string, string>)[textQuery('department')!] : t('获授权范围', 'Authorized scope'), ({ HZ: '杭州仓', SZ: '深圳仓', UNASSIGNED: '未分配仓库' } as Record<string, string>)[textQuery('detailWarehouse') || textQuery('warehouse') || ''] || t('全部仓库', 'All warehouses')].filter(Boolean).join(' · '))
const { requireDetails } = useChartAccess(() => textQuery('category') === 'customer' ? 'customer_orders' : 'order_volume')
let requestId = 0
async function load() {
  const id = ++requestId
  data.value = undefined; error.value = ''; busy.value = true
  try {
    if (textQuery('view') === 'summary') throw { code: 'chart_details_denied' }
    await requireDetails()
    if (id !== requestId) return
    const role = route.params.role
    if (!isWorkbenchRole(role)) throw new Error('Invalid role')
    const query = { category: textQuery('category'), ...(textQuery('grain') ? { grain: textQuery('grain') } : {}), ...(textQuery('year') ? { year: Number(textQuery('year')) } : {}), warehouse: textQuery('warehouse') || 'ALL', workbenchRole: role, page: page.value, pageSize: pageSize.value } as OrderVolumeDetailsQuery
    for (const key of ['from', 'to', 'department', 'objectId', 'customerId', 'weekOf', 'seriesId', 'periodId', 'detailWarehouse'] as const) {
      const value = textQuery(key)
      if (value) Object.assign(query, { [key]: value })
    }
    if (textQuery('month')) query.month = Number(textQuery('month'))
    const result = await getOrderVolumeDetails(query)
    if (id === requestId) data.value = result
  } catch (cause) { if (id === requestId) error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) }
  finally { if (id === requestId) busy.value = false }
}
watch(() => route.fullPath, load, { immediate: true })
const off = onSessionReset(() => { requestId++; data.value = undefined; busy.value = false })
onBeforeUnmount(() => { requestId++; off() })
function navigate(value: number) { void router.push({ query: { ...route.query, page: value } }) }
const date = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
</script>

<template>
  <section class="ov-panel ov-order-list">
    <header class="ov-header"><div class="ov-heading"><h2>{{ t('订单量统计明细清单', 'Order volume detail list') }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2><p>{{ summary }}</p><p>{{ t('按订单支付日期统计 · UTC+8 · 继承图表筛选及当前账号权限 · 金额默认 USD', 'By order payment date · UTC+8 · Chart filters and current account permissions · Default currency USD') }}</p></div><div class="ov-filters"><button class="ov-secondary" @click="router.back()">{{ t('返回分析', 'Back to analysis') }}</button><button class="ov-secondary" :disabled="busy" @click="load">{{ t('刷新', 'Refresh') }}</button></div></header>
    <div class="ov-body"><p v-if="busy" class="ov-empty" role="status">{{ t('正在读取订单…', 'Loading orders…') }}</p><p v-else-if="error" class="ov-error" role="alert">{{ error }}</p><template v-else-if="data"><div class="ov-pagination"><span>{{ t('共', 'Total') }} {{ data.total }} {{ t('笔订单', 'orders') }}</span><button :disabled="page <= 1" @click="navigate(page - 1)">{{ t('上一页', 'Previous') }}</button><span>{{ page }} / {{ Math.max(1, Math.ceil(data.total / pageSize)) }}</span><button :disabled="page * pageSize >= data.total" @click="navigate(page + 1)">{{ t('下一页', 'Next') }}</button></div>
      <div class="ov-table-scroll"><table class="ov-table"><thead><tr><th>{{ t('订单编号 / Shopify', 'Order / Shopify') }}</th><th>{{ t('客户 / 编码', 'Customer / Code') }}</th><th>{{ t('商品 / SKU / 数量', 'Product / SKU / Quantity') }}</th><th>{{ t('支付状态', 'Payment') }}</th><th>{{ t('订单金额', 'Amount') }}</th><th>{{ t('组织 / 部门', 'Organization / Department') }}</th><th>{{ t('业务员', 'Salesperson') }}</th><th>{{ t('仓库 / 服务商', 'Warehouse / Carrier') }}</th><th>{{ t('支付时间', 'Paid at') }}</th><th>{{ t('创建时间', 'Created at') }}</th></tr></thead><tbody><tr v-for="order in data.items" :key="order.id"><td><strong>{{ order.orderNumber }}</strong><small class="ov-block">{{ order.shopifyOrderNumber }}</small></td><td>{{ order.customerName }}<small class="ov-block">{{ order.customerCode || '—' }}</small></td><td><div v-for="item in order.items" :key="item.sku" class="ov-product"><img v-if="item.imageUrl && !failedImages.has(item.sku)" :src="item.imageUrl" :alt="item.name" @error="failedImages.add(item.sku)"><span v-else class="ov-product-placeholder">SKU</span><span>{{ item.name }}<small class="ov-block">{{ item.sku }} · {{ item.variant }} · ×{{ item.quantity }}</small></span></div></td><td><span class="ov-payment" :class="order.paymentStatus">{{ order.paymentStatus === 'paid' ? t('已支付', 'Paid') : order.paymentStatus === 'unpaid' ? t('未支付', 'Unpaid') : t('已退款', 'Refunded') }}</span></td><td>{{ formatCurrency(order.amount, order.currency, String(locale)) }}</td><td>{{ order.organization?.name || '—' }}<small class="ov-block">{{ order.department?.name || '—' }}</small></td><td>{{ order.owner?.name || order.salesperson }}</td><td>{{ order.warehouse }}<small class="ov-block">{{ order.carrier || t('其他', 'Other') }}</small></td><td>{{ date(order.paidAt) }}</td><td>{{ date(order.createdAt) }}</td></tr><tr v-if="!data.items.length"><td colspan="10" class="ov-empty">{{ t('当前条件下无可查看的订单。', 'No authorized orders match these filters.') }}</td></tr></tbody><TableTotals><th scope="row" colspan="2">{{ t('筛选合计', 'Filtered total') }} · {{ data.totals?.orderCount.toLocaleString() ?? '—' }} {{ t('笔订单', 'orders') }}</th><td>{{ t('商品数量', 'Item quantity') }} · {{ data.totals?.itemQuantity.toLocaleString() ?? '—' }}</td><td>—</td><td><OrderAmountTotals :totals="data.totals" /></td><td colspan="5"><small>{{ t('全部筛选结果 · 金额按币种汇总', 'All filtered results · Amounts grouped by currency') }}</small></td></TableTotals></table></div></template></div>
  </section>
</template>
<style scoped>
.ov-order-list{margin-top:0}.ov-order-list .ov-table :is(th,td){text-align:left;vertical-align:middle}.ov-block{display:block;margin:6px 0 0!important;font-weight:400;color:#8793a7}.ov-product{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:11px}.ov-product img,.ov-product-placeholder{height:42px;width:42px;flex-shrink:0;object-fit:contain;background:#f2f5fa;border-radius:6px}.ov-product-placeholder{display:grid;place-items:center;color:#8793a7;font-size:9px}.ov-payment{padding:4px 7px;border-radius:4px;background:#e7b96c18;color:#b38c46}.ov-payment.paid{background:#64bdb118;color:#549b90}
</style>

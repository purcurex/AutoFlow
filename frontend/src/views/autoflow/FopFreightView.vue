<script setup lang="ts">
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getFopFreightDetails, type FreightCarrier, type FreightDetailsQuery, type FreightGrain, type FreightPage } from '@/api/fop-freight'
import { fopAccessError } from '@/api/fop-access'
import { freightCarriers, freightCarrierName } from '@/utils/freight'
import { formatChartCurrency } from '@/utils/currency'
import { isWorkbenchRole } from '@/utils/workbench'
import { onSessionReset } from '@/utils/session'
import TableTotals from '@/components/ui/TableTotals.vue'
import '@/components/order-volume/order-volume.css'
import '@/components/freight/freight.css'

const route = useRoute(), router = useRouter(), { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const textQuery = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : undefined
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), currentYear = Number(today.slice(0, 4))
const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)
const data = ref<FreightPage>(), busy = ref(false), error = ref('')
const page = computed(() => Number(textQuery('page') || 1)), pageSize = computed(() => Number(textQuery('pageSize') || 20))
const money = (amount: number) => formatChartCurrency(amount, String(locale.value))
const original = (amount: number, currency: string) => `${currency} ${new Intl.NumberFormat(String(locale.value), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
const date = (value: string | null) => value ? new Date(value).toLocaleString(String(locale.value), { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
const warehouse = computed(() => textQuery('warehouse') || 'ALL')
const grain = computed(() => textQuery('grain') || 'month'), year = computed(() => Number(textQuery('year') || currentYear))
const warehouseNames = computed<Record<string, string>>(() => ({ ALL: t('全部仓库', 'All warehouses'), HZ: t('杭州仓', 'Hangzhou'), SZ: t('深圳仓', 'Shenzhen') }))
const summary = computed(() => [data.value ? `${data.value.range.from} — ${data.value.range.to}` : textQuery('periodId') || year.value, warehouseNames.value[warehouse.value], textQuery('carrierCode') && freightCarriers.includes(textQuery('carrierCode') as FreightCarrier) ? freightCarrierName(textQuery('carrierCode') as FreightCarrier, String(locale.value)) : t('全部服务商', 'All carriers'), textQuery('comparisonPeriod') === 'previous' ? t('完整上期', 'Full previous period') : t('本期', 'Current period')].join(' · '))
const { requireDetails } = useChartAccess(() => 'freight')
let requestId = 0
function reset() { requestId++; data.value = undefined; error.value = ''; busy.value = false }
async function load() {
  const id = ++requestId
  data.value = undefined; error.value = ''; busy.value = true
  try {
    await requireDetails()
    if (id !== requestId) return
    const role = route.params.role
    if (!isWorkbenchRole(role)) throw new Error('Invalid role')
    const query: FreightDetailsQuery = { grain: grain.value as FreightGrain, year: year.value, warehouse: warehouse.value as FreightDetailsQuery['warehouse'], workbenchRole: role, comparisonPeriod: textQuery('comparisonPeriod') as 'current' | 'previous' || 'current', page: page.value, pageSize: pageSize.value }
    if (textQuery('weekOf') && query.grain === 'week') query.weekOf = textQuery('weekOf')
    if (textQuery('carrierCode')) query.carrierCode = textQuery('carrierCode') as FreightCarrier
    if (textQuery('periodId')) query.periodId = textQuery('periodId')
    const result = await getFopFreightDetails(query)
    if (id === requestId) data.value = result
  } catch (cause) { if (id === requestId) error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) }
  finally { if (id === requestId) busy.value = false }
}
function filter(key: string, event: Event) {
  const value = (event.target as HTMLInputElement).value
  const query = { ...route.query, [key]: value || undefined, page: 1 }
  if (key === 'grain' || key === 'year' || key === 'weekOf') { query.periodId = undefined; query.comparisonPeriod = 'current' }
  if (key === 'year') query.weekOf = Number(value) === currentYear ? today : `${value}-12-31`
  if (key === 'grain' && value !== 'week') query.weekOf = undefined
  void router.push({ query })
}
function navigate(value: number) { void router.push({ query: { ...route.query, page: value } }) }
watch(() => route.fullPath, load, { immediate: true })
const off = onSessionReset(reset)
onBeforeUnmount(() => { off(); reset() })
</script>

<template>
  <section class="ov-panel freight-list">
    <header class="ov-header"><div class="ov-heading freight-detail-summary"><h2>{{ t('实际运费明细', 'Actual freight details') }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2><p>{{ summary }}</p><p>{{ t('UTC+8 · 已审核发运单已确认的实际运费 · 按确认时间归期，非银行付款日 · USD', 'UTC+8 · Confirmed actual freight on approved delivery bills · By confirmation time, not bank payment date · USD') }}</p></div><div class="ov-filters"><label>{{ t('年份', 'Year') }}<select :value="year" aria-label="运费明细年份" @change="filter('year', $event)"><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select></label><label>{{ t('时间轴', 'Timeline') }}<select :value="grain" aria-label="运费明细时间轴" @change="filter('grain', $event)"><option value="month">{{ t('按月', 'Monthly') }}</option><option value="week">{{ t('按周', 'Weekly') }}</option><option value="year">{{ t('按年', 'Yearly') }}</option></select></label><label v-if="grain === 'week'">{{ t('截至所在周', 'Week of') }}<input type="date" :value="textQuery('weekOf') || (year === currentYear ? today : `${year}-12-31`)" :min="`${year}-01-01`" :max="year === currentYear ? today : `${year}-12-31`" aria-label="运费明细周日期" @change="filter('weekOf', $event)"></label><label>{{ t('仓库', 'Warehouse') }}<select :value="warehouse" aria-label="运费明细仓库" @change="filter('warehouse', $event)"><option v-for="(name, code) in warehouseNames" :key="code" :value="code">{{ name }}</option></select></label><label>{{ t('物流服务商', 'Carrier') }}<select :value="textQuery('carrierCode') || ''" aria-label="运费明细服务商" @change="filter('carrierCode', $event)"><option value="">{{ t('全部服务商', 'All carriers') }}</option><option v-for="code in freightCarriers" :key="code" :value="code">{{ freightCarrierName(code, String(locale)) }}</option></select></label><button class="ov-secondary" @click="router.push('/dashboard')">{{ t('返回分析', 'Back to analysis') }}</button><button class="ov-secondary" :disabled="busy" @click="load">{{ t('刷新', 'Refresh') }}</button></div></header>
    <div class="ov-body"><p v-if="busy" class="ov-empty" role="status">{{ t('正在读取实际运费…', 'Loading actual freight…') }}</p><p v-else-if="error" class="ov-error" role="alert">{{ error }}</p><template v-else-if="data">
      <div class="ov-kpis"><div><span>{{ t('全筛选实际运费合计', 'Actual freight · All filtered bills') }}</span><strong>{{ money(data.totals.amount) }}</strong></div><div><span>{{ t('已确认发运单', 'Confirmed delivery bills') }}</span><b>{{ data.totals.billCount }}</b></div></div><div class="freight-original-totals"><span>{{ t('全筛选原币合计（分币种）', 'Original totals by currency · All filtered bills') }}</span><b v-for="total in data.totals.originalAmounts" :key="total.currency">{{ original(total.amount, total.currency) }}</b></div>
      <div class="ov-pagination"><span>{{ t('共', 'Total') }} {{ data.total }} {{ t('笔发运单', 'delivery bills') }}</span><label>{{ t('每页', 'Page size') }} <select :value="pageSize" aria-label="运费明细每页条数" @change="filter('pageSize', $event)"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option></select></label><button :disabled="page <= 1" @click="navigate(page - 1)">{{ t('上一页', 'Previous') }}</button><span>{{ page }} / {{ Math.max(1, Math.ceil(data.total / pageSize)) }}</span><button :disabled="page * pageSize >= data.total" @click="navigate(page + 1)">{{ t('下一页', 'Next') }}</button></div>
      <div class="ov-table-scroll"><table class="ov-table freight-detail-table"><colgroup><col style="width:210px"><col style="width:170px"><col style="width:165px"><col style="width:110px"><col style="width:140px"><col style="width:155px"><col style="width:240px"><col style="width:200px"><col style="width:190px"></colgroup><thead><tr><th>{{ t('发运单 / 订单 / 运单', 'Delivery / Order / Tracking') }}</th><th>{{ t('客户 / 编码', 'Customer / Code') }}</th><th>{{ t('服务商 / 渠道', 'Carrier / Channel') }}</th><th>{{ t('仓库', 'Warehouse') }}</th><th>{{ t('实际运费 · USD', 'Actual freight · USD') }}</th><th>{{ t('原币金额', 'Original amount') }}</th><th>{{ t('原币 → USD 汇率 / 日期 / 来源', 'Original → USD rate / Date / Source') }}</th><th>{{ t('实际运费确认时间 · UTC+8', 'Freight confirmed at · UTC+8') }}</th><th>{{ t('组织 / 部门 / 业务员', 'Organization / Department / Owner') }}</th></tr></thead><tbody><tr v-for="bill in data.items" :key="bill.id"><td><b>{{ bill.documentNumber }}</b><small>{{ bill.orderNumber }}</small><small>{{ bill.trackingNumber || '—' }}</small></td><td>{{ bill.customerName }}<small>{{ bill.customerCode }}</small></td><td>{{ bill.carrierName }}<small>{{ t('分类', 'Category') }} · {{ freightCarrierName(bill.carrierCode, String(locale)) }}</small><small>{{ bill.channelName }}</small></td><td>{{ bill.warehouse }}</td><td>{{ money(bill.amount) }}</td><td>{{ original(bill.originalAmount, bill.originalCurrency) }}</td><td>1 {{ bill.originalCurrency }} = {{ bill.fxRateToUsd }} USD<small>{{ bill.fxRateDate }}</small><small>{{ bill.fxRateSource }}</small></td><td>{{ date(bill.confirmedAt) }}</td><td>{{ bill.organization?.name || '—' }}<small>{{ bill.department?.name || '—' }}</small><small>{{ bill.owner?.name || '—' }}</small></td></tr><tr v-if="!data.items.length"><td colspan="9" class="ov-empty">{{ t('当前筛选范围暂无获授权的已确认实际运费。', 'No authorized confirmed actual freight matches these filters.') }}</td></tr></tbody><TableTotals><th colspan="4" scope="row">{{ t('全筛选结果合计', 'All filtered results') }} · {{ data.totals.billCount }} {{ t('笔', 'bills') }}</th><td>{{ money(data.totals.amount) }}</td><td><div v-for="total in data.totals.originalAmounts" :key="total.currency">{{ original(total.amount, total.currency) }}</div></td><td colspan="3"><small>{{ t('按币种分别合计；金额与统计图采用相同授权及确认时间口径。', 'Original amounts are grouped by currency; totals use the same access and confirmation-time rules as the charts.') }}</small></td></TableTotals></table></div>
      <p class="ov-scope freight-comparison-note">{{ t('每条为发运单当前已确认费用快照；后续调价、退款或重派应以 FOP 更新为准。', 'Each row is the current confirmed cost snapshot of a delivery bill. Later adjustments, refunds and re-dispatches depend on FOP updates.') }}</p>
    </template></div>
  </section>
</template>

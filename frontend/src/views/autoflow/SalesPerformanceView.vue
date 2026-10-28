<script setup lang="ts">
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChartNoAxesCombined } from 'lucide-vue-next'
import { getSalesPerformance, type PerformanceData, type PerformanceDetailsQuery, type PerformanceGrain, type PerformanceOwner, type PerformancePeriod, type PerformanceQuery } from '@/api/fop-sales-performance'
import { fopAccessError } from '@/api/fop-access'
import EChart from '@/components/charts/EChart.vue'
import TableTotals from '@/components/ui/TableTotals.vue'
import SalesPerformanceDetails from '@/components/sales-performance/SalesPerformanceDetails.vue'
import { formatChartCurrency } from '@/utils/currency'
import { onSessionReset } from '@/utils/session'
import { volumeColor } from '@/utils/order-volume'
import '@/components/order-volume/order-volume.css'

const { refresh: refreshChartAccess, applyResponse: applyChartResponse, clear: clearChartAccess, visible: chartVisible, canViewDetails } = useChartAccess(() => 'sales_performance')
const { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const from = ref(`${today.slice(0, 4)}-01-01`), to = ref(today), grain = ref<PerformanceGrain>('month')
const appliedRange = ref({ from: from.value, to: to.value }), ownerId = ref('')
const data = ref<PerformanceData>(), owners = ref<PerformanceOwner[]>([]), canSelectOwner = ref(false)
const busy = ref(false), error = ref(''), dateError = ref(''), tablePage = ref(1)
const selectedDetail = ref<{ query: PerformanceDetailsQuery; label: string; owner: string }>()
const query = computed<PerformanceQuery>(() => ({ ...appliedRange.value, grain: grain.value, ...(ownerId.value ? { ownerId: ownerId.value } : {}) }))
const orderedPeriods = computed(() => [...(data.value?.periods ?? [])].sort((a, b) => a.from.localeCompare(b.from)))
const tablePeriods = computed(() => [...orderedPeriods.value].reverse().slice((tablePage.value - 1) * 12, tablePage.value * 12))
const tablePages = computed(() => Math.max(1, Math.ceil(orderedPeriods.value.length / 12)))
const ownerLabel = computed(() => data.value?.selectedOwner ? `${data.value.selectedOwner.name} · ${data.value.selectedOwner.department.name}` : canSelectOwner.value ? t('请选择业务员', 'Select a salesperson') : t('暂无业务员数据', 'No salesperson data'))
const money = (value: number | null) => value === null ? '—' : formatChartCurrency(value, String(locale.value))
const date = (value: string) => new Date(value).toLocaleString(String(locale.value), { timeZone: 'Asia/Shanghai', hour12: false })
const status = (value: PerformancePeriod['profitStatus']) => ({ none: t('暂无毛利', 'No profit'), estimated: t('预估中', 'Estimated'), settled: t('已结算', 'Settled'), mixed: t('结算 / 预估', 'Settled / Estimated'), unallocated: t('待补充分期明细', 'Allocation pending') })[value]

function chartOption(profit: boolean) {
  const periods = orderedPeriods.value, window = grain.value === 'month' ? 6 : grain.value === 'week' ? 8 : 14
  const series = profit ? [
    { id: 'settled', name: t('结算毛利', 'Settled profit'), type: 'line', data: periods.map(p => p.settledGrossProfit), color: '#6f9c92' },
    { id: 'estimated', name: t('预估毛利', 'Estimated profit'), type: 'line', data: periods.map(p => p.estimatedGrossProfit), color: '#b4a0c7', lineStyle: { type: 'dashed', width: 2 } },
  ] : [
    { id: 'orders', name: t('订单收款', 'Order receipts'), type: 'bar', stack: 'collections', data: periods.map(p => p.orderAmount), color: '#93a6d4' },
    { id: 'stock', name: t('全款备货收款', 'Full-payment stocking'), type: 'bar', stack: 'collections', data: periods.map(p => p.stockAmount), color: '#9cc8c0' },
    { id: 'total', name: t('收款合计', 'Total receipts'), type: 'line', data: periods.map(p => p.collectionsAmount), color: volumeColor({ id: 'total', kind: 'total' }) },
  ]
  return {
    animationDuration: 250,
    aria: { enabled: true, label: { description: profit
      ? t('结算毛利与预估毛利按时间顺序分别展示。金额与待补充分期明细状态见下方分期统计表。', 'Settled and estimated net profit are shown separately in chronological order. Amounts and pending allocations are available in the period summary table below.')
      : t('订单收款与全款备货收款按时间顺序展示，折线为收款合计。金额见下方分期统计表。', 'Order and full-payment stocking receipts are shown chronologically, with a total receipts line. Amounts are available in the period summary table below.') } },
    textStyle: { fontFamily: 'inherit', color: '#8793a7' },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (value: unknown) => typeof value === 'number' ? money(value) : '—' },
    legend: { top: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 10, color: '#8793a7' } },
    grid: { left: 12, right: 18, top: 44, bottom: 65, containLabel: true },
    xAxis: { type: 'category', data: periods.map(p => p.label), axisLine: { lineStyle: { color: '#e5e9f0' } }, axisTick: { show: false }, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, formatter: (v: number) => `$${new Intl.NumberFormat(String(locale.value), { notation: 'compact' }).format(v)}` }, splitLine: { lineStyle: { color: '#8793a714' } } },
    dataZoom: [{ type: 'slider', startValue: Math.max(0, periods.length - window), endValue: Math.max(0, periods.length - 1), height: 17, bottom: 6, borderColor: '#e4e9f2', fillerColor: '#93a6d422', handleStyle: { color: '#aab9d7' }, showDetail: false, brushSelect: false, zoomLock: true }],
    series: series.map(s => ({ ...s, barMaxWidth: 26, symbolSize: 5, connectNulls: false, emphasis: { focus: 'series' } })),
  }
}
const receiptChart = computed(() => chartOption(false)), profitChart = computed(() => chartOption(true))
let requestId = 0, sessionReset = false
function closeDetails() { selectedDetail.value = undefined }
function clear() {
  clearChartAccess(); requestId++; data.value = undefined; owners.value = []; canSelectOwner.value = false; error.value = ''; busy.value = false; closeDetails()
}
async function load() {
  const id = ++requestId
  data.value = undefined; owners.value = []; canSelectOwner.value = false; error.value = ''; busy.value = true; tablePage.value = 1; closeDetails()
  try {
    const capability = await refreshChartAccess()
    if (id !== requestId || !capability?.visible) return
    const submitted = { ...query.value }
    if (capability.dataScope === 'self') delete submitted.ownerId
    const result = await getSalesPerformance(submitted)
    if (id !== requestId) return
    if (!applyChartResponse(result)) return
    data.value = result; owners.value = result.owners; canSelectOwner.value = result.canSelectOwner
  } catch (cause) {
    if (id !== requestId) return
    clearChartAccess(); owners.value = []; canSelectOwner.value = false; error.value = fopAccessError(cause, String(locale.value).startsWith('zh'))
  } finally { if (id === requestId) busy.value = false }
}
function applyFilters() {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  if (!validDate(from.value) || !validDate(to.value) || from.value < '2020-01-01' || from.value > to.value || to.value > today) {
    dateError.value = t('请选择有效日期，结束日期不能早于开始日期或晚于今天。', 'Choose valid dates, in order and no later than today.'); return
  }
  if ((Date.parse(to.value) - Date.parse(from.value)) / 86400_000 >= 366) {
    dateError.value = t('每次最多查询 366 天，请缩短日期范围。', 'Choose a range of no more than 366 days.'); return
  }
  sessionReset = false
  dateError.value = ''
  if (from.value !== appliedRange.value.from || to.value !== appliedRange.value.to) appliedRange.value = { from: from.value, to: to.value }
  else void load()
}
function openDetails(kind: 'receipts' | 'profit', period?: PerformancePeriod) {
  if (!data.value?.selectedOwner || !canViewDetails.value) return
  selectedDetail.value = { query: { ...query.value, ownerId: data.value.selectedOwner.id, kind, ...(period ? { periodId: period.id } : {}), page: 1, pageSize: 10 }, label: period ? `${period.from} — ${period.to}` : `${appliedRange.value.from} — ${appliedRange.value.to}`, owner: ownerLabel.value }
}
function detailFailed() {
  requestId++; data.value = undefined; owners.value = []; canSelectOwner.value = false; busy.value = false
  if (selectedDetail.value) selectedDetail.value.owner = ''
}
watch(query, () => { if (!sessionReset) void load() }, { immediate: true })
const off = onSessionReset(() => { sessionReset = true; clear(); ownerId.value = ''; dateError.value = '' })
onBeforeUnmount(() => { off(); clear() })
</script>

<template>
  <section v-if="chartVisible" class="ov-panel performance-panel">
    <header class="ov-header">
      <div class="ov-heading"><h2><ChartNoAxesCombined :size="19" />{{ t('个人收款与毛利', 'Personal receipts and profit') }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2></div>
      <form class="ov-filters" @submit.prevent="applyFilters">
        <label>{{ t('开始日期', 'Start date') }}<input v-model="from" type="date" min="2020-01-01" :max="to || today" aria-label="开始日期" required></label>
        <label>{{ t('结束日期', 'End date') }}<input v-model="to" type="date" :min="from || '2020-01-01'" :max="today" aria-label="结束日期" required></label>
        <label v-if="canSelectOwner">{{ t('业务员', 'Salesperson') }}<select :value="ownerId || data?.selectedOwner?.id || ''" aria-label="业务员" @change="ownerId = ($event.target as HTMLSelectElement).value"><option v-if="!data?.selectedOwner" value="">{{ t('请选择业务员', 'Select a salesperson') }}</option><option v-for="owner in owners" :key="owner.id" :value="owner.id">{{ owner.name }} · {{ owner.department.name }}</option></select></label>
        <label>{{ t('时间轴', 'Timeline') }}<select v-model="grain" aria-label="统计粒度"><option value="month">{{ t('按月', 'Monthly') }}</option><option value="week">{{ t('按周', 'Weekly') }}</option><option value="day">{{ t('按天', 'Daily') }}</option></select></label>
        <button class="ov-primary" type="submit" :disabled="busy">{{ t('查询', 'Apply') }}</button>
      </form>
    </header>
    <div class="ov-body">
      <p v-if="dateError" class="ov-error" role="alert">{{ dateError }}</p>
      <p v-if="busy" class="ov-empty" role="status">{{ t('正在统计收款与毛利…', 'Loading receipts and profit…') }}</p>
      <p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></p>
      <template v-else-if="data">
        <div class="performance-scope"><strong>{{ ownerLabel }}</strong><span>{{ appliedRange.from }} — {{ appliedRange.to }} · UTC+8 · USD ($)</span><small>{{ t('截至', 'As of') }} {{ date(data.asOf) }}</small></div>
        <div class="performance-kpis" data-testid="performance-kpis">
          <div><span>{{ t('订单收款', 'Order receipts') }}</span><strong>{{ money(data.totals.orderAmount) }}</strong></div>
          <div><span>{{ t('全款备货收款', 'Full-payment stocking') }}</span><strong>{{ money(data.totals.stockAmount) }}</strong></div>
          <div class="collection-total"><span>{{ t('收款合计', 'Total receipts') }}</span><strong>{{ money(data.totals.collectionsAmount) }}</strong></div>
          <div class="settled-kpi"><span>{{ t('结算毛利', 'Settled profit') }}</span><strong data-testid="settled-total">{{ money(data.totals.settledGrossProfit) }}</strong><small v-if="data.totals.settledGrossProfit === null">{{ t('待补充分期明细', 'Allocation pending') }}</small></div>
          <div class="estimated-kpi"><span>{{ t('预估毛利', 'Estimated profit') }}</span><strong>{{ money(data.totals.estimatedGrossProfit) }}</strong></div>
        </div>

        <div v-if="data.unallocatedSettlements.length" class="performance-unallocated" data-testid="unallocated"><strong>{{ t('待补充分期明细 · 整月参考', 'Allocation pending · Full-month reference') }}</strong><p>{{ t('以下月结尚无可靠的日归属，未分摊至周或天，也未计入当前分期合计。', 'These monthly settlements have no reliable daily allocation and are excluded from the period totals.') }}</p><span v-for="item in data.unallocatedSettlements" :key="item.month">{{ item.month }} · {{ money(item.amount) }} · {{ item.count }} {{ t('笔', 'entries') }}</span></div>
        <div v-if="data.selectedOwner" class="performance-charts">
          <section><h3>{{ t('收款趋势', 'Receipts trend') }}<small>USD ($)</small></h3><EChart :option="receiptChart" :label="t('个人收款趋势', 'Personal receipts trend')" /></section>
          <section><h3>{{ t('毛利趋势', 'Profit trend') }}<small>{{ t('净毛利 · USD ($)', 'Net profit · USD ($)') }}</small></h3><EChart :option="profitChart" :label="t('个人毛利趋势', 'Personal profit trend')" /></section>
        </div>
        <div class="performance-table-heading"><h3>{{ t('分期统计', 'Period summary') }}</h3><span>{{ t('最近期间在前', 'Latest periods first') }}</span></div>
        <div class="ov-table-scroll"><table class="ov-table performance-table"><colgroup><col style="width: 150px"><col v-for="i in 5" :key="i" style="width: 145px"><col style="width: 150px"><col style="width: 180px"></colgroup><thead><tr><th>{{ t('期间', 'Period') }}</th><th>{{ t('订单收款', 'Order receipts') }}</th><th>{{ t('全款备货收款', 'Stocking receipts') }}</th><th>{{ t('收款合计', 'Total receipts') }}</th><th>{{ t('结算毛利', 'Settled profit') }}</th><th>{{ t('预估毛利', 'Estimated profit') }}</th><th>{{ t('毛利状态', 'Profit status') }}</th><th>{{ t('查看明细', 'Details') }}</th></tr></thead>
          <tbody><tr v-for="period in tablePeriods" :key="period.id"><td><strong>{{ period.label }}</strong><small class="performance-range">{{ period.from }} — {{ period.to }}</small></td><td>{{ money(period.orderAmount) }}</td><td>{{ money(period.stockAmount) }}</td><td class="performance-amount">{{ money(period.collectionsAmount) }}</td><td>{{ money(period.settledGrossProfit) }}</td><td>{{ money(period.estimatedGrossProfit) }}</td><td><span class="performance-status" :class="period.profitStatus">{{ status(period.profitStatus) }}</span></td><td><button v-if="canViewDetails" class="ov-link" @click="openDetails('receipts', period)">{{ t('收款明细', 'Receipts') }}</button><button v-if="canViewDetails" class="ov-link" @click="openDetails('profit', period)">{{ t('毛利明细', 'Profit') }}</button></td></tr><tr v-if="!tablePeriods.length"><td colspan="8" class="ov-empty">{{ t('当前范围暂无可查看数据。', 'No data is available in this scope.') }}</td></tr></tbody>
          <TableTotals><th scope="row">{{ t('筛选合计', 'Filtered total') }}</th><td>{{ money(data.totals.orderAmount) }}</td><td>{{ money(data.totals.stockAmount) }}</td><td>{{ money(data.totals.collectionsAmount) }}</td><td>{{ money(data.totals.settledGrossProfit) }}</td><td>{{ money(data.totals.estimatedGrossProfit) }}</td><td>{{ data.totals.settledGrossProfit === null ? t('待补充分期明细', 'Allocation pending') : '—' }}</td><td><template v-if="data.selectedOwner"><button v-if="canViewDetails" class="ov-link" @click="openDetails('receipts')">{{ t('全部收款', 'All receipts') }}</button><button v-if="canViewDetails" class="ov-link" @click="openDetails('profit')">{{ t('全部毛利', 'All profit') }}</button></template></td></TableTotals>
        </table></div>
        <div v-if="tablePages > 1" class="ov-pagination"><span>{{ orderedPeriods.length }} {{ t('期', 'periods') }}</span><button :disabled="tablePage <= 1" @click="tablePage--">{{ t('上一页', 'Previous') }}</button><span>{{ tablePage }} / {{ tablePages }}</span><button :disabled="tablePage >= tablePages" @click="tablePage++">{{ t('下一页', 'Next') }}</button></div>
      </template>
    </div>
    <SalesPerformanceDetails v-if="selectedDetail && canViewDetails" :query="selectedDetail.query" :scope="selectedDetail.label" :owner="selectedDetail.owner" @close="closeDetails" @failure="detailFailed" />
  </section>
  <p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></p>
</template>

<style scoped>
.performance-panel{margin-top:0}.performance-scope{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--color-chart-muted)}.performance-scope strong{font-size:14px;font-weight:600;color:var(--color-text)}.performance-scope small{margin-left:auto;font-size:10px}.performance-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;padding:22px 0 16px}.performance-kpis>div{border:1px solid #98a8c51c;background:#98a8c506;border-radius:8px;padding:17px 16px;display:flex;flex-direction:column;gap:11px;min-width:0}.performance-kpis span{font-size:11px;color:var(--color-chart-muted)}.performance-kpis strong{font-size:clamp(17px,1.8vw,25px);font-weight:650;letter-spacing:-.025em;font-variant-numeric:tabular-nums}.performance-kpis small{font-size:10px;color:#a18b63}.performance-kpis .collection-total{background:#93a6d410;color:var(--color-chart-link)}.performance-kpis .settled-kpi{background:#9cc8c00e;color:#618d82}.performance-kpis .estimated-kpi{background:#b4a0c70c;color:#9683aa}.performance-note{margin:0 0 16px}.performance-unallocated{padding:13px 16px;border:1px solid #cfb58245;background:#cfb5820c;border-radius:7px;font-size:11px;color:#9a835d;margin:12px 0 20px;line-height:1.8}.performance-unallocated strong{font-weight:600}.performance-unallocated p{font-size:10px}.performance-unallocated span{display:inline-block;margin:7px 18px 0 0}.performance-charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px;margin:22px 0 26px}.performance-charts section{min-width:0;height:310px;display:flex;flex-direction:column}.performance-charts :deep([role=img]){min-height:0;flex:1}.performance-charts h3,.performance-table-heading h3{font-size:12px;font-weight:600;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between}.performance-charts h3 small{font-size:10px;color:var(--color-chart-muted);font-weight:400}.performance-table-heading{display:flex;justify-content:space-between;align-items:center;margin:10px 0 12px}.performance-table-heading h3{margin:0}.performance-table-heading span{font-size:10px;color:var(--color-chart-muted)}.performance-table{table-layout:fixed;min-width:1205px}.performance-table :is(th,td){padding:14px 12px;white-space:normal;font-variant-numeric:tabular-nums}.performance-table td:first-child strong{font-weight:500}.performance-range{display:block;font-size:9px!important;color:var(--color-chart-muted);margin:5px 0 0!important;white-space:normal}.performance-table :is(th,td):nth-last-child(-n+2){text-align:center}.performance-amount{color:var(--color-chart-link);font-weight:600}.performance-status{font-size:10px;display:inline-block;padding:4px 7px;border-radius:4px;background:#8793a710;color:var(--color-chart-muted)}.performance-status.settled{background:#9cc8c018;color:#618d82}.performance-status.estimated{background:#b4a0c718;color:#9683aa}.performance-status.mixed{background:#93a6d418;color:#788bb7}.performance-status.unallocated{background:#cfb58218;color:#a18b63}.performance-table .ov-link{padding:4px 2px;font-size:10px}.performance-table .ov-link+.ov-link{margin-left:10px}
@media(max-width:1250px){.performance-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:850px){.performance-charts{grid-template-columns:1fr}.performance-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.performance-scope small{margin-left:0}.performance-kpis strong{font-size:23px}}@media(max-width:480px){.performance-kpis{gap:8px}.performance-kpis>div{padding:13px 10px}.performance-kpis strong{font-size:19px}}
</style>

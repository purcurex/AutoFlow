<script setup lang="ts">
import { useChartCapabilities } from '@/composables/useChartAccess'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EChart, { type ChartClick, type ChartZoom } from '@/components/charts/EChart.vue'
import TableTotals from '@/components/ui/TableTotals.vue'
import type { OrderVolumeData, VolumeSeries, VolumeWarehouse } from '@/api/fop-order-volume'
import { useTheme } from '@/composables/useTheme'
import { latestVolumeWindow, volumeColor } from '@/utils/order-volume'
import { formatChartCurrency } from '@/utils/currency'
import { sumMoney } from '@/utils/tableTotals'

const props = withDefaults(defineProps<{ data: OrderVolumeData; split?: boolean; rankingOnly?: boolean; detailsAllowed?: boolean }>(), { split: false, rankingOnly: false, detailsAllowed: true })
const emit = defineEmits<{ drill: [seriesId: string, periodId?: string, warehouse?: VolumeWarehouse]; receipt: [seriesId: string, periodId?: string, warehouse?: VolumeWarehouse]; customer: [id: string, name: string, code: string] }>()
const { canViewDetails: inheritedDetails } = useChartCapabilities()
const canViewDetails = computed(() => inheritedDetails.value && props.detailsAllowed !== false && props.data.query.view !== 'summary')
const { locale } = useI18n(), { isDark } = useTheme()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const metrics = ['orders', 'amount'] as const
type Metric = typeof metrics[number]
const metricLabel = (metric: Metric) => metric === 'orders' ? t('履约订单量', 'Fulfillment orders') : t('回款业绩金额', 'Collections performance')
const format = (value: number | null | undefined, metric: Metric) => value == null ? '—' : metric === 'amount' ? formatChartCurrency(value, String(locale.value)) : value.toLocaleString()
const total = computed(() => props.data.series.find(s => s.kind === 'total'))
const chartMetrics = computed(() => total.value?.amounts ? metrics : ['orders'] as const)
const hasResults = computed(() => props.data.total > 0 || (total.value?.amounts?.total ?? 0) > 0)
const ranking = computed(() => props.data.series.filter(s => s.kind !== 'total'))
const tableRows = computed(() => props.rankingOnly ? ranking.value : total.value ? [total.value] : [])
const warehouseName = (code: VolumeWarehouse) => code === 'HZ' ? t('杭州仓', 'Hangzhou') : code === 'SZ' ? t('深圳仓', 'Shenzhen') : t('未分配仓库', 'Unassigned')
const warehouseColor = { HZ: '#79B7D2', SZ: '#A996D1', UNASSIGNED: '#B5BFCE' }
const warehouses = computed<VolumeWarehouse[]>(() => ['HZ', 'SZ', ...(total.value?.warehouses.UNASSIGNED.some(value => (value ?? 0) > 0) ? ['UNASSIGNED'] : [])] as VolumeWarehouse[])
const axis = computed(() => isDark.value ? '#99A8BE' : '#8693A8')
const grid = computed(() => isDark.value ? '#293241' : '#EDF0F7')
const charts = ref<InstanceType<typeof EChart>[]>([])
const datedRows = computed(() => props.data.periods.map((period, index) => ({ ...period, index })).reverse())

function metricValues(row: VolumeSeries | undefined, metric: Metric, warehouse?: VolumeWarehouse): (number | null)[] {
  const source = metric === 'orders' ? row : row?.amounts
  return (warehouse ? source?.warehouses[warehouse] : source?.values) ?? props.data.periods.map(() => null)
}
function value(row: VolumeSeries | undefined, metric: Metric, warehouse?: VolumeWarehouse): number | null {
  const source = metric === 'orders' ? row : row?.amounts
  if (!source) return null
  return warehouse ? (metric === 'amount' ? sumMoney(source.warehouses[warehouse].filter((n): n is number => n !== null)) : source.warehouses[warehouse].reduce<number>((sum, n) => sum + (n ?? 0), 0)) : source.total
}
function share(row: VolumeSeries, metric: Metric) {
  const amount = value(row, metric), overall = value(total.value, metric)
  return amount === null || overall === null ? '—' : `${(overall ? amount / overall * 100 : 0).toFixed(1)}%`
}
const chartGroups = computed(() => props.split
  ? warehouses.value.map(code => ({ id: code, label: warehouseName(code), warehouse: code, color: warehouseColor[code] }))
  : [{ id: 'total', label: props.data.query.warehouse === 'ALL' ? t('全部仓库', 'All warehouses') : warehouseName(props.data.query.warehouse), warehouse: undefined, color: '#94A5DD' }])

function breakdown(row?: VolumeSeries) {
  const sources = row?.amounts?.breakdown
  return sources ? `${t('履约订单', 'Fulfillment')} ${format(sources.fulfillment, 'amount')} · ${t('全款备货', 'Full-payment stocking')} ${format(sources.fullPaymentStock, 'amount')}` : ''
}
function drill(metric: Metric, seriesId: string, periodId?: string, warehouse?: VolumeWarehouse) {
  if (!canViewDetails.value) return
  if (metric === 'amount') { if (total.value?.amounts) emit('receipt', seriesId, periodId, warehouse) }
  else emit('drill', seriesId, periodId, warehouse)
}
function rankingOption(metric: Metric) {
  return {
    animationDuration: 250, aria: { enabled: true }, textStyle: { color: axis.value, fontFamily: 'inherit' },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, axisPointer: { type: 'shadow' }, ...(metric === 'amount' ? { formatter: (raw: unknown) => { const points = (Array.isArray(raw) ? raw : [raw]) as { dataIndex: number; seriesName: string; value: number }[]; const row = ranking.value[points[0]?.dataIndex ?? 0]; return [row?.label ?? '', ...points.map(point => `${point.seriesName}: ${format(point.value, metric)}`), breakdown(row)].filter(Boolean).join('\n') } } : {}), valueFormatter: (v: unknown) => format(typeof v === 'number' ? v : null, metric) },
    legend: { show: props.split, top: 0, left: 0, icon: 'roundRect', itemWidth: 13, itemHeight: 6, textStyle: { fontSize: 10, color: axis.value } },
    grid: { left: 4, right: metric === 'amount' ? 85 : 40, top: props.split ? 34 : 12, bottom: 20, containLabel: true },
    xAxis: { type: 'value', ...(metric === 'orders' ? { minInterval: 1 } : {}), axisLabel: { color: axis.value }, splitLine: { lineStyle: { color: grid.value, type: 'dashed' } } },
    yAxis: { type: 'category', inverse: true, data: ranking.value.map(s => s.code ? `${s.label} · ${s.code}` : s.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: axis.value, width: 170, overflow: 'truncate', fontSize: 10 } },
    series: chartGroups.value.map(group => ({ id: group.id, name: group.label, type: 'bar', barMaxWidth: props.split ? 10 : 15, barGap: '35%',
      label: { show: true, position: 'right', color: axis.value, fontSize: 10, formatter: ({ value: amount }: { value: number | null }) => format(amount, metric) },
      ...(props.split ? { itemStyle: { color: group.color, borderRadius: [0, 3, 3, 0] }, data: ranking.value.map(row => value(row, metric, group.warehouse)) }
        : { data: ranking.value.map(row => ({ value: value(row, metric), itemStyle: { color: volumeColor(row), borderRadius: [0, 4, 4, 0] } })) }),
    })),
  }
}
function trendOption(metric: Metric) {
  return {
    animationDuration: 250, aria: { enabled: true }, textStyle: { color: axis.value, fontFamily: 'inherit' },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (v: unknown) => format(typeof v === 'number' ? v : null, metric) },
    legend: { top: 0, left: 4, icon: 'roundRect', itemWidth: 13, itemHeight: 6, textStyle: { color: axis.value, fontSize: 10 } },
    grid: { left: 10, right: 18, top: 42, bottom: 55, containLabel: true },
    xAxis: { type: 'category', data: props.data.periods.map(p => p.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: axis.value, fontSize: 10, hideOverlap: true } },
    yAxis: { type: 'value', name: metric === 'amount' ? '$' : t('单', 'Orders'), ...(metric === 'orders' ? { minInterval: 1 } : {}), splitLine: { lineStyle: { color: grid.value, type: 'dashed' } } },
    dataZoom: [{ type: 'slider', ...latestVolumeWindow('day', props.data.periods), filterMode: 'none', height: 16, bottom: 8, borderColor: 'transparent', backgroundColor: grid.value, fillerColor: '#94A5DD25', handleStyle: { color: '#A8B6DE' }, showDetail: false, brushSelect: false }],
    series: chartGroups.value.map(group => ({ id: group.id, name: group.label, type: 'line', smooth: .2, symbol: 'circle', symbolSize: 4, itemStyle: { color: group.color }, lineStyle: { width: 2 }, data: metricValues(total.value, metric, group.warehouse) })),
  }
}
function selectChart(event: ChartClick, metric: Metric) {
  if (event.dataIndex === undefined) return
  if (props.rankingOnly) {
    const row = ranking.value[event.dataIndex]
    if (metric === 'orders' && row?.entityId && row.kind === 'detail') emit('customer', row.entityId, row.label, row.code ?? '')
    else if (row) drill(metric, row.id, undefined, props.split && warehouses.value.includes(event.seriesId as VolumeWarehouse) ? event.seriesId as VolumeWarehouse : undefined)
  } else {
    const period = props.data.periods[event.dataIndex]
    if (period && !period.future) drill(metric, 'total', period.id, props.split && warehouses.value.includes(event.seriesId as VolumeWarehouse) ? event.seriesId as VolumeWarehouse : undefined)
  }
}
function syncZoom(event: ChartZoom) { for (const chart of charts.value) chart.zoom(event) }
</script>

<template>
  <div class="ov-results customer-order-results">
    <div class="ov-kpis">
      <div><span>{{ t('履约订单量合计', 'Total fulfillment orders') }}</span><strong>{{ format(data.total, 'orders') }}<small>{{ t('单', 'orders') }}</small></strong></div>
      <div><span>{{ t('回款业绩金额合计', 'Total collections performance') }}</span><button class="customer-amount-kpi customer-cell-link" :disabled="!canViewDetails || (!total?.amounts)" :title="breakdown(total)" @click="drill('amount', 'total')">{{ format(value(total, 'amount'), 'amount') }}</button></div>
      <div v-if="rankingOnly"><span>{{ t('涉及客户', 'Customers') }}</span><b>{{ data.customerCount }}</b></div>
      <div class="ov-period"><span>{{ data.periods[0]?.from }} — {{ data.periods.at(-1)?.to }}</span><small>{{ t('按订单支付日期统计 · UTC+8', 'By order payment date · UTC+8') }} · {{ t('更新于', 'Updated') }} {{ new Date(data.asOf).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) }}</small></div>
      <button :disabled="!canViewDetails" class="ov-link" @click="emit('drill', 'total')">{{ t('查看订单明细 ↗', 'View orders ↗') }}</button>
    </div>
    <p v-if="total?.amounts?.breakdown" class="ov-scope customer-amount-note">{{ breakdown(total) }} · {{ t('按支付当月计入，押金备货不计入；使用备货库存时不重复计款。', 'Counted in the payment month; deposits excluded and stocked inventory is not counted again.') }}</p>
    <p v-if="!total?.amounts" class="ov-scope customer-amount-note">{{ t('当前无可查看的回款金额权限，履约订单量仍可查看。', 'Receipt amounts are unavailable with the current permissions; fulfillment counts remain available.') }}</p>
    <p v-if="total?.amounts?.excludedOrderCount" class="ov-scope customer-amount-note">{{ t(`回款仅汇总美元收款；${total.amounts.excludedOrderCount} 笔非美元收款未计入回款合计。`, `Amounts include USD receipts only; ${total.amounts.excludedOrderCount} non-USD receipts are excluded.`) }}</p>
    <p v-if="!hasResults" class="ov-empty">{{ t('当前条件下暂无履约订单或回款。', 'No fulfillment orders or receipts match these filters.') }}</p>
    <div v-else class="customer-metric-charts" :class="{ 'customer-ranking-charts': rankingOnly }">
      <section v-for="metric in chartMetrics" :key="metric" class="customer-metric-chart" :data-chart-metric="metric">
        <h3>{{ metric === 'orders' ? (rankingOnly ? t('履约订单量排名 · 前十＋其他', 'Fulfillment ranking · Top 10 + Other') : t('履约订单量趋势', 'Fulfillment order trend')) : (rankingOnly ? t('回款业绩金额对比 · $', 'Collections comparison · $') : t('回款业绩金额趋势 · $', 'Collections trend · $')) }}<small>{{ split ? t('杭州仓 / 深圳仓', 'Hangzhou / Shenzhen') : rankingOnly ? t('同一客户顺序', 'Same customer order') : t('所选时间范围', 'Selected dates') }}</small></h3>
        <div :style="{ height: rankingOnly ? `${Math.max(300, ranking.length * (split ? 54 : 35) + 60)}px` : '300px' }"><EChart ref="charts" :option="rankingOnly ? rankingOption(metric) : trendOption(metric)" :label="metricLabel(metric)" @select="event => selectChart(event, metric)" @zoom="syncZoom" /></div>
      </section>
    </div>
    <p v-if="rankingOnly" class="customer-table-caption">{{ t('按订单量取前十客户；金额使用相同客户集合，其余客户（含仅有备货回款的客户）归入“其他客户”。', 'Top 10 by order count; amounts use the same customers. Remaining customers, including stock-only customers, are grouped as Other.') }}</p>
    <div class="ov-table-scroll"><table class="ov-table customer-metrics-table">
      <thead><tr><th>{{ t('客户 / 编码', 'Customer / Code') }}</th><th>{{ t('指标', 'Metric') }}</th><th>{{ t('合计', 'Total') }}</th><th>{{ t('占比', 'Share') }}</th><th v-for="code in warehouses" :key="code"><span class="ov-dot" :style="{ background: warehouseColor[code] }" />{{ warehouseName(code) }}</th><th>{{ t('查看', 'View') }}</th></tr></thead>
      <tbody><template v-for="row in tableRows" :key="row.id"><tr v-for="(metric, index) in metrics" :key="metric" :data-row-id="row.id" :data-metric="metric" :class="{ 'customer-pair-first': index === 0, 'customer-money-row': index === 1, 'ov-total': row.kind === 'total' }">
        <td v-if="index === 0" rowspan="2" class="customer-identity"><span class="ov-dot" :style="{ background: volumeColor(row) }" /><strong>{{ row.label }}</strong><small v-if="row.code">{{ row.code }}</small></td>
        <th scope="row" class="customer-metric-name">{{ metricLabel(metric) }}</th><td><button v-if="metric === 'amount'" class="customer-cell-link" :disabled="!canViewDetails || (!row.amounts)" :title="breakdown(row)" @click="drill(metric, row.id)">{{ format(value(row, metric), metric) }}</button><template v-else>{{ format(value(row, metric), metric) }}</template></td><td>{{ share(row, metric) }}</td>
        <td v-for="code in warehouses" :key="code"><button class="customer-cell-link" :data-warehouse="code" :disabled="!canViewDetails || (metric === 'amount' && !row.amounts)" :title="metric === 'amount' ? `${warehouseName(code)} · ${t('查看回款明细', 'View receipt details')}` : undefined" :aria-label="`${row.label} · ${warehouseName(code)} · ${metricLabel(metric)} · ${metric === 'amount' ? t('查看回款', 'View receipts') : t('查看订单', 'View orders')}`" @click="drill(metric, row.id, undefined, code)">{{ format(value(row, metric, code), metric) }}</button></td>
        <td v-if="index === 0" rowspan="2" class="customer-actions"><button v-if="rankingOnly && row.entityId && row.kind === 'detail'" class="ov-link" @click="emit('customer', row.entityId, row.label, row.code ?? '')">{{ t('趋势', 'Trend') }}</button><button :disabled="!canViewDetails" class="ov-link" @click="emit('drill', row.id)">{{ t('订单 ↗', 'Orders ↗') }}</button></td>
      </tr></template></tbody>
      <tfoot class="customer-totals"><tr v-for="(metric, index) in metrics" :key="metric"><th v-if="index === 0" rowspan="2" scope="rowgroup">{{ t('合计', 'Total') }}</th><th scope="row" class="customer-metric-name">{{ metricLabel(metric) }}</th><td>{{ format(value(total, metric), metric) }}</td><td>{{ total ? share(total, metric) : '—' }}</td><td v-for="code in warehouses" :key="code"><button class="customer-cell-link" :disabled="!canViewDetails || (metric === 'amount' && !total?.amounts)" @click="drill(metric, 'total', undefined, code)">{{ format(value(total, metric, code), metric) }}</button></td><td v-if="index === 0" rowspan="2"><button :disabled="!canViewDetails" class="ov-link" @click="emit('drill', 'total')">{{ t('订单 ↗', 'Orders ↗') }}</button></td></tr></tfoot>
    </table></div>
    <details v-if="!rankingOnly" class="ov-time-detail"><summary>{{ t('每日订单与回款明细', 'Daily order and receipt breakdown') }}<span>{{ t('日期倒序 · 点击数值查看相应明细', 'Latest dates first · Select a value to view details') }}</span></summary>
      <div class="ov-table-scroll customer-daily-table"><table class="ov-table"><thead><tr><th>{{ t('支付日期', 'Payment date') }}</th><th v-for="metric in metrics" :key="metric">{{ metricLabel(metric) }}</th><template v-if="split"><template v-for="code in warehouses" :key="code"><th v-for="metric in metrics" :key="metric">{{ warehouseName(code) }} · {{ metricLabel(metric) }}</th></template></template></tr></thead>
        <tbody><tr v-for="period in datedRows" :key="period.id"><td>{{ period.label }}</td><td v-for="metric in metrics" :key="metric"><button class="customer-cell-link" :disabled="!canViewDetails || (period.future || (metric === 'amount' && !total?.amounts))" @click="drill(metric, 'total', period.id)">{{ format(metricValues(total, metric)[period.index], metric) }}</button></td><template v-if="split"><template v-for="code in warehouses" :key="code"><td v-for="metric in metrics" :key="metric"><button class="customer-cell-link" :disabled="!canViewDetails || (period.future || (metric === 'amount' && !total?.amounts))" @click="drill(metric, 'total', period.id, code)">{{ format(metricValues(total, metric, code)[period.index], metric) }}</button></td></template></template></tr></tbody>
        <TableTotals><th scope="row">{{ t('合计', 'Total') }}</th><td v-for="metric in metrics" :key="metric">{{ format(value(total, metric), metric) }}</td><template v-if="split"><template v-for="code in warehouses" :key="code"><td v-for="metric in metrics" :key="metric">{{ format(value(total, metric, code), metric) }}</td></template></template></TableTotals>
      </table></div>
    </details>
  </div>
</template>

<style scoped>
.customer-metric-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin: 8px 0 22px; }
.customer-metric-chart { min-width: 0; border: 1px solid var(--color-border); border-radius: 8px; padding: 16px 12px 4px; }
.customer-metric-chart h3 { padding: 0 4px; }.customer-metric-charts h3 small { white-space: nowrap; }
.customer-order-results .ov-kpis .customer-amount-kpi { font-size: 27px; font-weight: 700; letter-spacing: -.02em; color: #6478b3; line-height: 1; text-align: left; }
.customer-table-caption, .customer-amount-note { font-size: 10px; color: #8793a7; line-height: 1.7; margin-bottom: 12px; }
.customer-metrics-table { min-width: 760px; font-variant-numeric: tabular-nums; }.customer-metrics-table :is(th, td) { height: 38px; padding: 9px 14px; }
.customer-metrics-table .customer-metric-name { background: transparent; text-align: left; width: 110px; font-size: 10px; }
.customer-metrics-table .customer-identity { vertical-align: middle; min-width: 205px; }.customer-identity strong { font-weight: 500; }.customer-identity small { display: block; padding-left: 16px; margin-top: 6px; }
.customer-pair-first > :not([rowspan]) { border-bottom: 1px dashed var(--color-border); }
.customer-money-row { background: #8793a704; }.customer-money-row td { color: #6687a3; }
.customer-metrics-table .customer-actions { vertical-align: middle; }.customer-cell-link { color: inherit; font-variant-numeric: tabular-nums; }.customer-cell-link:hover { color: #6478b3; text-decoration: underline; }
.customer-totals > tr > :is(th, td) { background: #edf1fb; color: #6478b3; font-weight: 650; border-top: 1px solid #d7dff2; }
.customer-metrics-table .customer-totals .customer-metric-name { background: #edf1fb; }
.customer-daily-table { max-height: 280px; }.customer-daily-table th { white-space: nowrap; }
:global(.dark) .customer-totals > tr > :is(th, td), :global(.dark) .customer-metrics-table .customer-totals .customer-metric-name { background: #252f46; color: #b4c2ef; border-color: #3b4969; }
:global(.dark) .customer-money-row td { color: #a6c2d9; }
@media (max-width: 1100px) { .customer-metric-charts { grid-template-columns: 1fr; } }
</style>

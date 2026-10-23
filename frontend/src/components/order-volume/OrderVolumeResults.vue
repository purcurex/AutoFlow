<script setup lang="ts">
import TableTotals from '@/components/ui/TableTotals.vue'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import EChart, { type ChartClick, type ChartZoom } from '@/components/charts/EChart.vue'
import { useTheme } from '@/composables/useTheme'
import type { OrderVolumeData, VolumeWarehouse } from '@/api/fop-order-volume'
import { latestVolumeWindow, volumeColor } from '@/utils/order-volume'
const props = withDefaults(defineProps<{ data: OrderVolumeData; split?: boolean; rankingOnly?: boolean }>(), { split: false, rankingOnly: false })
const emit = defineEmits<{ drill: [seriesId: string, periodId?: string, warehouse?: VolumeWarehouse]; customer: [id: string, name: string, code: string] }>()
const { locale } = useI18n(), { isDark } = useTheme()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const n = (value: number | null) => value === null ? '—' : value.toLocaleString()
const byCarrier = computed(() => props.data.query.category === 'carrier')
const ranking = computed(() => props.data.series.filter(s => s.kind !== 'total'))
const total = computed(() => props.data.series.find(s => s.kind === 'total'))
const chartGrain = computed(() => props.data.query.from ? 'day' : props.data.query.grain ?? 'month')
const sum = (values: (number | null)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0)
const charts = ref<InstanceType<typeof EChart>[]>([])
const periodTable = ref<HTMLElement>()
watch(() => props.data, async () => { await nextTick(); if (periodTable.value) periodTable.value.scrollLeft = periodTable.value.scrollWidth }, { immediate: true })
const axis = computed(() => isDark.value ? '#99A8BE' : '#8693A8')
const grid = computed(() => isDark.value ? '#293241' : '#EDF0F7')
const warehouses = computed<(VolumeWarehouse | undefined)[]>(() => props.split ? ['HZ', 'SZ', ...(sum(total.value?.warehouses.UNASSIGNED ?? []) ? ['UNASSIGNED' as const] : [])] : [undefined])
const warehouseLabel = (code?: VolumeWarehouse) => code === 'HZ' ? t('杭州仓', 'Hangzhou') : code === 'SZ' ? t('深圳仓', 'Shenzhen') : code === 'UNASSIGNED' ? t('未分配仓库', 'Unassigned') : t('订单量趋势', 'Order trend')
const plotted = computed(() => props.data.query.customerId ? props.data.series.filter(s => s.kind === 'total') : props.data.series)
const maxY = computed(() => Math.max(1, ...plotted.value.flatMap(s => warehouses.value.flatMap(w => (w ? s.warehouses[w] : s.values).map(v => v ?? 0)))))
function option(warehouse?: VolumeWarehouse) {
  return {
    animationDuration: 350, aria: { enabled: true }, textStyle: { color: axis.value, fontFamily: 'inherit' },
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, valueFormatter: (v: unknown) => v === null ? '—' : `${v} ${t('单', 'orders')}` },
    legend: { type: byCarrier.value ? 'plain' : 'scroll', itemGap: 12, top: 2, left: 8, right: 10, icon: 'roundRect', itemWidth: 13, itemHeight: 5, textStyle: { color: axis.value, fontSize: 11 } },
    grid: { top: byCarrier.value ? 86 : 55, left: 12, right: 18, bottom: 65, containLabel: true },
    xAxis: { type: 'category', data: props.data.periods.map(p => p.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: axis.value, fontSize: 11, hideOverlap: true } },
    yAxis: { type: 'value', name: t('订单 / 单', 'Orders'), minInterval: 1, ...(props.split ? { max: maxY.value } : {}), splitLine: { lineStyle: { color: grid.value, type: 'dashed' } } },
    dataZoom: [{ type: 'inside', ...latestVolumeWindow(chartGrain.value, props.data.periods), filterMode: 'none' }, { type: 'slider', ...latestVolumeWindow(chartGrain.value, props.data.periods), height: 16, bottom: 13, borderColor: 'transparent', backgroundColor: grid.value, fillerColor: '#94A5DD25', handleStyle: { color: '#A8B6DE', borderColor: '#A8B6DE' }, showDetail: false, brushSelect: false }],
    series: plotted.value.map(s => ({ id: s.id, name: s.label, type: s.kind === 'total' || chartGrain.value !== 'month' ? 'line' : 'bar', smooth: .2, symbol: 'circle', symbolSize: 5, barMaxWidth: 20,
      itemStyle: { color: volumeColor(s), borderRadius: [3, 3, 0, 0] }, lineStyle: { width: s.kind === 'total' ? 3 : 2 }, emphasis: { focus: 'series' }, data: warehouse ? s.warehouses[warehouse] : s.values })),
  }
}
const rankingOption = computed(() => ({
  animationDuration: 350, aria: { enabled: true }, tooltip: { trigger: 'axis', renderMode: 'richText', confine: true, axisPointer: { type: 'shadow' } },
  grid: { left: 8, right: 40, top: 10, bottom: 20, containLabel: true },
  xAxis: { type: 'value', minInterval: 1, axisLabel: { color: axis.value }, splitLine: { lineStyle: { color: grid.value, type: 'dashed' } } },
  yAxis: { type: 'category', inverse: true, data: ranking.value.map(s => s.code ? `${s.label} · ${s.code}` : s.label), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: axis.value, width: props.rankingOnly ? 240 : 145, overflow: 'truncate', fontSize: 11 } },
  series: [{ type: 'bar', barMaxWidth: 15, label: { show: true, position: 'right', color: axis.value }, data: ranking.value.map(s => ({ value: s.total, itemStyle: { color: volumeColor(s), borderRadius: [0, 4, 4, 0] } })) }],
}))
function chartClick(event: ChartClick, warehouse?: VolumeWarehouse) {
  if (!event.seriesId || event.dataIndex === undefined) return
  const period = props.data.periods[event.dataIndex]
  if (period && !period.future) emit('drill', event.seriesId, period.id, warehouse)
}
function chooseRank(event: ChartClick) {
  const row = ranking.value[event.dataIndex ?? -1]
  if (!row) return
  if (props.rankingOnly && row.entityId && row.kind === 'detail') emit('customer', row.entityId, row.label, row.code ?? '')
  else emit('drill', row.id)
}
function syncZoom(event: ChartZoom) { for (const chart of charts.value) chart.zoom(event) }
</script>

<template>
  <div class="ov-results">
    <div class="ov-kpis"><div><span>{{ total?.label }}</span><strong>{{ n(data.total) }}<small>{{ t('单', 'orders') }}</small></strong></div><div><span>{{ t('涉及客户', 'Customers') }}</span><b>{{ n(data.customerCount) }}</b></div><div class="ov-period"><span>{{ data.periods[0]?.from }} — {{ data.periods.at(-1)?.to }}</span><small>{{ t('按订单支付日期统计 · UTC+8', 'By order payment date · UTC+8') }} · {{ t('更新于', 'Updated') }} {{ new Date(data.asOf).toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) }}</small></div><button type="button" class="ov-link" @click="emit('drill', 'total')">{{ t('查看订单明细 ↗', 'View orders ↗') }}</button></div>
    <p v-if="!data.total" class="ov-empty">{{ t('当前条件下暂无获授权的有效订单，可调整时间或筛选条件。', 'No authorized valid orders match these filters.') }}</p>
    <div v-else class="ov-visuals" :class="{ 'ov-ranking-only': rankingOnly, 'ov-split': split && !rankingOnly }">
      <div v-if="!rankingOnly" class="ov-trends"><div v-for="warehouse in warehouses" :key="warehouse ?? 'all'" class="ov-trend"><h3>{{ warehouseLabel(warehouse) }}<small v-if="warehouse">{{ n(sum(total?.warehouses[warehouse] ?? [])) }} {{ t('单', 'orders') }}</small></h3><EChart ref="charts" :option="option(warehouse)" :label="warehouseLabel(warehouse)" @select="chartClick($event, warehouse)" @zoom="syncZoom" /></div></div>
      <div v-if="!data.query.customerId" class="ov-ranking"><h3>{{ rankingOnly ? t('客户订单量排名 · 前十＋其他', 'Customer ranking · Top 10 + Other') : byCarrier ? t('物流服务商订单分布', 'Orders by carrier') : t('区间订单量对比', 'Period comparison') }}<small>{{ rankingOnly ? t('点击客户查看趋势', 'Select a customer for trends') : byCarrier ? t('固定顺序', 'Fixed order') : t('完整查询周期', 'Full selected period') }}</small></h3><div :style="{ height: `${Math.max(310, ranking.length * 37 + 40)}px` }"><EChart :option="rankingOption" :label="t('订单量排名', 'Order volume ranking')" @select="chooseRank" /></div></div>
    </div>
    <div class="ov-table-scroll"><table class="ov-table"><thead><tr><th>{{ byCarrier ? t('物流服务商', 'Carrier') : t('统计对象', 'Group') }}</th><th>{{ t('订单量', 'Orders') }}</th><th>{{ t('占比', 'Share') }}</th><th>{{ t('杭州仓', 'Hangzhou') }}</th><th>{{ t('深圳仓', 'Shenzhen') }}</th><th v-if="sum(total?.warehouses.UNASSIGNED ?? [])">{{ t('未分配仓库', 'Unassigned') }}</th><th>{{ t('查看', 'View') }}</th></tr></thead><tbody><tr v-for="row in data.series" :key="row.id" :class="{ 'ov-total': row.kind === 'total' }"><td><span class="ov-dot" :style="{ background: volumeColor(row) }" />{{ row.label }}<small v-if="row.code">{{ row.code }}</small></td><td>{{ n(row.total) }}</td><td>{{ data.total ? (row.total / data.total * 100).toFixed(1) : '0.0' }}%</td><td>{{ n(sum(row.warehouses.HZ)) }}</td><td>{{ n(sum(row.warehouses.SZ)) }}</td><td v-if="sum(total?.warehouses.UNASSIGNED ?? [])">{{ n(sum(row.warehouses.UNASSIGNED)) }}</td><td><button v-if="rankingOnly && row.entityId && row.kind === 'detail'" class="ov-link" @click="emit('customer', row.entityId, row.label, row.code ?? '')">{{ t('趋势', 'Trend') }}</button><button class="ov-link" @click="emit('drill', row.id)">{{ t('订单 ↗', 'Orders ↗') }}</button></td></tr></tbody><TableTotals><th scope="row">{{ t('合计', 'Total') }}</th><td>{{ n(data.total) }}</td><td>{{ data.total ? '100.0' : '0.0' }}%</td><td>{{ n(sum(total?.warehouses.HZ ?? [])) }}</td><td>{{ n(sum(total?.warehouses.SZ ?? [])) }}</td><td v-if="sum(total?.warehouses.UNASSIGNED ?? [])">{{ n(sum(total?.warehouses.UNASSIGNED ?? [])) }}</td><td><button class="ov-link" @click="emit('drill', 'total')">{{ t('订单 ↗', 'Orders ↗') }}</button></td></TableTotals></table></div>
    <details v-if="!rankingOnly" class="ov-time-detail" @toggle="() => { if (periodTable) periodTable.scrollLeft = periodTable.scrollWidth }"><summary>{{ t('按时间展开统计清单', 'Expand period breakdown') }}<span>{{ t('点击数值进入工作台 · 汇总与明细不重复累加', 'Select a count to view orders · Totals are not counted twice') }}</span></summary><div ref="periodTable" class="ov-table-scroll"><table class="ov-table ov-period-table"><thead><tr><th>{{ byCarrier ? t('物流服务商', 'Carrier') : t('统计对象', 'Group') }}</th><th v-for="p in data.periods" :key="p.id">{{ p.label }}</th></tr></thead><tbody><tr v-for="row in data.series" :key="row.id" :class="{ 'ov-total': row.kind === 'total' }"><td>{{ row.label }}</td><td v-for="(value, i) in row.values" :key="i"><button :disabled="value === null" @click="emit('drill', row.id, data.periods[i]!.id)">{{ n(value) }}</button></td></tr></tbody><TableTotals><th scope="row">{{ t('合计', 'Total') }}</th><td v-for="(period, index) in data.periods" :key="period.id"><button :disabled="period.future" @click="emit('drill', 'total', period.id)">{{ n(total?.values[index] ?? null) }}</button></td></TableTotals></table></div></details>
  </div>
</template>

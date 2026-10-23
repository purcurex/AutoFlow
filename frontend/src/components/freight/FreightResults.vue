<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FreightCarrier, FreightData, FreightValue } from '@/api/fop-freight'
import { freightCarrierName, freightChange, freightChartOption, freightSeries } from '@/utils/freight'
import { formatChartCurrency } from '@/utils/currency'
import EChart, { type ChartClick } from '@/components/charts/EChart.vue'
import TableTotals from '@/components/ui/TableTotals.vue'

const props = defineProps<{ data: FreightData; compare: boolean; carrierCode?: FreightCarrier }>()
const emit = defineEmits<{ drill: [carrierCode?: FreightCarrier, periodId?: string, comparisonPeriod?: 'current' | 'previous']; trend: [code: FreightCarrier] }>()
const { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const money = (value: number) => formatChartCurrency(value, String(locale.value))
const change = (value: FreightValue) => freightChange(value, String(locale.value))
const series = computed(() => freightSeries(props.data).filter(row => !props.carrierCode || row.carrierCode === props.carrierCode))
const periods = computed(() => props.data.periods.map((period, index) => ({ ...period, index })).sort((a, b) => b.from.localeCompare(a.from)))
const option = computed(() => freightChartOption(props.data, props.compare, String(locale.value), props.carrierCode))
const totals = computed(() => props.carrierCode ? series.value[0]?.totals : props.data.totals)
const detailsOpen = ref(props.compare)
watch(() => props.compare, value => { if (value) detailsOpen.value = true })
function select(event: ChartClick) {
  const row = series.value.find(row => row.id === event.seriesId)
  const period = event.dataIndex === undefined ? undefined : props.data.periods[event.dataIndex]
  if (row && period) emit('drill', row.carrierCode, period.id)
}
</script>

<template>
  <div class="freight-results">
    <div v-if="totals" class="ov-kpis"><div><span>{{ compare ? t('上期环比差额合计', 'Total change from previous periods') : t('实际运费合计', 'Total actual freight') }}</span><strong>{{ compare ? change(totals).amount : money(totals.amount) }}</strong><small v-if="compare">{{ change(totals).percent }}</small></div><div><span>{{ t('已确认发运单', 'Confirmed delivery bills') }}</span><b>{{ carrierCode ? series[0]?.billCount : data.billCount }}</b></div><div class="ov-period"><span>{{ t('实际运费确认时间 · UTC+8', 'Actual freight confirmed at · UTC+8') }}</span><small>{{ t('金额折算为 USD · 原币及汇率见明细', 'Amounts in USD · Original currency and rates in details') }}</small><button class="ov-link" :data-freight-detail="carrierCode || 'total'" @click="emit('drill', carrierCode)">{{ t('查看发运单明细', 'View delivery bill details') }} ↗</button></div></div>
    <p v-if="data.periods.some(period => period.partial)" class="freight-partial">{{ t('未结束周期为截至当前的实际运费，环比与完整上期比较。', 'Partial periods include confirmed costs to date and are compared with the full previous period.') }}</p>
    <div class="freight-chart"><EChart :option="option" :label="compare ? t('物流运费上期环比柱状图', 'Freight period-over-period changes') : carrierCode ? t('物流服务商实际运费趋势折线图', 'Carrier actual freight trend') : t('物流运费对比柱状图', 'Actual freight comparison')" @select="select" /></div>
    <div v-if="!carrierCode" class="freight-trend-actions"><span>{{ t('服务商趋势', 'Carrier trends') }}</span><button v-for="row in series.filter(row => row.carrierCode)" :key="row.id" class="ov-link" :data-freight-trend="row.carrierCode" @click="emit('trend', row.carrierCode!)">{{ freightCarrierName(row.carrierCode!, String(locale)) }} ↗</button></div>
    <details :open="detailsOpen" class="ov-time-detail" @toggle="detailsOpen = ($event.target as HTMLDetailsElement).open">
      <summary>{{ compare ? t('运费环比统计表 · 差额 / 比例', 'Freight comparison table · Change / Rate') : t('运费统计表', 'Freight statistics table') }}<span>{{ t('时间倒序 · 点击金额查看发运单', 'Latest first · Select an amount for delivery bills') }}</span></summary>
      <div class="ov-table-scroll"><table class="ov-table freight-statistics" :style="{ width: `${180 + series.length * 152}px` }"><colgroup><col style="width:180px"><col v-for="row in series" :key="row.id" style="width:152px"></colgroup><thead><tr><th>{{ t('统计周期', 'Period') }}</th><th v-for="row in series" :key="row.id" :class="{ 'freight-total': row.kind === 'total' }">{{ row.carrierCode ? freightCarrierName(row.carrierCode, String(locale)) : t('合计', 'Total') }}</th></tr></thead><tbody><tr v-for="period in periods" :key="period.id"><th scope="row">{{ period.label }}<small v-if="period.partial">{{ t('未结束', 'Partial') }}</small></th><td v-for="row in series" :key="row.id" :class="{ 'freight-total': row.kind === 'total' }"><template v-if="row.values[period.index]"><button class="freight-money" :data-freight-detail="row.carrierCode || 'total'" :title="`${period.from} — ${period.to}`" @click="emit('drill', row.carrierCode, period.id)">{{ compare ? change(row.values[period.index]!).amount : money(row.values[period.index]!.amount) }}</button><small v-if="compare" class="freight-rate">{{ change(row.values[period.index]!).percent }}</small><button v-if="compare" class="freight-previous" :title="`${period.previousFrom} — ${period.previousTo}`" @click="emit('drill', row.carrierCode, period.id, 'previous')">{{ t('上期', 'Previous') }} {{ money(row.values[period.index]!.previousAmount) }} ↗</button></template></td></tr></tbody><TableTotals><th scope="row">{{ compare ? t('差额合计', 'Total change') : t('合计', 'Total') }}</th><td v-for="row in series" :key="row.id"><button class="freight-money" @click="emit('drill', row.carrierCode)">{{ compare ? change(row.totals).amount : money(row.totals.amount) }}</button><small v-if="compare" class="freight-rate">{{ change(row.totals).percent }}</small></td></TableTotals></table></div>
    </details>
    <p v-if="compare" class="ov-scope freight-comparison-note">{{ t('环比差额 = 本期 − 完整上期；比例 = 差额 ÷ 上期金额。合计比例按上期金额合计计算。上期为0且本期非0时不计算比例。环比金额链接查看本期，上期链接查看对比基期。', 'Change = current − full previous period; rate = change ÷ previous amount. The total rate uses summed previous amounts. Nonzero changes from zero have no percentage. Change links open current bills; previous links open the baseline.') }}</p>
  </div>
</template>

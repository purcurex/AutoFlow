<script setup lang="ts">
import { businessYears } from '@/utils/business-years'
import { useAnalyticsRefresh } from '@/composables/useAnalyticsRefresh'
import type { EffectiveChartAccess } from '@/api/fop-chart-access'
import { mockDashboardFreight } from '@/utils/mock-dashboard-freight'
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { getFopFreight, type FreightCarrier, type FreightData, type FreightGrain, type FreightQuery } from '@/api/fop-freight'
import { fopAccessError } from '@/api/fop-access'
import { freightCarrierName, freightDetailLocation } from '@/utils/freight'
import { onSessionReset } from '@/utils/session'
import { isWorkbenchRole } from '@/utils/workbench'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import FreightResults from './FreightResults.vue'
import FreightTrendDialog from './FreightTrendDialog.vue'
import '@/components/order-volume/order-volume.css'
import './freight.css'

const props = withDefaults(defineProps<{ revision?: number; mock?: boolean; mockAccess?: EffectiveChartAccess }>(), { revision: 0, mock: false })
const { refresh: refreshChartAccess, applyResponse: applyChartResponse, clear: clearChartAccess, visible: chartVisible, canViewDetails } = useChartAccess(() => 'freight')
const { locale } = useI18n(), route = useRoute(), router = useRouter()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), currentYear = Number(today.slice(0, 4))
const years = businessYears(currentYear)
const year = ref(currentYear), grain = ref<FreightGrain>('week'), weekOf = ref(today), warehouse = ref<FreightQuery['warehouse']>('ALL'), compare = ref(false)
const data = ref<FreightData>(), busy = ref(false), error = ref(''), selected = ref<FreightCarrier>()
const mockNow = new Date()
const query = computed<FreightQuery>(() => ({ grain: grain.value, year: year.value, warehouse: warehouse.value, ...(grain.value === 'week' ? { weekOf: weekOf.value } : {}) }))
const scope = computed(() => `${year.value} · ${warehouse.value === 'HZ' ? 'HangZhou' : warehouse.value === 'SZ' ? 'ShenZhen' : t('全部仓库', 'All warehouses')} · UTC+8`)
let requestId = 0, navigationId = 0
function reset() { clearChartAccess(); requestId++; navigationId++; data.value = undefined; selected.value = undefined; busy.value = false; error.value = '' }
const chartRefresh = useAnalyticsRefresh(() => load(true), () => busy.value)
async function load(force = false) {
  const id = ++requestId
  navigationId++; data.value = undefined; selected.value = undefined; error.value = ''; busy.value = true
  try {
    const capability = props.mock ? props.mockAccess : await refreshChartAccess()
    if (id !== requestId) return
    if (!capability?.visible) { clearChartAccess(); return }
    const result = props.mock ? mockDashboardFreight({ ...query.value }, capability, mockNow) : await getFopFreight({ ...query.value }, { force })
    if (id === requestId && applyChartResponse(result)) { data.value = result; chartRefresh.updated(result) }
  } catch (cause) { if (id === requestId) { reset(); error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) } }
  finally { if (id === requestId) busy.value = false }
}
watch(year, value => { if (!weekOf.value.startsWith(String(value))) weekOf.value = value === currentYear ? today : `${value}-12-31` })
watch([query, () => props.revision, () => props.mock, () => props.mockAccess], (_, previous) => load(!!props.revision && (!previous || props.revision !== previous[1])), { immediate: true })
watch(() => route.fullPath, () => { navigationId++; selected.value = undefined })
async function drill(carrierCode?: FreightCarrier, periodId?: string, comparisonPeriod: 'current' | 'previous' = 'current') {
  const result = data.value
  if (props.mock || !result || !canViewDetails.value) return
  const id = requestId, navigation = ++navigationId, path = route.fullPath
  try {
    const access = await refreshWorkbenchAccess()
    if (id !== requestId || navigation !== navigationId || path !== route.fullPath) return
    const requested = route.params.role
    const role = isWorkbenchRole(requested) && access.roles.includes(requested) ? requested : access.roles.includes('dispatch') ? 'dispatch' : access.roles[0]
    if (!role) { reset(); error.value = t('暂无可访问的岗位工作台，请联系管理员。', 'No workbench is available.'); return }
    await router.push(freightDetailLocation(role, result.query, carrierCode, periodId, comparisonPeriod))
  } catch (cause) { if (id === requestId && navigation === navigationId) { reset(); error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) } }
}
const off = onSessionReset(reset)
onBeforeUnmount(() => { off(); reset() })
</script>

<template>
  <section v-if="chartVisible" class="ov-panel freight-analysis" data-module="freight" :data-source="mock ? 'mock' : data?.source">
    <header class="freight-header">
      <h2>{{ t('物流运费分析', 'Logistics freight analysis') }}<span v-if="mock" class="ov-badge">Mock</span></h2>
      <small v-if="data">{{ t('更新', 'Updated') }} {{ new Date(data.asOf).toLocaleString(String(locale), { timeZone: 'Asia/Shanghai', hour12: false }) }}</small>
    </header>
    <form class="ov-filters freight-filters" @submit.prevent="load(true)">
      <div class="freight-query-filters">
        <label>{{ t('年份', 'Year') }}<select v-model.number="year" aria-label="运费年份"><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select></label>
        <label>{{ t('仓库', 'Warehouse') }}<select v-model="warehouse" aria-label="运费仓库"><option value="ALL">{{ t('全部仓库', 'All warehouses') }}</option><option value="HZ">{{ 'HangZhou' }}</option><option value="SZ">{{ 'ShenZhen' }}</option></select></label>
        <button class="freight-query" :disabled="busy">{{ busy ? t('查询中…', 'Loading…') : t('查询', 'Apply') }}</button>
      </div>
      <div class="freight-view-controls">
        <label>{{ t('时间轴', 'Timeline') }}<select v-model="grain" aria-label="运费时间轴"><option value="week">{{ t('按周', 'Weekly') }}</option><option value="month">{{ t('按月', 'Monthly') }}</option><option value="year">{{ t('按年', 'Yearly') }}</option></select></label>
        <label v-if="grain === 'week'">{{ t('截至所在周', 'Week of') }}<input v-model="weekOf" type="date" :min="`${year}-01-01`" :max="year === currentYear ? today : `${year}-12-31`" required aria-label="运费周日期"></label>
        <label class="ov-checkbox"><input v-model="compare" type="checkbox" aria-label="运费上期环比">{{ t('上期环比', 'Compare previous period') }}</label>
      </div>
    </form>
    <div class="freight-body"><p v-if="busy" class="ov-empty" role="status">{{ t('正在统计实际运费…', 'Loading actual freight…') }}</p><p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load(true)">{{ t('重试', 'Retry') }}</button></p><FreightResults v-else-if="data" :data="data" :compare="compare" :preview="mock" @drill="drill" @trend="selected = $event" /></div>
    <FreightTrendDialog v-if="selected && data" :name="freightCarrierName(selected, String(locale))" :scope="scope" @close="selected = undefined"><FreightResults :data="data" :compare="compare" :preview="mock" :carrier-code="selected" @drill="drill" /></FreightTrendDialog>
  </section>
  <p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load(true)">{{ t('重试', 'Retry') }}</button></p>
</template>

<style scoped>
.freight-analysis{margin-top:22px;padding:24px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);color:var(--color-text)}
.freight-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px}
.freight-header h2{display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;color:inherit}
.freight-header small{color:#8793a5;font-size:12px}
.freight-filters{display:block;margin:0;max-width:100%}
.freight-query-filters,.freight-view-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.freight-view-controls{margin-top:18px}
.freight-analysis .freight-filters label{display:inline-flex;flex-direction:row;align-items:center;flex:none;gap:8px;min-width:0;font-size:12px;color:inherit}
.freight-analysis .freight-filters :is(select,input[type=date],button){height:34px;border:1px solid var(--color-border);border-radius:6px;padding:7px 9px;background:var(--color-surface);color:inherit;font-size:12px}
.freight-analysis .freight-filters select[aria-label="运费年份"]{width:88px}
.freight-analysis .freight-filters select[aria-label="运费仓库"]{min-width:112px}
.freight-analysis .freight-filters select[aria-label="运费时间轴"]{min-width:90px}
.freight-analysis .freight-filters button.freight-query{background:#5368be;border-color:#5368be;color:white;white-space:nowrap}
.freight-body{padding:0}
:global(.dark .freight-analysis){color-scheme:dark}
</style>

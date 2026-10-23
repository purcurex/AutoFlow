<script setup lang="ts">
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Truck } from 'lucide-vue-next'
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

const props = withDefaults(defineProps<{ revision?: number }>(), { revision: 0 })
const { access: chartAccess, refresh: refreshChartAccess, applyResponse: applyChartResponse, clear: clearChartAccess, visible: chartVisible, canViewDetails } = useChartAccess(() => 'freight')
const { locale } = useI18n(), route = useRoute(), router = useRouter()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), currentYear = Number(today.slice(0, 4))
const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)
const year = ref(currentYear), grain = ref<FreightGrain>('month'), weekOf = ref(today), warehouse = ref<FreightQuery['warehouse']>('ALL'), compare = ref(false)
const data = ref<FreightData>(), busy = ref(false), error = ref(''), selected = ref<FreightCarrier>()
const query = computed<FreightQuery>(() => ({ grain: grain.value, year: year.value, warehouse: warehouse.value, ...(grain.value === 'week' ? { weekOf: weekOf.value } : {}) }))
const scope = computed(() => `${year.value} · ${warehouse.value === 'HZ' ? t('杭州仓', 'Hangzhou') : warehouse.value === 'SZ' ? t('深圳仓', 'Shenzhen') : t('全部仓库', 'All warehouses')} · UTC+8`)
let requestId = 0, navigationId = 0
function reset() { clearChartAccess(); requestId++; navigationId++; data.value = undefined; selected.value = undefined; busy.value = false; error.value = '' }
async function load() {
  const id = ++requestId
  navigationId++; data.value = undefined; selected.value = undefined; error.value = ''; busy.value = true
  try {
    const capability = await refreshChartAccess()
    if (id !== requestId || !capability?.visible) return
    const result = await getFopFreight({ ...query.value })
    if (id === requestId && applyChartResponse(result)) data.value = result
  } catch (cause) { if (id === requestId) { reset(); error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) } }
  finally { if (id === requestId) busy.value = false }
}
watch(year, value => { if (!weekOf.value.startsWith(String(value))) weekOf.value = value === currentYear ? today : `${value}-12-31` })
watch([query, () => props.revision], load, { immediate: true })
watch(() => route.fullPath, () => { navigationId++; selected.value = undefined })
async function drill(carrierCode?: FreightCarrier, periodId?: string, comparisonPeriod: 'current' | 'previous' = 'current') {
  const result = data.value
  if (!result || !canViewDetails.value) return
  const id = requestId, navigation = ++navigationId, path = route.fullPath
  try {
    const access = await refreshWorkbenchAccess()
    if (id !== requestId || navigation !== navigationId || path !== route.fullPath) return
    const requested = route.params.role
    const role = isWorkbenchRole(requested) && access.roles.includes(requested) ? requested : access.roles.includes('dispatch') ? 'dispatch' : access.roles[0]
    if (!role) { reset(); error.value = t('暂无可访问的岗位工作台，请联系管理员。', 'No authorized workbench is available.'); return }
    await router.push(freightDetailLocation(role, result.query, carrierCode, periodId, comparisonPeriod))
  } catch (cause) { if (id === requestId && navigation === navigationId) { reset(); error.value = fopAccessError(cause, String(locale.value).startsWith('zh')) } }
}
const off = onSessionReset(reset)
onBeforeUnmount(() => { off(); reset() })
</script>

<template>
  <section v-if="chartVisible" class="ov-panel freight-analysis" data-module="freight">
    <p class="ov-scope" data-chart-scope>{{ chartAccess?.scopeLabel }}</p>
    <header class="ov-header"><div class="ov-heading"><h2><Truck :size="18" />{{ t('物流运费分析', 'Logistics freight analysis') }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2><p>{{ t('按已审核发运单统计获授权的已确认实际运费 · $', 'Authorized confirmed actual freight on approved delivery bills · $') }}</p></div><form class="ov-filters" @submit.prevent="load"><label>{{ t('年份', 'Year') }}<select v-model.number="year" aria-label="运费年份"><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select></label><label>{{ t('时间轴', 'Timeline') }}<select v-model="grain" aria-label="运费时间轴"><option value="month">{{ t('按月', 'Monthly') }}</option><option value="week">{{ t('按周', 'Weekly') }}</option><option value="year">{{ t('按年', 'Yearly') }}</option></select></label><label v-if="grain === 'week'">{{ t('截至所在周', 'Week of') }}<input v-model="weekOf" type="date" :min="`${year}-01-01`" :max="year === currentYear ? today : `${year}-12-31`" required aria-label="运费周日期"></label><label>{{ t('仓库', 'Warehouse') }}<select v-model="warehouse" aria-label="运费仓库"><option value="ALL">{{ t('全部仓库', 'All warehouses') }}</option><option value="HZ">{{ t('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ t('深圳仓', 'Shenzhen') }}</option></select></label><label class="ov-checkbox"><input v-model="compare" type="checkbox" aria-label="运费上期环比">{{ t('上期环比', 'Compare previous period') }}</label><button class="ov-secondary" :disabled="busy">{{ t('刷新', 'Refresh') }}</button></form></header>
    <div class="ov-body"><p class="ov-scope">{{ t('归期依据实际运费确认时间，使用 UTC+8，非银行付款日。按月展示所选年度，按周展示所选周及前三周，按年展示所选年及前四年（最早2020年）。', 'Periods use actual freight confirmation time in UTC+8, not the bank payment date. Monthly: selected year. Weekly: selected week and three preceding weeks. Yearly: selected year and four preceding years, starting no earlier than 2020.') }}</p><p v-if="busy" class="ov-empty" role="status">{{ t('正在统计实际运费…', 'Loading actual freight…') }}</p><p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></p><FreightResults v-else-if="data" :data="data" :compare="compare" @drill="drill" @trend="selected = $event" /></div>
    <FreightTrendDialog v-if="selected && data" :name="freightCarrierName(selected, String(locale))" :scope="scope" @close="selected = undefined"><FreightResults :data="data" :compare="compare" :carrier-code="selected" @drill="drill" /></FreightTrendDialog>
  </section>
  <p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></p>
</template>

<script setup lang="ts">
import type { ChartId } from '@/api/fop-chart-access'
import { onSessionReset } from '@/utils/session'
import { formatChartCurrency } from '@/utils/currency'
import { sumMoney } from '@/utils/tableTotals'
import TableTotals from '@/components/ui/TableTotals.vue'
import ReceiptChangeValue from '@/components/charts/ReceiptChangeValue.vue'
import { receiptChanges, totalReceiptChange, formatReceiptChange } from '@/utils/receiptChanges'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertCircle, ClipboardCheck, Clock3, PackageCheck, ShoppingCart, Send, RefreshCw, Truck, Users, Wallet } from 'lucide-vue-next'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { RouterLink, useRouter } from 'vue-router'
import { workbenchOrderLocation } from '@/utils/workbench'
import type { FopOrderQueue } from '@/api/fop-orders'
import { useI18n } from 'vue-i18n'
import { AppLayout } from '@/components/layout'
import OrderVolumeAnalysis from '@/components/order-volume/OrderVolumeAnalysis.vue'
import FreightAnalysis from '@/components/freight/FreightAnalysis.vue'
import EChart, { type ChartClick } from '@/components/charts/EChart.vue'
import WorkCalendar from '@/components/WorkCalendar.vue'
import FopDataAccessNotice from '@/components/FopDataAccessNotice.vue'
import { fopAccessError } from '@/api/fop-access'
import { useTheme } from '@/composables/useTheme'
import { getFopDashboard, localDate, type FopDashboardData, type ReceiptSeries } from '@/api/fop-dashboard'

const { locale } = useI18n()
const router = useRouter()
const { isDark } = useTheme()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const today = new Date()
const weekAgo = new Date(today.getTime() - 6 * 86_400_000)
const from = ref(localDate(weekAgo))
const to = ref(localDate(today))
const currentYear = Number(localDate(today).slice(0, 4))
const year = ref(currentYear)
const years = Array.from({ length: 5 }, (_, index) => currentYear - index)
const data = ref<FopDashboardData>()
const chart = (id: ChartId) => data.value?.chartAccess?.find(item => item.chartId === id)
const visible = (id: ChartId) => chart(id)?.visible === true
const canDetails = (id: ChartId) => visible(id) && chart(id)?.canViewDetails === true && !chart(id)?.summaryOnly
const busy = ref(false)
const error = ref('')
const appliedRange = ref('')
const appliedYear = ref(year.value)
const dataLocale = computed(() => zh.value ? 'zh-CN' : 'en-US')
const number = (value: number) => new Intl.NumberFormat(dataLocale.value).format(value)
const money = (value: number) => formatChartCurrency(value, dataLocale.value)
const updated = computed(() => data.value ? new Date(data.value.updatedAt).toLocaleTimeString(dataLocale.value, { hour12: false, timeZone: 'Asia/Shanghai' }) : '—')
const registrationScope = ref('marketing')
const registrationDepartment = computed(() => data.value?.registrationDepartments?.find(item => item.id === registrationScope.value))
const recordTotalLabel = (id: ChartId) => chart(id)?.dataScope === 'self' ? text('本人合计', 'My total') : text('当前成员合计', 'Current members total')
const registrationScopeName = computed(() => chart('registrations')?.summaryDepartments.length ? registrationScope.value === 'marketing' ? text('统计部门', 'Reporting departments') : registrationDepartment.value?.name ?? '' : recordTotalLabel('registrations'))
const registrationSeries = computed(() => {
  if (!data.value?.registrations.length) return []
  if (registrationScope.value === 'marketing') return [
    { id: 'marketing', name: chart('registrations')?.summaryDepartments.length ? text('统计部门合计', 'Department summary total') : recordTotalLabel('registrations'), counts: data.value.registrations.map(item => item.count) },
    ...(data.value.registrationDepartments ?? []).map(item => ({ id: item.id, name: item.name, counts: item.counts })),
  ]
  const department = registrationDepartment.value
  return department ? [{ id: `total:${department.id}`, name: chart('registrations')?.summaryDepartments.includes(department.id as never) ? `${department.name}${text('合计', ' total')}` : `${department.name} · ${recordTotalLabel('registrations')}`, counts: department.counts }, ...(chart('registrations')?.summaryOnly ? [] : department.salespeople)] : []
})
// Aggregate and individuals are peer series, but the headline must count only once.
const registrationTotal = computed(() => registrationSeries.value[0]?.counts.reduce((sum, count) => sum + count, 0) ?? 0)
const receiptSeries = computed(() => data.value?.departmentReceipts ? [...(data.value.departmentReceipts.marketingCenter ? [data.value.departmentReceipts.marketingCenter] : []), ...data.value.departmentReceipts.departments] : [])
// Preserve each month's source index so all amount columns stay aligned after sorting.
const receiptRows = computed(() => (data.value?.departmentReceipts?.months ?? [])
  .map((month, index) => ({ month, index }))
  .sort((left, right) => right.month.localeCompare(left.month)))
const receiptTotal = computed(() => sumMoney(data.value?.departmentReceipts?.departments.flatMap(item => item.amounts) ?? []))
const salespersonReceiptRows = computed(() => (data.value?.receipts.months ?? []).map((month, index) => ({ month, index })).sort((a, b) => b.month.localeCompare(a.month)))
const departments = computed<Record<string, string>>(() => ({ sales1: text('业务一部', 'Sales I'), sales2: text('业务二部', 'Sales II'), sales3: text('业务三部', 'Sales III'), sales4: text('业务四部', 'Sales IV') }))
const selectedDepartmentId = ref('sales1')
const departmentMom = ref(false), salespersonMom = ref(false)
const departmentDetailsOpen = ref(false), salespersonDetailsOpen = ref(true)
// Mode changes reveal details, while manual disclosure state remains independent.
watch(departmentMom, enabled => { if (enabled) departmentDetailsOpen.value = true })
watch(salespersonMom, enabled => { if (enabled) salespersonDetailsOpen.value = true })
const selectedDepartment = computed(() => data.value?.receipts.departments.find(department => department.id === selectedDepartmentId.value))
const salespeople = computed(() => selectedDepartment.value?.salespeople ?? [])
const salespersonSeries = computed(() => {
  const department = selectedDepartment.value
  if (!department) return []
  return [
    { id: `total:${department.id}`, name: `${department.name || departments.value[department.id] || department.id} · ${recordTotalLabel('salesperson_receipts')}`, amounts: department.amounts, previousAmount: department.previousAmount, breakdown: department.breakdown, previousBreakdown: department.previousBreakdown },
    ...department.salespeople,
  ]
})
const selectedDepartmentTotal = computed(() => sumMoney(selectedDepartment.value?.amounts ?? []))
const changesFor = (series: ReceiptSeries) => {
  const receipts = receiptSeries.value.includes(series) ? data.value?.departmentReceipts : data.value?.receipts
  return receiptChanges(series, receipts?.months ?? [], receipts?.previousMonth)
}
const changeTotalFor = (series: ReceiptSeries) => totalReceiptChange(changesFor(series))
const latestReceiptMonth = computed(() => data.value?.departmentReceipts?.months.at(-1) ?? '')
const latestMarketingChange = computed(() => {
  const receipts = data.value?.departmentReceipts
  if (!receipts?.departments.length) return undefined
  const total = receipts.marketingCenter ?? { id: 'marketing', amounts: receipts.months.map((_, index) => sumMoney(receipts.departments.map(dept => dept.amounts[index] ?? 0))), previousAmount: receipts.departments.every(dept => dept.previousAmount != null) ? sumMoney(receipts.departments.map(dept => dept.previousAmount!)) : null }
  return receiptChanges(total, receipts.months, receipts.previousMonth).at(-1)
})
const latestDepartmentChange = computed(() => selectedDepartment.value ? changesFor(selectedDepartment.value).at(-1) : undefined)
const momHint = computed(() => text('差额 = 本月 − 上月；比例 = 差额 ÷ 上月。1 月对比上年 12 月；本月为截至目前数据。', 'Change = this month − prior month; rate = change ÷ prior month. January compares with December; the current month is to date.'))

const reasons = computed(() => ({ stock: text('库存不足，等待补货', 'Insufficient stock · replenishment pending'), address: text('收货地址待核验', 'Delivery address needs verification'), tracking: text('物流单号获取异常', 'Tracking number could not be retrieved') }))
const taskNames = computed(() => ({ review: text('审核履约订单', 'Review fulfillment orders'), dispatch: text('同步 Shopify 发货', 'Sync Shopify fulfillment'), procurement: text('跟进采购付款与供应商发货', 'Follow up purchase payment and supplier shipment'), allocation: text('跟进配货与配货单审核', 'Follow up allocation and approval'), shipping: text('跟进仓库打包与出库', 'Follow up warehouse packing and outbound') }))
const cards = computed(() => [
  { id: 'review', label: text('待审核', 'Pending review'), hint: text('履约订单待审核', 'Fulfillment orders awaiting review'), value: data.value?.queues.review, icon: ClipboardCheck, color: 'review' },
  { id: 'dispatch', label: text('待履约', 'Pending fulfillment'), hint: text('已审核 · Shopify 待履约', 'Reviewed · Shopify fulfillment pending'), value: data.value?.queues.dispatch, icon: Send, color: 'fulfillment' },
  { id: 'procurement', label: text('待采购', 'Pending procurement'), hint: text('采购未完成付款 / 已采购未发货', 'Purchase payment / supplier shipment pending'), value: data.value?.queues.procurement, icon: ShoppingCart, color: 'procurement' },
  { id: 'allocation', label: text('待配货', 'Pending allocation'), hint: text('配货单未审核 · 未齐套 / 已齐套', 'Incomplete allocation / approval pending'), value: data.value?.queues.allocation, icon: PackageCheck, color: 'allocation' },
  { id: 'shipping', label: text('待出库', 'Pending outbound'), hint: text('配货已审核 · 待打包出库', 'Allocation approved · packing / outbound pending'), value: data.value?.queues.shipping, icon: Truck, color: 'shipping' },
])

const orderVolumeRevision = ref(0)
let requestId = 0
async function refresh() {
  if (busy.value) return
  busy.value = true
  if (requestId > 0) orderVolumeRevision.value++
  error.value = ''
  data.value = undefined
  appliedRange.value = ''
  const id = ++requestId
  const submitted = { from: from.value, to: to.value, year: year.value }
  try {
    const result = await getFopDashboard(submitted)
    if (id !== requestId) return
    data.value = result
    if (!result.receipts.departments.some(department => department.id === selectedDepartmentId.value)) selectedDepartmentId.value = result.receipts.departments[0]?.id ?? 'sales1'
    if (registrationScope.value !== 'marketing' && !result.registrationDepartments?.some(department => department.id === registrationScope.value)) registrationScope.value = 'marketing'
    appliedRange.value = `${submitted.from} — ${submitted.to}`
    appliedYear.value = submitted.year
  } catch (cause) {
    if (id === requestId) error.value = fopAccessError(cause, zh.value)
  } finally { if (id === requestId) busy.value = false }
}
const offSession = onSessionReset(() => { requestId++; data.value = undefined; busy.value = false; error.value = ''; appliedRange.value = ''; registrationScope.value = 'marketing'; selectedDepartmentId.value = 'sales1' })
onBeforeUnmount(() => { requestId++; offSession() })
onMounted(refresh)
const axisColor = computed(() => isDark.value ? '#94a3b8' : '#8793a7')
const gridColor = computed(() => isDark.value ? '#293241' : '#edf0f7')
// Use one aggregate color in every chart; detail colors retain their order across views.
const aggregateColor = '#94A5DD'
const detailColors = ['#64BDB1', '#E7B96C', '#E49AA5', '#A996D1', '#79B7D2', '#B3BF78']
const detailColor = (index: number) => detailColors[index % detailColors.length]!
const receiptColor = (id: string) => id === data.value?.departmentReceipts?.marketingCenter?.id
  ? aggregateColor
  : detailColor(Math.max(0, data.value?.departmentReceipts?.departments.findIndex(item => item.id === id) ?? 0))
const common = computed(() => ({
  animationDuration: 400,
  textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: axisColor.value },
  aria: { enabled: true },
  tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: isDark.value ? '#1e293b' : '#ffffff', borderColor: gridColor.value, textStyle: { color: isDark.value ? '#e2e8f0' : '#334155' } },
}))
const registrationOption = computed(() => ({
  ...common.value,
  color: [aggregateColor, ...detailColors],
  legend: { type: 'scroll', top: 8, left: 12, right: 50, textStyle: { color: axisColor.value } },
  grid: { left: 42, right: 24, top: 65, bottom: 42 },
  toolbox: { right: 16, top: 35, feature: chart('registrations')?.canExport ? { saveAsImage: { title: text('下载图表', 'Save chart'), type: 'svg' } } : {} },
  xAxis: { type: 'category', boundaryGap: false, data: data.value?.registrations.map(item => item.date) ?? [], axisLabel: { formatter: (value: string) => value.slice(5), color: axisColor.value, hideOverlap: true }, axisLine: { lineStyle: { color: gridColor.value } }, axisTick: { show: false } },
  yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: gridColor.value, type: 'dashed' } }, axisLabel: { color: axisColor.value } },
  series: registrationSeries.value.map((item, index) => ({ name: item.name, type: 'line', smooth: true, symbol: 'circle', symbolSize: index === 0 ? 6 : 5, showSymbol: false, itemStyle: { color: index === 0 ? aggregateColor : detailColor(index - 1) }, lineStyle: { width: index === 0 ? 3 : 2 }, areaStyle: index === 0 ? { color: aggregateColor, opacity: 0.07 } : undefined, emphasis: { focus: 'series' }, data: item.counts })),
}))
// Keep the full history available while opening the viewport at the latest six months.
const receiptZoomRange = computed(() => {
  const monthCount = data.value?.receipts.months.length ?? 0
  return { startValue: Math.max(0, monthCount - 6), endValue: Math.max(0, monthCount - 1) }
})
const receiptBaseOption = computed(() => ({
  ...common.value,
  color: [aggregateColor, ...detailColors],
  grid: { left: 62, right: 20, top: 62, bottom: 80 },
  legend: { type: 'scroll', top: 4, left: 'center', textStyle: { color: axisColor.value }, itemWidth: 12, itemHeight: 9 },
  xAxis: { type: 'category', data: data.value?.receipts.months ?? [], axisLabel: { color: axisColor.value, hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: gridColor.value } } },
  yAxis: { type: 'value', name: '$', axisLabel: { color: axisColor.value, formatter: (value: number) => `${value / 1000}K` }, splitLine: { lineStyle: { color: gridColor.value } } },
  dataZoom: [{ ...receiptZoomRange.value, type: 'slider', bottom: 12, height: 22, borderColor: gridColor.value, fillerColor: 'rgba(148,165,221,.14)', dataBackground: { lineStyle: { color: '#c5cee9' }, areaStyle: { color: '#e7ebf6' } }, handleStyle: { color: aggregateColor, borderColor: aggregateColor }, moveHandleStyle: { color: aggregateColor }, selectedDataBackground: { lineStyle: { color: aggregateColor }, areaStyle: { color: '#c5cee9' } } }],
}))
function collectionsOption(series: ReceiptSeries[], compare: boolean, colors: string[], receipts?: FopDashboardData['receipts']) {
  const changes = series.map(changesFor)
  return {
    ...receiptBaseOption.value,
    xAxis: { ...receiptBaseOption.value.xAxis, data: receipts?.months ?? [] },
    dataZoom: receiptBaseOption.value.dataZoom.map(zoom => ({ ...zoom, startValue: Math.max(0, (receipts?.months.length ?? 0) - 6), endValue: Math.max(0, (receipts?.months.length ?? 0) - 1) })),
    tooltip: { ...common.value.tooltip, confine: true, ...(compare ? {
      formatter: (raw: unknown) => {
        const points = (Array.isArray(raw) ? raw : [raw]) as { seriesIndex: number; dataIndex: number }[]
        const month = receipts?.months[points[0]?.dataIndex ?? 0] ?? ''
        return [month + text(' · 较上月', ' · Month over month'), ...points.map(point => {
          const item = series[point.seriesIndex]
          const value = formatReceiptChange(changes[point.seriesIndex]?.[point.dataIndex], dataLocale.value)
          return `${item?.name || departments.value[item?.id ?? ''] || ''}: ${value.amount}  (${value.percent})`
        })].join('\n')
      },
    } : { valueFormatter: (value: unknown) => typeof value === 'number' ? money(value) : '—', formatter: (raw: unknown) => {
      const points = (Array.isArray(raw) ? raw : [raw]) as { seriesIndex: number; dataIndex: number }[]
      return [receipts?.months[points[0]?.dataIndex ?? 0] ?? '', ...points.flatMap(point => {
        const item = series[point.seriesIndex]; if (!item) return []
        return [`${item.name || departments.value[item.id] || item.id}: ${money(item.amounts[point.dataIndex] ?? 0)}`, receiptBreakdown(item, point.dataIndex)].filter(Boolean)
      })].join('\n')
    } }) },
    yAxis: { ...receiptBaseOption.value.yAxis, name: compare ? text('差额 / $', 'Change / $') : '$' },
    series: series.map((item, index) => ({
      id: item.id, name: item.name || departments.value[item.id] || item.id, type: 'bar', barMaxWidth: 22, barGap: '25%',
      itemStyle: { color: colors[index], borderRadius: compare ? 2 : [4, 4, 0, 0] }, emphasis: { focus: 'series' },
      ...(compare && index === 0 ? { markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: axisColor.value, width: 1, type: 'solid', opacity: 0.45 }, data: [{ yAxis: 0 }] } } : {}),
      data: compare ? changes[index]!.map(value => value.delta) : item.amounts,
    })),
  }
}
function receiptBreakdown(series?: ReceiptSeries, index?: number) {
  if (!series?.breakdown) return ''
  const amount = (values: number[]) => index === undefined ? sumMoney(values) : values[index] ?? 0
  return `${text('履约订单', 'Fulfillment')} ${money(amount(series.breakdown.fulfillment))} · ${text('全款备货', 'Full-payment stocking')} ${money(amount(series.breakdown.fullPaymentStock))}`
}
const marketingBreakdown = computed(() => {
  const receipts = data.value?.departmentReceipts
  if (!receipts) return ''
  if (receipts.marketingCenter?.breakdown) return receiptBreakdown(receipts.marketingCenter)
  if (!receipts.departments.every(department => department.breakdown)) return ''
  return receiptBreakdown({ id: 'marketing', amounts: [], breakdown: { fulfillment: receipts.departments.flatMap(department => department.breakdown!.fulfillment), fullPaymentStock: receipts.departments.flatMap(department => department.breakdown!.fullPaymentStock) } })
})
async function openReceipts(month: string, department?: string, ownerId?: string) {
  if (!canDetails('salesperson_receipts')) return
  const id = requestId
  try {
    const access = await refreshWorkbenchAccess()
    if (id !== requestId) return
    const role = access.roles[0]
    if (!role) { error.value = text('暂无可访问的岗位工作台。', 'No workbench is available.'); return }
    const [year, number] = month.split('-').map(Number)
    const last = new Date(Date.UTC(year!, number!, 0)).getUTCDate()
    const from = `${month}-01`, monthEnd = `${month}-${String(last).padStart(2, '0')}`, today = localDate(new Date())
    const to = monthEnd < today ? monthEnd : today
    if (from > to) return
    await router.push({ name: 'RoleWorkbenchReceipts', params: { role }, query: { from, to, warehouse: 'ALL', chartId: 'salesperson_receipts', ...(department ? { department } : {}), ...(ownerId ? { ownerId } : {}) } })
  } catch (cause) { if (id === requestId) error.value = fopAccessError(cause, zh.value) }
}
function selectReceipt(event: ChartClick, employees: boolean) {
  if (!employees || !canDetails('salesperson_receipts')) return
  if (event.dataIndex === undefined || event.seriesId === undefined || (employees ? salespersonMom.value : departmentMom.value)) return
  const month = data.value?.receipts.months[event.dataIndex]
  const series = (employees ? salespersonSeries.value : receiptSeries.value).find(item => item.id === event.seriesId)
  if (month && series) void openReceipts(month, employees ? selectedDepartmentId.value : series.id === data.value?.departmentReceipts?.marketingCenter?.id ? undefined : series.id, employees && !series.id.startsWith('total:') ? series.id : undefined)
}
const receiptOption = computed(() => collectionsOption(receiptSeries.value, departmentMom.value, receiptSeries.value.map(item => receiptColor(item.id)), data.value?.departmentReceipts))
const salespersonOption = computed(() => collectionsOption(salespersonSeries.value, salespersonMom.value, salespersonSeries.value.map((_, index) => index === 0 ? aggregateColor : detailColor(index - 1)), data.value?.receipts))
</script>

<template>
  <AppLayout>
    <main class="app-page fop-dashboard" :aria-busy="busy">
      <header class="dashboard-heading">
        <div><p class="eyebrow">HYPERZONE · DASHBOARD</p><h1>Dashboard <span class="mock-badge">{{ data?.source === 'mock' ? 'MOCK · DEMO' : text('业务概览', 'BUSINESS OVERVIEW') }}</span></h1></div>
        <button class="refresh-button" :disabled="busy" @click="refresh"><RefreshCw :class="{ 'animate-spin': busy }" :size="15" />{{ busy ? text('刷新中', 'Refreshing') : text('刷新数据', 'Refresh') }}</button>
      </header>
      <FopDataAccessNotice @recheck="refresh" />
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>

      <section class="summary-grid" :aria-label="text('履约概览', 'Fulfillment overview')">
        <RouterLink v-for="card in cards" :key="card.id" :to="workbenchOrderLocation(card.id as FopOrderQueue)" class="summary-card" :class="card.color" :aria-label="text(`查看${card.label}清单`, `View ${card.label} orders`)">
          <div class="card-top"><span>{{ card.label }}</span><component :is="card.icon" :size="21" :stroke-width="1.6" /></div>
          <strong>{{ card.value === undefined ? '—' : number(card.value) }}</strong><p>{{ card.hint }}</p><span class="card-decoration" />
        </RouterLink>
        <WorkCalendar />
      </section>

      <div class="insights-grid">
        <section v-if="visible('registrations')" class="dashboard-panel registration-panel">
          <div class="panel-top statistics-heading"><h2><Users :size="17" />{{ text('每日注册会员统计', 'Daily registrations') }}</h2><div class="statistics-filters">
            <label class="year-filter">{{ text('统计维度', 'Dimension') }}<select v-model="registrationScope" :disabled="busy" :aria-label="text('注册统计维度', 'Registration dimension')"><option value="marketing">{{ text('营销中心', 'Marketing center') }}</option><option v-for="department in data?.registrationDepartments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          </div></div>
          <form class="date-filter" @submit.prevent="refresh">
            <label><span>{{ text('开始日期', 'Start date') }}</span><input v-model="from" type="date" required :max="to || localDate(today)" :aria-label="text('开始日期', 'Start date')" /></label><span class="date-dash">—</span>
            <label><span>{{ text('结束日期', 'End date') }}</span><input v-model="to" type="date" required :min="from" :max="localDate(today)" :aria-label="text('结束日期', 'End date')" /></label>
            <button class="query-button" :disabled="busy" type="submit">{{ text('查询', 'Apply') }}</button>
          </form>

          <div class="chart-summary"><strong>{{ registrationSeries.length ? number(registrationTotal) : '—' }}</strong><span>{{ registrationScopeName }} · {{ text('区间新增会员', 'new members in range') }}</span><small>{{ appliedRange }}</small></div>
          <div class="registration-chart"><p v-if="!registrationSeries.length" class="empty-message">{{ data?.registrations.length ? text('所选维度暂无注册数据', 'No registration data for this dimension') : text('暂无可查看的注册统计', 'No registration statistics available') }}</p><EChart v-else :can-export="chart('registrations')?.canExport === true" :option="registrationOption" :label="text('每日注册会员趋势图', 'Daily registration trend')" /></div>
          <div v-if="registrationSeries.length" class="data-details registration-data-list">
            <div class="registration-list-heading"><h3>{{ text('注册会员数据清单', 'Registration data') }}</h3><span>{{ text('合计与成员平级展示，合计不重复累加', 'Totals and members are peers; totals are counted once') }}</span></div>
            <div class="table-scroll"><table><thead><tr><th>{{ text('统计对象', 'Department / salesperson') }}</th><th>{{ text('区间合计', 'Period total') }}</th><th v-for="item in data?.registrations" :key="item.date">{{ item.date.slice(5) }}</th></tr></thead><tbody><tr v-for="series in registrationSeries" :key="series.id" :class="{ 'aggregate-cell': series === registrationSeries[0] }"><td>{{ series.name }}</td><td>{{ number(series.counts.reduce((sum, count) => sum + count, 0)) }}</td><td v-for="(item, index) in data?.registrations" :key="item.date">{{ number(series.counts[index] ?? 0) }}</td></tr></tbody><TableTotals><th scope="row">{{ text('合计', 'Total') }}</th><td>{{ number(registrationTotal) }}</td><td v-for="(item, index) in data?.registrations" :key="item.date">{{ number(registrationSeries[0]?.counts[index] ?? 0) }}</td></TableTotals></table></div>
          </div>
        </section>

        <div class="activity-column">
          <section class="dashboard-panel exception-panel">
            <div class="panel-top"><h2><AlertCircle :size="17" />{{ text('异常订单', 'Order exceptions') }}<RouterLink :to="workbenchOrderLocation('exceptions')" class="count-badge" :aria-label="text('查看全部异常订单', 'View all order exceptions')">{{ data ? data.exceptions.length : '—' }}</RouterLink></h2><span class="subtle-label">{{ text('待处理异常', 'ACTION REQUIRED') }}</span></div>
            <div class="activity-list"><RouterLink v-for="item in data?.exceptions.slice(0, 5)" :key="item.id" :to="workbenchOrderLocation('exceptions', { orderNumber: item.id })" class="exception-row"><span class="status-dot" /><div><p class="row-heading">{{ item.id }} <span>{{ item.customer }}</span></p><p class="row-description">{{ reasons[item.reason] }}</p></div><span class="age-badge">{{ item.hours }}h</span></RouterLink><p v-if="data && !data.exceptions.length" class="empty-message">{{ text('暂无异常订单', 'No order exceptions') }}</p></div>
            <footer>{{ text('更新时间', 'Updated') }} {{ updated }} · UTC+8<RouterLink v-if="data && data.exceptions.length > 5" :to="workbenchOrderLocation('exceptions')" class="ml-3 text-indigo-600">{{ text(`查看全部 ${data.exceptions.length} 笔异常`, `View all ${data.exceptions.length} exceptions`) }}</RouterLink></footer>
          </section>
          <section class="dashboard-panel task-panel">
            <div class="panel-top"><h2><Clock3 :size="17" />{{ text('履约待办', 'Fulfillment Tasks') }}</h2><span class="subtle-label">{{ text('按优先级处理', 'PRIORITY QUEUE') }}</span></div>
            <div class="activity-list"><RouterLink v-for="task in data?.tasks" :key="task.id" :to="workbenchOrderLocation(task.kind)" class="task-row"><span class="task-time">{{ task.time }}</span><div><p class="row-heading">{{ taskNames[task.kind] }}</p><p class="row-description">{{ task.count }} {{ text('单待处理', 'orders pending') }}</p></div><span class="priority" :class="task.priority">{{ task.priority === 'high' ? text('优先', 'Priority') : text('常规', 'Normal') }}</span></RouterLink><p v-if="data && !data.tasks.length" class="empty-message">{{ text('暂无待办任务', 'No pending tasks') }}</p></div>
            <footer>{{ text('点击任务查看对应履约订单清单。', 'Select a task to view its fulfillment orders.') }}</footer>
          </section>
        </div>
      </div>

      <section v-if="visible('department_receipts')" class="dashboard-panel receipts-panel">
        <div class="panel-top receipts-heading statistics-heading"><div><h2><Wallet :size="17" />{{ text('部门月度回款分析', 'Monthly collections by department') }}</h2></div><div class="statistics-filters"><label class="year-filter">{{ text('年份', 'Year') }}<select v-model.number="year" :aria-label="text('回款年份', 'Collections year')" :disabled="busy" @change="refresh"><option v-for="item in years" :key="item" :value="item">{{ item }}</option></select></label><label class="mom-filter"><input v-model="departmentMom" type="checkbox" aria-label="部门回款上月环比">{{ text('上月环比', 'Month-over-month') }}</label></div></div>
        <div v-if="departmentMom" class="receipt-summary mom-summary"><span>{{ latestReceiptMonth }} · {{ text('营销中心较上月', 'Marketing center change') }}</span><ReceiptChangeValue :value="latestMarketingChange" /><small>{{ momHint }}</small></div>
        <div v-else class="receipt-summary"><span>{{ appliedYear }} {{ text('年部门回款合计', 'department collections total') }}</span><strong>{{ data?.departmentReceipts.departments.length ? money(receiptTotal) : '—' }}</strong><small>{{ marketingBreakdown }}{{ marketingBreakdown ? ' · ' : '' }}{{ text('默认展示最近 6 个月，可向左拖动查看历史；全年合计不重复累加。', 'Latest 6 months shown; drag left for earlier months. Annual totals are counted once.') }}</small></div>
        <div class="receipts-chart"><p v-if="!data?.departmentReceipts.departments.length" class="empty-message">{{ text('暂无可查看的回款统计', 'No collections statistics available') }}</p><EChart v-else :option="receiptOption" :can-export="chart('department_receipts')?.canExport === true" :label="text('各部门月度回款对比柱状图', 'Monthly collections by department')" /></div>
        <details :open="departmentDetailsOpen" class="data-details" @toggle="departmentDetailsOpen = ($event.target as HTMLDetailsElement).open"><summary>{{ departmentMom ? text('部门环比明细 · 差额 / 比例', 'Department changes · Amount / Rate') : text('查看回款明细数据', 'View collections data') }}</summary><div class="table-scroll"><table class="receipt-table" :style="{ minWidth: `${160 + receiptSeries.length * 132}px` }"><colgroup><col class="receipt-month-column"><col v-for="item in receiptSeries" :key="item.id"></colgroup><thead><tr><th>{{ text('月份', 'Month') }}</th><th v-for="dept in receiptSeries" :key="dept.id" :class="{ 'aggregate-cell': dept.id === data?.departmentReceipts.marketingCenter?.id }">{{ dept.name || departments[dept.id] || dept.id }}</th></tr></thead><tbody><tr v-for="{ month, index } in receiptRows" :key="month"><td>{{ month }}</td><td v-for="dept in receiptSeries" :key="dept.id" :class="{ 'aggregate-cell': dept.id === data?.departmentReceipts.marketingCenter?.id }"><ReceiptChangeValue v-if="departmentMom" :value="changesFor(dept)[index]" /><span v-else class="receipt-amount" :title="receiptBreakdown(dept, index)">{{ money(dept.amounts[index] ?? 0) }}</span></td></tr></tbody><TableTotals><th scope="row">{{ departmentMom ? text('差额合计（可比月份）', 'Total change (comparable months)') : text('合计（所选年份）', 'Total (selected year)') }}</th><td v-for="dept in receiptSeries" :key="dept.id"><ReceiptChangeValue v-if="departmentMom" :value="changeTotalFor(dept)" /><span v-else class="receipt-amount">{{ money(sumMoney(dept.amounts)) }}</span></td></TableTotals></table></div></details><p class="mom-note" :class="{ 'mom-note-hidden': !departmentMom }" :aria-hidden="!departmentMom">{{ text('合计比例 = 差额合计 ÷ 对应上月金额合计；缺少上月数据的月份不计入合计。上月为 0 时，非零差额不计算比例。', 'Total rate = total change ÷ total prior-month amounts; missing comparisons are excluded. Nonzero changes from zero have no percentage rate.') }}</p>
      </section>
      <section v-if="visible('salesperson_receipts')" class="dashboard-panel receipts-panel salesperson-panel">
        <div class="panel-top receipts-heading statistics-heading">
          <div><h2><Users :size="17" />{{ text('业务员月度回款分析', 'Monthly collections by salesperson') }}</h2></div>
          <div class="statistics-filters"><label v-if="!visible('department_receipts')" class="year-filter">{{ text('年份', 'Year') }}<select v-model.number="year" aria-label="回款年份" :disabled="busy" @change="refresh"><option v-for="item in years" :key="item" :value="item">{{ item }}</option></select></label><label class="year-filter">{{ text('部门', 'Department') }}<select v-model="selectedDepartmentId" :disabled="busy || !data?.receipts.departments.length" :aria-label="text('业务员回款部门', 'Salesperson collections department')"><option v-for="department in data?.receipts.departments" :key="department.id" :value="department.id">{{ department.name || departments[department.id] || department.id }}</option></select></label><label class="mom-filter"><input v-model="salespersonMom" type="checkbox" aria-label="业务员回款上月环比">{{ text('上月环比', 'Month-over-month') }}</label></div>
        </div>
        <div v-if="salespersonMom" class="receipt-summary mom-summary"><span>{{ latestReceiptMonth }} · {{ selectedDepartment?.name }} · {{ text('较上月', 'Change from prior month') }}</span><ReceiptChangeValue :value="latestDepartmentChange" /><small>{{ momHint }}</small></div>
        <div v-else class="receipt-summary"><span>{{ selectedDepartment?.name || text('所选部门', 'Selected department') }} · {{ text('所选年份回款合计', 'selected year total') }}</span><strong>{{ selectedDepartment ? money(selectedDepartmentTotal) : '—' }}</strong><small>{{ receiptBreakdown(selectedDepartment) }}{{ selectedDepartment?.breakdown ? ' · ' : '' }}{{ text('蓝紫色为当前成员合计，不与个人数据重复累加；年份与上方同步。', 'Periwinkle indicates the current members total, counted once; year follows the chart above.') }}</small></div>
        <div class="receipts-chart"><EChart v-if="salespersonSeries.length" :option="salespersonOption" :can-export="chart('salesperson_receipts')?.canExport === true" :label="text('业务员月度回款对比柱状图', 'Monthly collections comparison by salesperson')" @select="event => selectReceipt(event, true)" /><p v-else class="empty-message">{{ selectedDepartment ? text('该部门在所选年份暂无业务员回款数据', 'No salesperson collections for this department and year') : text('暂无可查看的业务员回款统计', 'No salesperson collections statistics available') }}</p></div>
        <p v-if="selectedDepartment && !salespeople.length" class="detail-empty-note">{{ text('该部门在所选年份暂无业务员回款数据', 'No salesperson collections for this department and year') }}</p>
        <details v-if="salespersonSeries.length" :open="salespersonDetailsOpen" class="data-details" @toggle="salespersonDetailsOpen = ($event.target as HTMLDetailsElement).open"><summary>{{ salespersonMom ? text('部门与业务员环比明细 · 差额 / 比例', 'Department and salesperson changes · Amount / Rate') : text('部门与业务员回款明细', 'Department and salesperson collections data') }}</summary><div class="table-scroll"><table class="receipt-table" :style="{ minWidth: `${160 + salespersonSeries.length * 132}px` }"><colgroup><col class="receipt-month-column"><col v-for="item in salespersonSeries" :key="item.id"></colgroup><thead><tr><th>{{ text('月份', 'Month') }}</th><th v-for="(person, personIndex) in salespersonSeries" :key="person.id" :class="{ 'aggregate-cell': personIndex === 0 }">{{ person.name }}</th></tr></thead><tbody><tr v-for="{ month, index } in salespersonReceiptRows" :key="month"><td>{{ month }}</td><td v-for="(person, personIndex) in salespersonSeries" :key="person.id" :class="{ 'aggregate-cell': personIndex === 0 }"><ReceiptChangeValue v-if="salespersonMom" :value="changesFor(person)[index]" /><button v-else :disabled="!canDetails('salesperson_receipts')" class="receipt-amount receipt-link" :title="receiptBreakdown(person, index)" @click="openReceipts(month, selectedDepartmentId, personIndex === 0 ? undefined : person.id)">{{ money(person.amounts[index] ?? 0) }}</button></td></tr></tbody><TableTotals><th scope="row">{{ salespersonMom ? text('差额合计（可比月份）', 'Total change (comparable months)') : text('合计（所选年份）', 'Total (selected year)') }}</th><td v-for="person in salespersonSeries" :key="person.id"><ReceiptChangeValue v-if="salespersonMom" :value="changeTotalFor(person)" /><span v-else class="receipt-amount">{{ money(sumMoney(person.amounts)) }}</span></td></TableTotals></table></div></details><p class="mom-note" :class="{ 'mom-note-hidden': !salespersonMom }" :aria-hidden="!salespersonMom">{{ text('合计比例 = 差额合计 ÷ 对应上月金额合计；缺少上月数据的月份不计入合计。上月为 0 时，非零差额不计算比例。', 'Total rate = total change ÷ total prior-month amounts; missing comparisons are excluded. Nonzero changes from zero have no percentage rate.') }}</p>
      </section>
      <OrderVolumeAnalysis v-if="visible('order_volume')" :revision="orderVolumeRevision" />
      <OrderVolumeAnalysis v-if="visible('customer_orders')" customer :revision="orderVolumeRevision" />
      <FreightAnalysis v-if="visible('freight')" :revision="orderVolumeRevision" />
      <p v-if="data?.source === 'mock'" class="dashboard-footnote">{{ text('MOCK 演示数据 · 组织、员工与订单相互关联 · 日期筛选用于注册趋势，年份筛选用于回款分析。', 'MOCK demo data · Linked organization, employees and orders · Dates filter registrations; year filters collections.') }}</p>
      <p v-else class="dashboard-footnote">{{ text('日期筛选用于注册趋势，年份筛选用于回款分析。', 'Dates filter registrations; year filters collections.') }}</p>
    </main>
  </AppLayout>
</template>

<style scoped>
.receipt-link { cursor: pointer; text-decoration: underline; text-underline-offset: 3px; color: inherit; }
.receipt-link:hover { color: #5873d4; }
.mom-filter{display:flex;align-items:center;gap:7px;font-size:11px;color:#7b89a0;white-space:nowrap;cursor:pointer}.mom-filter input{width:14px;height:14px;accent-color:#94a5dd}.mom-summary :deep(.receipt-change){flex-direction:row;align-items:center;gap:10px}.mom-summary :deep(.change-amount){font-size:23px;font-weight:700}.mom-summary :deep(.change-percent){font-size:11px}.mom-summary small{max-width:550px;line-height:1.7}.mom-note{padding:0 20px 14px;font-size:10px;color:#8793a7;line-height:1.7}

.registration-list-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
.registration-list-heading h3 { font-size: 12px; font-weight: 600; color: var(--color-text); }
.aggregate-cell { color: var(--aggregate-text); background: var(--aggregate-surface); font-weight: 650; }
.aggregate-cell > td:first-child, th.aggregate-cell { box-shadow: inset 3px 0 0 var(--aggregate-color); }
.chart-summary strong, .receipt-summary strong { color: var(--aggregate-text); font-variant-numeric: tabular-nums; }
.chart-summary strong::before, .receipt-summary strong::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 9px; border-radius: 50%; background: var(--aggregate-color); vertical-align: middle; }
.detail-empty-note { padding: 0 20px 14px; font-size: 11px; color: var(--color-text-muted, #8290a5); }
.statistics-heading { flex-wrap: wrap; }
.statistics-heading h2 { flex-shrink: 0; }
.statistics-filters { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 10px; margin-left: auto; }
.fop-dashboard { --aggregate-color: v-bind(aggregateColor); --aggregate-text: var(--color-summary-text); --aggregate-surface: var(--color-summary-surface); color: var(--color-text, #243247); }
.dashboard-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 24px; }
.eyebrow { color: #687995; font-size: 10px; font-weight: 700; letter-spacing: .16em; margin-bottom: 6px; }
h1 { display: flex; align-items: center; gap: 12px; font-size: 28px; font-weight: 750; letter-spacing: -.035em; }
.mock-badge { border: 1px solid #f4d59a; color: #ae7616; background: #fff8e8; border-radius: 5px; padding: 3px 7px; font-size: 10px; letter-spacing: .06em; font-weight: 700; }
.heading-description { color: #8490a3; font-size: 12px; margin-top: 5px; line-height: 1.6; }
.refresh-button, .query-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 6px; padding: 9px 13px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.refresh-button { background: var(--color-surface); border: 1px solid var(--color-border); }
button:disabled { opacity: .5; cursor: wait; }
.summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin-bottom: 22px; }.work-calendar-card { grid-column: 1 / -1; }
.summary-card:hover { transform: translateY(-2px); filter: brightness(1.04); }
.exception-row:hover, .task-row:hover { background: #5873d408; }
.summary-card { display: block; transition: transform .15s, filter .15s; position: relative; overflow: hidden; padding: 19px 18px; border-radius: 8px; color: white; box-shadow: 0 5px 13px #30446010; }
.review { background: linear-gradient(115deg, #099fdd, #32b7df); }.allocation { background: linear-gradient(115deg, #19b8c8, #70cbd5); }.fulfillment { background: linear-gradient(115deg, #37ac47, #36cd58); }.procurement { background: linear-gradient(115deg, #7c82d3, #a29bdf); }.shipping { background: linear-gradient(115deg, #f0a535, #dfce56); }
.card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; }.card-top svg { opacity: .85; }
.summary-card strong { display: block; font-size: 33px; line-height: 1.2; margin: 10px 0 5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.summary-card p { font-size: 11px; line-height: 1.65; min-height: 36px; opacity: .95; }.card-decoration { position: absolute; width: 100px; height: 100px; border: 18px solid #ffffff12; border-radius: 50%; right: -29px; bottom: -40px; }

.insights-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; align-items: stretch; }.dashboard-panel { min-width: 0; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; box-shadow: 0 2px 6px #27395004; overflow: hidden; }.panel-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 19px 20px; border-bottom: 1px solid var(--color-border); }.panel-top h2 { display: flex; align-items: center; gap: 8px; color: #576bd3; font-size: 13px; font-weight: 650; }.subtle-label { font-size: 9px; color: #97a1b1; letter-spacing: .04em; }.date-filter { display: flex; align-items: end; gap: 8px; padding: 18px 20px 0; flex-wrap: wrap; }.date-filter label > span { display: block; font-size: 10px; color: #8a95a7; margin-bottom: 5px; }.date-filter input, .year-filter select { color: inherit; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 5px; padding: 7px 9px; font-size: 11px; }.date-dash { padding-bottom: 7px; color: #b7c0ce; }.query-button { color: #fff; background: #5873d4; padding: 8px 16px; }.chart-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; padding: 20px 22px 0; }.chart-summary strong { font-size: 28px; font-weight: 700; letter-spacing: -.04em; }.chart-summary span { font-size: 11px; color: #8490a3; }.chart-summary small { margin-left: auto; font-size: 10px; color: #9aa4b4; }.registration-chart { height: 285px; padding: 0 10px; }.activity-column { display: grid; gap: 18px; }.activity-list { padding: 0 20px; max-height: 260px; overflow-y: auto; }.exception-row, .task-row { display: flex; align-items: center; gap: 10px; padding: 15px 0; border-bottom: 1px solid var(--color-border); }.exception-row:last-child, .task-row:last-child { border-bottom: 0; }.exception-row > div, .task-row > div { flex: 1; min-width: 0; }.row-heading { font-size: 11px; font-weight: 600; }.row-heading span { display: block; color: #8d98a9; font-weight: 400; font-size: 10px; margin-top: 3px; }.row-description { color: #8b95a6; font-size: 10px; margin-top: 5px; }.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #f2a24c; flex-shrink: 0; }.age-badge { padding: 3px 7px; font-size: 10px; color: #d68b2e; background: #fff7e8; border-radius: 4px; }.count-badge { font-size: 10px; color: #e1a041; background: #fff5e4; border-radius: 4px; padding: 2px 6px; }.dashboard-panel footer { border-top: 1px solid var(--color-border); padding: 10px 20px; font-size: 9px; color: #9aa4b4; }.task-time { color: #8c97a9; font-size: 11px; width: 42px; font-variant-numeric: tabular-nums; }.priority { font-size: 9px; padding: 3px 7px; border-radius: 4px; }.priority.high { color: #e48858; background: #fff2ea; }.priority.normal { color: #7c8caa; background: #eff3fa; }
.receipts-panel { margin-top: 20px; }.receipts-heading > div > p { color: #9aa4b4; font-size: 10px; margin-top: 6px; }.year-filter { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #8d98a9; }.receipt-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; padding: 18px 20px 10px; }.receipt-summary > span { color: #8a95a6; font-size: 11px; }.receipt-summary strong { font-size: 23px; font-weight: 700; letter-spacing: -.03em; }.receipt-summary small { margin-left: auto; font-size: 10px; color: #98a3b3; }.receipts-chart { height: 355px; padding: 10px 15px 0; }.dashboard-footnote { font-size: 10px; color: #98a3b3; margin-top: 16px; line-height: 1.8; }.data-details { padding: 10px 20px; font-size: 10px; color: #8290a5; border-top: 1px solid var(--color-border); }.data-details summary { cursor: pointer; }.table-scroll { max-height: 240px; overflow: auto; margin-top: 8px; }table { width: 100%; border-collapse: collapse; white-space: nowrap; }th, td { padding: 8px; text-align: right; border-bottom: 1px solid var(--color-border); }th:first-child, td:first-child { text-align: left; }.error-message { color: #dc2626; padding: 12px; background: #fef2f2; border-radius: 6px; margin-bottom: 16px; font-size: 12px; }.empty-message { padding: 30px; text-align: center; color: #8a95a6; font-size: 12px; }
.dark .mock-badge { background: #382b17; border-color: #60491f; color: #f5c76c; }.dark .age-badge, .dark .count-badge, .dark .priority.high { background: #352b22; }.dark .priority.normal { background: #263145; }
@media (max-width: 1280px) { .summary-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }.work-calendar-card { grid-column: 1 / -1; }.subtle-label { display: none; } }
@media (max-width: 1024px) { .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.insights-grid { grid-template-columns: 1fr; }.activity-column { grid-template-columns: repeat(2, minmax(0, 1fr)); }.summary-card:hover { transform: translateY(-2px); filter: brightness(1.04); }
.exception-row:hover, .task-row:hover { background: #5873d408; }
.summary-card { display: block; transition: transform .15s, filter .15s; padding: 17px; }.card-top { font-size: 12px; } }
@media (max-width: 640px) { .dashboard-heading { align-items: flex-start; gap: 12px; }h1 { font-size: 24px; }.heading-description { max-width: 240px; }.summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.activity-column { grid-template-columns: 1fr; }.panel-top { padding: 16px; }.date-filter { padding: 14px 14px 0; gap: 5px; }.date-filter input { padding: 7px 4px; max-width: 128px; }.query-button { padding: 8px; }.chart-summary small { width: 100%; margin: 0; }.receipt-summary small { width: 100%; margin: 0; }.receipts-chart { padding: 0; height: 355px; }.registration-chart { padding: 0; }.refresh-button { padding: 9px; }.receipts-heading { align-items: flex-start; } }

/* Amount and MoM views share one layout; only their values change. */
.receipts-panel .receipt-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: 35px 34px;
  align-items: center;
  gap: 8px 12px;
}
.receipts-panel .receipt-summary > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.receipts-panel .receipt-summary small { grid-column: 1 / -1; width: 100%; margin: 0; max-width: none; line-height: 17px; }
.receipts-panel .receipt-summary :deep(.receipt-change) { justify-self: end; }
.receipts-panel .table-scroll { scrollbar-gutter: stable; }
.receipt-table { table-layout: fixed; font-variant-numeric: tabular-nums; }
.receipt-month-column { width: 160px; }
.receipt-table th, .receipt-table td { overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
.receipt-table thead tr { height: 36px; }
.receipt-table tbody tr, .receipt-table :deep(tfoot tr) { height: 56px; }
.receipt-table .receipt-amount, .receipt-table :deep(.receipt-change) { height: 36px; line-height: 15px; vertical-align: middle; }
.receipt-table .receipt-amount { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.receipt-table :deep(.receipt-change) { max-width: 100%; }
.receipt-table :deep(.change-amount), .receipt-table :deep(.change-percent) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mom-note-hidden { visibility: hidden; }
@media (max-width: 640px) {
  .receipts-panel .receipt-summary { grid-template-columns: minmax(0, 1fr); grid-template-rows: 20px 35px 68px; }
  .receipts-panel .receipt-summary :deep(.receipt-change) { justify-self: start; }
}

/* Keep dark rules scoped to their component; :global(.dark) alone drops the child selector. */
.dark .dashboard-panel { box-shadow: 0 8px 24px #00000014; }
.dark .panel-top { background: var(--color-surface-muted); }
.dark .panel-top h2 { color: var(--color-chart-heading); }
.dark .dashboard-panel footer a { color: var(--color-chart-link); }
.dark .data-details, .dark .year-filter, .dark .mom-filter, .dark .chart-summary span, .dark .receipt-summary > span, .dark .receipt-summary small, .dark .row-description, .dark .row-heading span, .dark .task-time, .dark .date-filter label > span { color: var(--color-chart-muted); }
.dark .chart-summary small, .dark .receipts-heading > div > p, .dark .dashboard-panel footer, .dark .mom-note { color: #94a6bf; }
.dark .data-details th { color: #bac9de; }
.dark .aggregate-cell { color: var(--color-summary-text); }
.dark .summary-card { border: 1px solid #ffffff14; box-shadow: 0 6px 20px #0000001a; }
.dark .review { background: linear-gradient(115deg, #1a4b6d, #226487); }
.dark .fulfillment { background: linear-gradient(115deg, #24584a, #2d7159); }
.dark .procurement { background: linear-gradient(115deg, #44446e, #5d588c); }
.dark .allocation { background: linear-gradient(115deg, #1b545b, #28757c); }
.dark .shipping { background: linear-gradient(115deg, #725332, #8b713d); }
.dark .age-badge, .dark .count-badge { color: #edc78a; background: #3c3223; }
.dark .priority.high { color: #eeb18d; background: #3c2e28; }
.dark .priority.normal { color: #b3c3dd; background: #26344b; }
.dark .error-message { color: #f0a4b2; background: #3b2530; }
</style>

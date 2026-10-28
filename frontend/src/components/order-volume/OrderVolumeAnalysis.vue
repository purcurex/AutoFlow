<script setup lang="ts">
import type { EffectiveChartAccess } from '@/api/fop-chart-access'
import { useChartAccess } from '@/composables/useChartAccess'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { BarChart3, Search, UsersRound } from 'lucide-vue-next'
import { getOrderVolume, searchOrderCustomers, type OrderVolumeData, type OrderVolumeQuery, type VolumeCategory, type VolumeGrain, type VolumeWarehouse, type OrderCustomer, type OrderCustomerPage } from '@/api/fop-order-volume'
import { fopAccessError } from '@/api/fop-access'
import { onSessionReset } from '@/utils/session'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { isWorkbenchRole } from '@/utils/workbench'
import OrderVolumeResults from './OrderVolumeResults.vue'
import CustomerTrendDialog from './CustomerTrendDialog.vue'
import CustomerOrderResults from './CustomerOrderResults.vue'
import './order-volume.css'
const props = withDefaults(defineProps<{ customer?: boolean; revision?: number }>(), { customer: false, revision: 0 })
const { access: chartAccess, refresh: refreshChartAccess, applyResponse: applyChartResponse, clear: clearChartAccess, visible: chartVisible, canViewDetails } = useChartAccess(() => props.customer ? 'customer_orders' : 'order_volume')
const { locale } = useI18n(), router = useRouter(), route = useRoute()
const zh = computed(() => String(locale.value).startsWith('zh'))
const t = (cn: string, en: string) => zh.value ? cn : en
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const currentYear = Number(today.slice(0, 4))
const years = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i)
const category = ref<VolumeCategory>(props.customer ? 'customer' : 'organization')
const grain = ref<VolumeGrain>('month'), year = ref(currentYear), month = ref(Number(today.slice(5, 7))), weekOf = ref(today)
const from = ref(`${currentYear}-01-01`), to = ref(today)
const appliedRange = ref({ from: from.value, to: to.value }), dateError = ref('')
const department = ref(''), objectId = ref(''), warehouse = ref<'ALL' | VolumeWarehouse>('ALL'), split = ref(false)
const data = ref<OrderVolumeData>(), selectedData = ref<OrderVolumeData>(), busy = ref(false), selectedBusy = ref(false), error = ref(''), selectedError = ref('')
const keyword = ref(''), customers = ref<OrderCustomerPage>(), customerBusy = ref(false), customerError = ref(''), selected = ref<OrderCustomer>()
// Clear selector metadata before each authorization refresh to avoid retaining an old scope.
const options = ref<OrderVolumeData['options']>({ departments: [], objects: [] })
const trendScope = computed(() => [
  `${appliedRange.value.from} — ${appliedRange.value.to}`,
  options.value.departments.find(d => d.id === department.value)?.label ?? t('营销中心', 'Marketing center'),
  warehouse.value === 'HZ' ? t('杭州仓', 'Hangzhou') : warehouse.value === 'SZ' ? t('深圳仓', 'Shenzhen') : warehouse.value === 'UNASSIGNED' ? t('未分配仓库', 'Unassigned') : t('全部仓库', 'All warehouses'),
  ...(split.value && warehouse.value === 'ALL' ? [t('分仓对比', 'Compare warehouses')] : []),
].join(' · '))
const query = computed<OrderVolumeQuery>(() => ({ category: category.value,
  ...(props.customer ? appliedRange.value : { grain: grain.value, year: year.value,
    ...(grain.value === 'day' ? { month: month.value } : {}), ...(grain.value === 'week' ? { weekOf: weekOf.value } : {}) }),
  ...(department.value ? { department: department.value } : {}), ...(objectId.value ? { objectId: objectId.value } : {}), warehouse: warehouse.value,
}))
let requestId = 0, customerRequestId = 0, selectedRequestId = 0
function applyFilters() {
  dateError.value = ''
  if (props.customer) {
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
    if (!validDate(from.value) || !validDate(to.value) || from.value < '2020-01-01' || from.value > to.value || to.value > today) {
      dateError.value = t('请选择有效的开始和结束日期，结束日期不能早于开始日期或晚于今天。', 'Choose valid start and end dates, in order and no later than today.'); return
    }
    if (from.value !== appliedRange.value.from || to.value !== appliedRange.value.to) {
      appliedRange.value = { from: from.value, to: to.value }; return
    }
  }
  void load(); void loadSelected()
}
async function load() {
  const id = ++requestId
  data.value = undefined; options.value = { departments: [], objects: [] }; error.value = ''; busy.value = true
  customerRequestId++; customers.value = undefined; clearSelected()
  try {
    const capability = await refreshChartAccess()
    if (id !== requestId || !capability?.visible) return
    const result = await getOrderVolume({ ...query.value, ...(category.value === 'organization' && capability.summaryDepartments.length ? { view: 'summary' } : {}) })
    if (id !== requestId) return
    if (!applyChartResponse(result)) return
    data.value = result; options.value = result.options
  } catch (cause) { if (id === requestId) { reset(); error.value = fopAccessError(cause, zh.value) } }
  finally { if (id === requestId) busy.value = false }
}
function acceptRelatedResponse(result: { chartAccess?: EffectiveChartAccess }) {
  if (JSON.stringify(chartAccess.value) !== JSON.stringify(result.chartAccess)) {
    reset()
    if (applyChartResponse(result)) void load()
    return false
  }
  return applyChartResponse(result)
}
async function loadSelected() {
  const id = ++selectedRequestId
  selectedData.value = undefined; selectedError.value = ''; selectedBusy.value = false
  if (!selected.value || !chartVisible.value || chartAccess.value?.summaryOnly) return
  selectedBusy.value = true
  try {
    const result = await getOrderVolume({ ...query.value, customerId: selected.value.id })
    if (id === selectedRequestId && acceptRelatedResponse(result)) selectedData.value = result
  } catch (cause) { if (id === selectedRequestId) { reset(); error.value = fopAccessError(cause, zh.value) } }
  finally { if (id === selectedRequestId) selectedBusy.value = false }
}
function clearSelected() { selectedRequestId++; selected.value = undefined; selectedData.value = undefined; selectedError.value = ''; selectedBusy.value = false }
watch(category, () => { objectId.value = ''; department.value = '' })
watch(department, () => { objectId.value = ''; customerRequestId++; customers.value = undefined; customerBusy.value = false; customerError.value = ''; clearSelected() })
watch([query, () => props.revision], () => { void load(); void loadSelected() }, { immediate: true })
watch(keyword, () => { customerRequestId++; customers.value = undefined; customerError.value = ''; customerBusy.value = false; clearSelected() })
watch(() => route.fullPath, clearSelected)
async function search(page = 1) {
  if (!chartVisible.value || chartAccess.value?.summaryOnly) return
  const value = keyword.value.trim()
  if (!value) { customerError.value = t('请输入客户名称或编码。', 'Enter a customer name or code.'); return }
  const id = ++customerRequestId
  clearSelected(); customerBusy.value = true; customerError.value = ''; customers.value = undefined
  try {
    const result = await searchOrderCustomers({ keyword: value, department: department.value || undefined, page, pageSize: 10 })
    if (id !== customerRequestId) return
    if (!acceptRelatedResponse(result)) return
    customers.value = result
    const exact = result.items.filter(c => c.code.toLowerCase() === value.toLowerCase())
    if (exact.length === 1 && result.total === 1) chooseCustomer(exact[0]!)
  } catch (cause) { if (id === customerRequestId) { reset(); error.value = fopAccessError(cause, zh.value) } }
  finally { if (id === customerRequestId) customerBusy.value = false }
}
function chooseCustomer(customer: OrderCustomer) { if (!chartVisible.value || chartAccess.value?.summaryOnly) return; customerRequestId++; customerBusy.value = false; selected.value = customer; void loadSelected() }
function selectRank(id: string, name: string, code: string) { chooseCustomer({ id, name, code, departments: [] }) }
async function drill(result: OrderVolumeData, seriesId: string, periodId?: string, detailWarehouse?: VolumeWarehouse, receipts = false) {
  if (!canViewDetails.value || (result.query.category === 'organization' && result.query.view === 'summary')) return
  const id = requestId, path = route.fullPath
  try {
    let role = isWorkbenchRole(route.params.role) ? route.params.role : undefined
    if (!role) {
      const access = await refreshWorkbenchAccess()
      if (id !== requestId || route.fullPath !== path) return
      role = access.roles[0]
    }
    if (!role) { reset(); error.value = t('暂无可访问的岗位工作台，请联系管理员。', 'No workbench is available.'); return }
    await router.push({ name: receipts ? 'RoleWorkbenchReceipts' : 'RoleWorkbench', params: { role }, query: { ...result.query, ...(receipts ? { mode: 'customer' } : { queue: 'order-volume' }), seriesId, ...(periodId ? { periodId } : {}), ...(detailWarehouse ? { detailWarehouse } : {}) } })
  } catch (cause) { if (id === requestId) { reset(); error.value = fopAccessError(cause, zh.value) } }
}
function reset() { clearChartAccess(); requestId++; customerRequestId++; data.value = undefined; customers.value = undefined; options.value = { departments: [], objects: [] }; busy.value = false; customerBusy.value = false; error.value = ''; clearSelected() }
const off = onSessionReset(reset)
onBeforeUnmount(() => { off(); reset() })
</script>

<template>
  <section v-if="chartVisible" class="ov-panel" :data-module="customer ? 'customer-volume' : 'order-volume'">
    <header class="ov-header"><div class="ov-heading"><h2><component :is="customer ? UsersRound : BarChart3" :size="18" />{{ customer ? t('客户订单分析', 'Customer fulfillment and collections') : t('业务订单量分析', 'Business order analysis') }}<span v-if="data?.source === 'mock'" class="ov-badge">MOCK</span></h2></div>
      <form class="ov-filters" @submit.prevent="applyFilters">
        <label v-if="!customer && grain !== 'week'">{{ t('年份', 'Year') }}<select v-model.number="year" aria-label="订单量年份"><option v-for="y in years" :key="y">{{ y }}</option></select></label>
        <label v-if="!customer">{{ t('查询类别', 'Category') }}<select v-model="category" aria-label="订单量查询类别"><option v-if="chartAccess?.dataScope !== 'none'" value="carrier">{{ t('物流服务商', 'Carrier') }}</option><option value="organization">{{ t('组织', 'Organization') }}</option><option v-if="chartAccess?.dataScope !== 'none'" value="salesperson">{{ t('业务员', 'Salesperson') }}</option></select></label>
        <label v-if="customer">{{ t('开始日期', 'Start date') }}<input v-model="from" type="date" min="2020-01-01" :max="to || today" required aria-label="客户订单开始日期"></label>
        <label v-if="customer">{{ t('结束日期', 'End date') }}<input v-model="to" type="date" :min="from || '2020-01-01'" :max="today" required aria-label="客户订单结束日期"></label>
        <label v-if="category !== 'carrier'">{{ t('统计部门', 'Department') }}<select v-model="department" :aria-label="customer ? '客户订单部门' : '订单量统计部门'"><option value="">{{ t('营销中心', 'Marketing center') }}</option><option v-for="d in options.departments" :key="d.id" :value="d.id">{{ d.label }}</option></select></label>
        <label v-if="category === 'carrier' || category === 'salesperson'">{{ t('明细对象', 'Object') }}<select v-model="objectId" aria-label="订单量明细对象"><option value="">{{ category === 'carrier' ? t('全部服务商', 'All carriers') : t('全部业务员', 'All salespeople') }}</option><option v-for="o in options.objects" :key="o.id" :value="o.id">{{ o.label }}</option></select></label>
        <label v-if="!customer">{{ t('时间轴', 'Timeline') }}<select v-model="grain" aria-label="订单量时间轴"><option value="month">{{ t('按月', 'Monthly') }}</option><option value="week">{{ t('按周', 'Weekly') }}</option><option value="day">{{ t('按天', 'Daily') }}</option></select></label>
        <label v-if="!customer && grain === 'day'">{{ t('月份', 'Month') }}<select v-model.number="month" aria-label="订单量月份"><option v-for="m in 12" :key="m" :value="m">{{ m }}{{ t('月', '') }}</option></select></label>
        <label v-if="!customer && grain === 'week'">{{ t('截至所在周', 'Week of') }}<input v-model="weekOf" type="date" min="2020-01-01" :max="today" aria-label="订单量周日期"></label>
        <label>{{ t('仓库', 'Warehouse') }}<select v-model="warehouse" aria-label="订单量仓库"><option value="ALL">{{ t('全部仓库', 'All warehouses') }}</option><option value="HZ">{{ t('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ t('深圳仓', 'Shenzhen') }}</option></select></label>
        <label class="ov-checkbox"><input v-model="split" type="checkbox" :disabled="warehouse !== 'ALL'" :aria-label="customer ? '客户订单分仓对比' : '业务订单分仓对比'">{{ t('分仓对比', 'Compare warehouses') }}</label>
        <button type="submit" :class="customer ? 'ov-primary' : 'ov-secondary workbench-refresh'" :disabled="busy">{{ customer ? t('查询', 'Apply') : t('刷新', 'Refresh') }}</button>
      </form>
    </header>
    <div class="ov-body">
      <p v-if="customer && data?.customerOwnershipBasis && data.customerOwnershipBasis !== 'current_assignment'" class="ov-scope">{{ data.customerOwnershipBasis === 'historical_attribution' ? t('历史业务归属口径，当前客户分配待对接', 'Historical attribution; current customer assignment is pending integration') : t('部分客户当前归属待对接', 'Current assignment is pending integration for some customers') }}</p>
      <p v-if="dateError" class="ov-error" role="alert">{{ dateError }}</p>

      <div v-if="busy" class="ov-empty" role="status">{{ t('正在统计订单数据…', 'Loading order statistics…') }}</div>
      <div v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></div>
      <component :is="customer ? CustomerOrderResults : OrderVolumeResults" v-else-if="data" :data="data" :split="split && warehouse === 'ALL'" :ranking-only="customer" :details-allowed="canViewDetails && data.query.view !== 'summary'" @drill="(s, p, w) => drill(data!, s, p, w)" @receipt="(s: string, p?: string, w?: VolumeWarehouse) => drill(data!, s, p, w, true)" @customer="selectRank" />
      <template v-if="customer && !chartAccess?.summaryOnly">
        <div class="ov-customer-search"><div><h3>{{ t('单客户订单与回款趋势', 'Individual customer trend') }}</h3></div><form @submit.prevent="search()"><Search :size="16" /><input v-model="keyword" type="search" maxlength="100" aria-label="客户名称或编码" :placeholder="t('客户名称 / 编码，如 C001', 'Customer name / code, e.g. C001')"><button v-if="keyword || selected" type="button" class="ov-secondary" @click="() => { keyword = ''; clearSelected(); customers = undefined }">{{ t('清空', 'Clear') }}</button><button class="ov-primary" :disabled="customerBusy">{{ t('搜索', 'Search') }}</button></form></div>
        <p v-if="customerBusy" class="ov-empty" role="status">{{ t('正在搜索客户…', 'Searching customers…') }}</p>
        <p v-if="customerError" class="ov-error" role="alert">{{ customerError }}</p>
        <div v-if="customers" class="ov-candidates"><p v-if="!customers.total" class="ov-empty">{{ t('未找到符合条件的客户。', 'No customers match your search.') }}</p><div v-else class="ov-candidate-grid"><button v-for="c in customers.items" :key="c.id" class="ov-candidate" :class="{ selected: c.id === selected?.id }" @click="chooseCustomer(c)"><strong>{{ c.name }}</strong><span>{{ c.code }} · {{ c.departments.join(' / ') }}</span></button></div><div v-if="customers.total > customers.pageSize" class="ov-pagination"><span>{{ customers.total }} {{ t('位客户', 'customers') }}</span><button :disabled="customers.page <= 1" @click="search(customers.page - 1)">{{ t('上一页', 'Previous') }}</button><span>{{ customers.page }} / {{ Math.ceil(customers.total / customers.pageSize) }}</span><button :disabled="customers.page * customers.pageSize >= customers.total" @click="search(customers.page + 1)">{{ t('下一页', 'Next') }}</button></div></div>
        <CustomerTrendDialog v-if="selected" :name="selected.name" :code="selected.code" :scope="trendScope" @close="clearSelected">
          <div v-if="selectedBusy" class="ov-empty" role="status">{{ t('正在加载客户趋势…', 'Loading customer trend…') }}</div>
          <p v-else-if="selectedError" class="ov-error" role="alert">{{ selectedError }}<button class="ov-link" @click="loadSelected">{{ t('重试', 'Retry') }}</button></p>
          <CustomerOrderResults v-else-if="selectedData" :data="selectedData" :split="split && warehouse === 'ALL'" @drill="(s, p, w) => drill(selectedData!, s, p, w)" @receipt="(s, p, w) => drill(selectedData!, s, p, w, true)" />
        </CustomerTrendDialog>
      </template>
    </div>
  </section>
  <p v-else-if="error" class="ov-error" role="alert">{{ error }}<button class="ov-link" @click="load">{{ t('重试', 'Retry') }}</button></p>
</template>

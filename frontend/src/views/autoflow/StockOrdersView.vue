<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ArrowUpDown, PackageSearch, RefreshCw, Search } from 'lucide-vue-next'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import StockProcurementStatus from '@/components/autoflow/StockProcurementStatus.vue'
import WorkbenchStatusBadge from '@/components/autoflow/WorkbenchStatusBadge.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import StockCopy from '@/components/autoflow/StockCopy.vue'
import StockInventoryDialog from '@/components/autoflow/StockInventoryDialog.vue'
import { exportStockOrders, getStockOrders, stockTypes, stockStatuses, stockOrderStatuses, type StockFilters, type StockPage, type StockQuery, type StockSortField } from '@/api/fop-stock'
import { fopAccessError } from '@/api/fop-access'
import { fopExportError } from '@/api/fop-order-export'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'

const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const props = defineProps<{ procurement?: boolean }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const sortBy = computed<StockSortField>(() => scalar('sortBy') === 'purchaseStatus' ? 'purchaseStatus' : scalar('sortBy') === 'orderStatus' && !props.procurement ? 'orderStatus' : 'paidAt')
const filters = computed<StockFilters>(() => ({ queue: props.procurement ? 'procurement' : undefined, search: scalar('search') || undefined, warehouseCode: scalar('warehouseCode') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, stockType: scalar('stockType') as StockFilters['stockType'] || undefined, purchaseStatus: scalar('purchaseStatus') as StockFilters['purchaseStatus'] || undefined, orderStatus: props.procurement ? undefined : scalar('orderStatus') as StockFilters['orderStatus'] || undefined, sortBy: sortBy.value, sortOrder: scalar('sortOrder') === 'desc' ? 'desc' : 'asc' }))
const columnWeights = computed(() => props.procurement ? [14, 25, 8, 8, 10, 9, 8, 9, 5, 9] : [14, 25, 8, 8, 10, 8, 9, 8, 9, 5, 9])
const columnWeightTotal = computed(() => columnWeights.value.reduce((total, width) => total + width, 0))
const query = computed<StockQuery>(() => ({ ...filters.value, page: Math.max(1, Number(scalar('page')) || 1), pageSize: [20, 50, 100].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 50 }))
const currentTime = ref(Date.now())
const search = ref(scalar('search')), result = ref<StockPage>(), loading = ref(false), error = ref(''), selected = ref<string[]>([]), inventoryOpen = ref(false), exporting = ref(false), exportError = ref('')
let request = 0, disposed = false, timer: ReturnType<typeof setInterval> | undefined, exportController: AbortController | undefined
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize)))
const allSelected = computed(() => !!result.value?.items.length && result.value.items.every(r => selected.value.includes(r.id)))
const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'
const money = (amount: number, currency: string) => `${currency === 'USD' ? '$' : currency + ' '}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
async function load() {
  currentTime.value = Date.now()
  const ticket = ++request, session = captureSession()
  loading.value = true; error.value = ''
  try {
    const next = await getStockOrders(query.value)
    if (disposed || ticket !== request || !isCurrentSession(session)) return
    result.value = next
    emit('filter-labels', [...next.departments, ...next.items.map(row => row.owner)])
    selected.value = selected.value.filter(id => next.items.some(r => r.id === id))
  } catch (cause) {
    if (!disposed && ticket === request && isCurrentSession(session)) { result.value = undefined; selected.value = []; error.value = fopAccessError(cause, zh.value); inventoryOpen.value = false }
  } finally { if (ticket === request && isCurrentSession(session)) loading.value = false }
}
function update(values: Record<string, string | number | undefined>) {
  return router.replace({ query: { ...route.query, page: undefined, ...values } })
}
function sort(field: StockSortField) { void update({ sortBy: field, sortOrder: sortBy.value === field && filters.value.sortOrder === 'asc' ? 'desc' : 'asc' }) }
const sortDirection = (field: StockSortField) => sortBy.value === field ? (filters.value.sortOrder === 'desc' ? 'descending' : 'ascending') : 'none'
const sortIcon = (field: StockSortField) => sortBy.value !== field ? ArrowUpDown : filters.value.sortOrder === 'desc' ? ArrowDown : ArrowUp
function choose(event: Event, key: string) { void update({ [key]: (event.target as HTMLSelectElement).value || undefined, ...(key === 'departmentId' ? { ownerId: undefined } : {}) }) }
function submit() { void update({ search: search.value.trim() || undefined }) }
watch(search, value => { if (!value.trim() && filters.value.search) submit() })
watch(query, () => { search.value = scalar('search'); result.value = undefined; selected.value = []; inventoryOpen.value = false; exportController?.abort(); exporting.value = false; exportError.value = ''; void load() }, { immediate: true })
function refreshVisible() { currentTime.value = Date.now(); if (document.visibilityState === 'visible' && navigator.onLine && !loading.value && !inventoryOpen.value) void load() }
function selectAll() { selected.value = allSelected.value ? [] : result.value?.items.map(r => r.id) ?? [] }
async function download(mode: 'selected' | 'filtered') {
  if (exporting.value || loading.value || !result.value?.total || mode === 'selected' && !selected.value.length) return
  const session = captureSession(), controller = new AbortController(); exportController = controller
  exporting.value = true; exportError.value = ''
  try {
    const blob = await exportStockOrders({ ...filters.value, ...(mode === 'selected' ? { mode, orderIds: [...selected.value] } : { mode }) }, controller.signal)
    if (disposed || controller.signal.aborted || !isCurrentSession(session)) return
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = props.procurement ? '备货待采购清单.xlsx' : '备货清单.xlsx'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { if (!disposed && !controller.signal.aborted && isCurrentSession(session)) exportError.value = fopExportError(cause, zh.value) }
  finally { if (exportController === controller) exporting.value = false }
}
const off = onSessionReset(() => { request++; result.value = undefined; selected.value = []; inventoryOpen.value = false; exportController?.abort(); exporting.value = false; loading.value = false; error.value = ''; exportError.value = '' })
onMounted(() => { timer = setInterval(refreshVisible, 30000); document.addEventListener('visibilitychange', refreshVisible); window.addEventListener('focus', refreshVisible); window.addEventListener('online', refreshVisible) })
onBeforeUnmount(() => { disposed = true; request++; off(); clearInterval(timer); exportController?.abort(); document.removeEventListener('visibilitychange', refreshVisible); window.removeEventListener('focus', refreshVisible); window.removeEventListener('online', refreshVisible) })
</script>

<template>
  <section class="stock-page">
    <WorkbenchTaskHeading class="stock-heading" :title="props.procurement ? text('备货待采购清单', 'Stock procurement') : text('备货清单', 'Stock orders')" :description="props.procurement ? text('已审核的备货订单，跟进采购及供应商发货；可查询备货库存，采购处理请在 FOP 完成。', 'Approved stock orders awaiting procurement or supplier shipment. Check stock here; process purchases in FOP.') : text('全款与押金备货订单，包含已完成采购。“已支付”表示尚未审核；客户支付完成后才能审核，审核后即可使用备货库存（在途可用）。', 'Full-payment and deposit stock orders, including completed purchases. Paid means approval is pending. Customer payment is required before approval; approved stock is available, including stock in transit.')"><div class="refresh-group"><button class="workbench-button workbench-refresh" :disabled="loading" @click="load"><RefreshCw :size="14" />{{ text('刷新', 'Refresh') }}</button><small>{{ text('每 30 秒自动刷新', 'Refreshes every 30 seconds') }}<br />{{ result ? date(result.refreshedAt) + ' · UTC+8' : '—' }}</small></div></WorkbenchTaskHeading>
    <div class="stock-panel">
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []">
        <button type="button" class="workbench-button" @click="inventoryOpen = true"><PackageSearch :size="15" />{{ text('查询备货库存', 'Stock inventory') }}</button>
        <template #export><WorkbenchExportButton :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="download" /></template>
      </WorkbenchListActions>
      <form class="stock-filters" @submit.prevent="submit">
        <label>{{ text('备货类型', 'Type') }}<select class="workbench-filter-select" :value="filters.stockType ?? ''" @change="choose($event, 'stockType')"><option value="">{{ text('全部', 'All') }}</option><option v-for="(names, key) in stockTypes" :key="key" :value="key">{{ names[zh ? 0 : 1] }}</option></select></label>
        <label v-if="!props.procurement">{{ text('备货订单状态', 'Stock order status') }}<select class="workbench-filter-select" :value="filters.orderStatus ?? ''" :aria-label="text('备货订单状态', 'Stock order status')" @change="choose($event, 'orderStatus')"><option value="">{{ text('全部', 'All') }}</option><option v-for="(names, key) in stockOrderStatuses" :key="key" :value="key">{{ names[zh ? 0 : 1] }}</option></select></label>
        <label>{{ text('采购状态', 'Purchase status') }}<select class="workbench-filter-select" :value="filters.purchaseStatus ?? ''" @change="choose($event, 'purchaseStatus')"><option value="">{{ text('全部', 'All') }}</option><template v-for="(names, key) in stockStatuses" :key="key"><option v-if="key !== 'unknown' && (!props.procurement || key === 'unpurchased' || key === 'partial' || key === 'purchased')" :value="key">{{ names[zh ? 0 : 1] }}</option></template></select></label>
        <div class="stock-search workbench-search-field"><Search :size="15" /><input v-model="search" type="search" maxlength="200" :aria-label="text('搜索备货订单', 'Search stock orders')" :placeholder="text('业务员 / 备货单 / 客户 / 店铺 / SKU', 'Salesperson / Stock no. / Customer / Store / SKU')" /></div><button class="workbench-button workbench-primary" :disabled="loading">{{ text('查询', 'Search') }}</button><span class="count">{{ text(`共 ${result?.total ?? 0} 笔`, `${result?.total ?? 0} orders`) }}</span>
        <button v-if="filters.ownerId" type="button" class="workbench-button" :aria-label="text('清除业务员筛选', 'Clear salesperson filter')" @click="update({ ownerId: undefined })">{{ result?.items.find(row => row.owner.id === filters.ownerId)?.owner.name || text('已选业务员', 'Selected salesperson') }} ×</button>
        <div class="stock-scope"><label>{{ text('收货仓库', 'Receiving warehouse') }}<select class="workbench-filter-select" :value="filters.warehouseCode ?? ''" @change="choose($event, 'warehouseCode')"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ text('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ text('深圳仓', 'Shenzhen') }}</option></select></label><label>{{ text('业务部门', 'Department') }}<select class="workbench-filter-select" :value="filters.departmentId ?? ''" @change="choose($event, 'departmentId')"><option value="">{{ text('营销中心', 'Marketing Center') }}</option><option v-if="filters.departmentId && !result?.departments.some(d => d.id === filters.departmentId)" :value="filters.departmentId">{{ text('所选部门', 'Selected department') }}</option><option v-for="department in result?.departments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label></div>
      </form>
      <p v-if="error || exportError" class="stock-error" role="alert">{{ error || exportError }}</p>
      <table class="stock-table workbench-task-table" :aria-busy="loading"><colgroup><col v-for="(width, index) in columnWeights" :key="index" :style="{ width: `${width / columnWeightTotal * 100}%` }" /></colgroup><thead><tr><th class="stock-number"><input type="checkbox" :checked="allSelected" :disabled="loading || !result?.items.length" :aria-label="text('全选当前页', 'Select page')" @change="selectAll" />{{ text('备货单号', 'Stock number') }}</th><th>{{ text('商品图片 / 商品信息', 'Products') }}</th><th>{{ text('备货类型', 'Type') }}</th><th>{{ text('订单金额', 'Amount') }}</th><th class="sortable" :aria-sort="sortDirection('paidAt')"><button class="sort" @click="sort('paidAt')">{{ text('收款时间', 'Payment time') }}<component :is="sortIcon('paidAt')" :size="13" /></button></th><th v-if="!props.procurement" class="sortable" :aria-sort="sortDirection('orderStatus')"><button class="sort" @click="sort('orderStatus')">{{ text('备货订单状态', 'Stock order status') }}<component :is="sortIcon('orderStatus')" :size="13" /></button></th><th>{{ text('客户名称', 'Customer') }}</th><th>{{ text('店铺', 'Store') }}</th><th class="sortable" :aria-sort="sortDirection('purchaseStatus')"><button class="sort" @click="sort('purchaseStatus')">{{ text('采购状态', 'Purchase status') }}<component :is="sortIcon('purchaseStatus')" :size="13" /></button></th><th>{{ text('收货仓库', 'Warehouse') }}</th><th>{{ text('业务员', 'Salesperson') }}</th></tr></thead>
        <tbody><tr v-for="order in result?.items" :key="order.id"><td :data-label="text('备货单号', 'Stock number')" class="stock-number"><input v-model="selected" type="checkbox" :value="order.id" :disabled="loading || exporting" :aria-label="text('选择', 'Select') + ' ' + order.stockNumber" /><StockCopy :value="order.stockNumber" /></td><td :data-label="text('商品信息', 'Products')"><div v-for="(item, index) in order.items" :key="index" class="stock-product"><OrderProductImage :src="item.imageUrl" :name="item.name" /><div><p :title="item.name">{{ item.name }}</p><div class="sku"><StockCopy :value="item.sku" /><b>× {{ item.quantity }}</b></div><small>{{ item.variant || '—' }}</small></div></div></td><td :data-label="text('备货类型', 'Type')"><WorkbenchStatusBadge :tone="order.stockType === 'full_payment' ? 'info' : 'neutral'" class="stock-type" :class="order.stockType">{{ stockTypes[order.stockType][zh ? 0 : 1] }}</WorkbenchStatusBadge></td><td :data-label="text('订单金额', 'Amount')" class="numeric">{{ money(order.amount, order.currency) }}</td><td :data-label="text('收款时间', 'Payment time')">{{ date(order.paidAt) }}</td><td v-if="!props.procurement" :data-label="text('备货订单状态', 'Stock order status')"><WorkbenchStatusBadge :tone="order.orderStatus === 'approved' ? 'success' : order.orderStatus === 'paid' ? 'warning' : 'neutral'" class="stock-order-status" :class="order.orderStatus">{{ order.orderStatus ? stockOrderStatuses[order.orderStatus]?.[zh ? 0 : 1] ?? '—' : '—' }}</WorkbenchStatusBadge></td><td :data-label="text('客户名称', 'Customer')"><StockCopy :value="order.customerName" /></td><td :data-label="text('店铺', 'Store')">{{ order.storeName || '—' }}</td><td :data-label="text('采购状态', 'Purchase status')"><StockProcurementStatus class="stock-status" :class="order.purchaseStatus" :status="order.purchaseStatus" :paid-at="order.procurementPaidAt" :now="currentTime" /></td><td :data-label="text('收货仓库', 'Warehouse')">{{ order.warehouse }}</td><td :data-label="text('业务员', 'Salesperson')"><span class="owner-name">{{ order.owner.name }}</span><small class="owner-department">{{ order.department.name }}</small></td></tr></tbody>
      </table>
      <div v-if="!result?.items.length" class="stock-empty">{{ loading ? text('正在加载…', 'Loading…') : error ? text('请刷新重试', 'Refresh to retry') : text('暂无符合条件的备货订单', 'No matching stock orders') }}</div>
      <div v-if="result?.total" class="stock-totals"><strong>{{ text('筛选合计', 'Filtered total') }}</strong><span>{{ result.totals.orderCount }} {{ text('笔', 'orders') }}</span><span v-for="total in result.totals.amounts" :key="total.currency">{{ money(total.amount, total.currency) }}</span></div>
      <footer class="stock-pagination"><label>{{ text('每页', 'Per page') }}<select class="workbench-filter-select" :value="query.pageSize" @change="choose($event, 'pageSize')"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option></select></label><button class="workbench-button" :disabled="query.page <= 1 || loading" @click="update({ page: query.page - 1 })">{{ text('上一页', 'Previous') }}</button><span>{{ query.page }} / {{ pages }}</span><button class="workbench-button" :disabled="query.page >= pages || loading" @click="update({ page: query.page + 1 })">{{ text('下一页', 'Next') }}</button></footer>
    </div>
    <StockInventoryDialog v-if="inventoryOpen" :department-id="filters.departmentId" :owner-id="filters.ownerId" :warehouse-code="filters.warehouseCode" @close="inventoryOpen = false" />
  </section>
</template>

<style scoped>


.stock-page{min-width:0;color:var(--color-text)}.refresh-group,.stock-filters,.stock-scope,.stock-pagination{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mock-badge{font-size:10px;letter-spacing:.1em;padding:3px 7px;border:1px solid #b3904938;border-radius:4px;background:#c9a4591c;color:#b4955d}.refresh-group small{font-size:11px;line-height:1.8;color:var(--color-text-secondary)}.stock-panel{container:stock / inline-size;border:1px solid var(--color-border);background:var(--color-surface);border-radius:9px;overflow:clip}.count{font-size:12px;color:var(--color-text-secondary)}.stock-filters{padding:18px 20px;border-bottom:1px solid var(--color-border);gap:16px 12px}.stock-filters label,.stock-pagination label{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--color-text-secondary)}.stock-filters select{width:150px;min-width:92px;max-width:160px}.stock-scope{margin-left:auto}.stock-search{flex:0 1 290px;max-width:320px}.stock-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.stock-table th,.stock-table td{padding:12px 8px;text-align:left;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere}.stock-table th{padding:14px 8px}.stock-table input[type=checkbox]{width:15px;height:15px;accent-color:#687fba;margin-right:10px;vertical-align:middle}.stock-table .stock-number{white-space:nowrap;text-align:center;padding-inline:16px}.stock-number :deep(.stock-copy){max-width:calc(100% - 24px);color:var(--color-chart-link);font-weight:600;font-variant-numeric:tabular-nums}.stock-number :deep(.stock-copy>span){white-space:nowrap;overflow-wrap:normal}.stock-table tbody tr:hover{background:color-mix(in srgb,var(--color-text) 3%,transparent)}.stock-product{display:flex;align-items:center;gap:9px;min-width:0}.stock-product+.stock-product{margin-top:12px}.stock-product>div{min-width:0;flex:1}.stock-product p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px}.stock-product .sku{display:flex;gap:8px;align-items:center;color:var(--color-text-secondary);font-size:10px}.sku b{font-size:10px;font-weight:500;white-space:nowrap;padding:1px 4px;background:var(--color-background);border-radius:3px}.stock-product small{display:block;margin-top:4px;color:var(--color-text-secondary);font-size:10px}.owner-name,.owner-department{display:block}.owner-department{margin-top:6px;color:var(--color-text-secondary);font-size:10px}.numeric{font-variant-numeric:tabular-nums}.sort{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.stock-totals{display:flex;flex-wrap:wrap;gap:22px;padding:15px 20px;font-size:12px;background:color-mix(in srgb,#647eaf 12%,var(--color-surface));font-variant-numeric:tabular-nums}.stock-pagination{padding:16px 18px;justify-content:flex-end;font-size:12px;color:var(--color-text-secondary)}.stock-pagination label{margin-right:auto}.stock-pagination select{width:70px;padding:7px}.stock-empty{padding:65px 20px;text-align:center;font-size:13px;color:var(--color-text-secondary)}.stock-error{margin:15px 18px;color:#c67f83;font-size:12px}
@container stock (max-width:1200px){.stock-table colgroup{display:none}.stock-table thead{display:block;padding:10px 16px}.stock-table thead tr{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px 18px}.stock-table thead th{display:none;border:0;padding:0}.stock-table thead th:first-child,.stock-table thead th.sortable{display:block}.stock-table tbody{display:block}.stock-table tbody tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--color-border);padding:8px}.stock-table td{display:block;border:0;padding:10px;font-size:12px;min-width:0}.stock-table td:before{content:attr(data-label);display:block;margin-bottom:8px;color:var(--color-text-secondary);font-size:10px}.stock-table td:nth-child(2){grid-column:span 2}.stock-table .stock-number{white-space:normal}.stock-number :deep(.stock-copy){max-width:calc(100% - 24px);color:var(--color-chart-link);font-weight:600;font-variant-numeric:tabular-nums}.stock-scope{margin-left:0}}@container stock (max-width:600px){.stock-table tbody tr{grid-template-columns:repeat(2,minmax(0,1fr))}.stock-table td:nth-child(2){grid-column:1 / -1}.stock-table td:first-child{grid-column:1 / -1}.stock-search{flex:1 1 240px}}

</style>

<script setup lang="ts">
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import OrderExceptionLabel from '@/components/autoflow/OrderExceptionLabel.vue'
import { vPickingNameTooltip } from '@/directives/picking-name-tooltip'
import { vTaskTableLayout } from '@/directives/task-table-layout'
import { skuPickingName } from '@/utils/product-display'
import { warehouseName } from '@/utils/warehouse'
import { workbenchTimeRange } from '@/utils/workbench-time-range'
import { stockBillStatusLabels } from '@/api/fop-stock'
import { useProductExpansion } from '@/composables/useProductExpansion'
import ProductExpansionButton from '@/components/autoflow/ProductExpansionButton.vue'
import CollapsibleProductLines from '@/components/autoflow/CollapsibleProductLines.vue'
import { isUncollectedPage } from '@/utils/workbench-data'
import { orderItemQuantity } from '@/api/fop-orders'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ArrowUpDown, MessageCircle, PackageSearch, Search } from 'lucide-vue-next'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import StockProcurementStatus from '@/components/autoflow/StockProcurementStatus.vue'
import WorkbenchStatusBadge from '@/components/autoflow/WorkbenchStatusBadge.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import WorkbenchRefreshControl from '@/components/autoflow/WorkbenchRefreshControl.vue'
import WorkbenchTableState from '@/components/autoflow/WorkbenchTableState.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import StockCopy from '@/components/autoflow/StockCopy.vue'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import { useOnline } from '@vueuse/core'
import StockInventoryDialog from '@/components/autoflow/StockInventoryDialog.vue'
import { exportStockOrders, getStockOrders, stockTypes, stockStatuses, stockOrderStatuses, stockLifecycles, type StockFilters, type StockPage, type StockQuery, type StockSortField } from '@/api/fop-stock'
import { fopAccessError } from '@/api/fop-access'
import { fopExportError } from '@/api/fop-order-export'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'

const { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(d => [d.id, d.name]))))
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const online = useOnline()
const followUpOrder = ref<{ id: string; stockNumber: string }>()
const props = defineProps<{ procurement?: boolean }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const sortBy = computed<StockSortField>(() => ['createdAt', 'paidAt', 'purchaseStatus'].includes(scalar('sortBy')) ? scalar('sortBy') as StockSortField : scalar('sortBy') === 'orderStatus' && !props.procurement ? 'orderStatus' : 'createdAt')
const filters = computed<StockFilters>(() => ({ queue: props.procurement ? 'procurement' : undefined, search: scalar('search') || undefined, warehouseCode: scalar('warehouseCode') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, stockType: scalar('stockType') as StockFilters['stockType'] || undefined,
  purchaseStatus: Object.hasOwn(stockStatuses, scalar('purchaseStatus')) ? scalar('purchaseStatus') as StockFilters['purchaseStatus'] : undefined,
  orderStatus: !props.procurement && Object.hasOwn(stockOrderStatuses, scalar('orderStatus')) ? scalar('orderStatus') as StockFilters['orderStatus'] : undefined,
  reviewStatus: !props.procurement && ['pending','approved'].includes(scalar('reviewStatus')) ? scalar('reviewStatus') as StockFilters['reviewStatus'] : undefined,
  lifecycle: !props.procurement && Object.hasOwn(stockLifecycles, scalar('lifecycle')) ? scalar('lifecycle') as StockFilters['lifecycle'] : undefined,
  timeRange: !props.procurement ? workbenchTimeRange(route.query.timeRange, true) : undefined,
  sortBy: sortBy.value, sortOrder: scalar('sortOrder') === 'desc' ? 'desc' : scalar('sortOrder') === 'asc' ? 'asc' : ['createdAt', 'paidAt'].includes(sortBy.value) ? 'desc' : 'asc' }))
const query = computed<StockQuery>(() => ({ ...filters.value, page: Math.max(1, Number(scalar('page')) || 1), pageSize: [20, 50, 100, 200, 500, 1000].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 100 }))
const currentTime = ref(Date.now())
const search = ref(scalar('search')), result = ref<StockPage>(), loading = ref(false), error = ref(''), selected = ref<string[]>([]), inventoryOpen = ref(false), exporting = ref(false), exportError = ref('')
const unavailable = computed(() => isUncollectedPage(result.value))
const inventorySelection = ref<string[]>()
function openInventory() { inventorySelection.value = selected.value.length ? [...selected.value] : undefined; inventoryOpen.value = true }
let listController: AbortController | undefined
let request = 0, disposed = false, exportController: AbortController | undefined
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize)))
const allSelected = computed(() => !!result.value?.items.length && result.value.items.every(r => selected.value.includes(r.id)))
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'
const money = (amount: number | null, currency: string | null) => amount == null || !Number.isFinite(amount) ? '—' : `${currency === 'USD' ? '$' : currency ? currency + ' ' : ''}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function reloadReplica() { selected.value = []; inventoryOpen.value = false; followUpOrder.value = undefined; exportController?.abort(); exporting.value = false; exportError.value = ''; void load() }
async function load() {
  currentTime.value = Date.now()
  const ticket = ++request, session = captureSession()
  listController?.abort(); listController = new AbortController()
  loading.value = true; error.value = ''
  try {
    const next = await getStockOrders(query.value, listController.signal)
    if (disposed || ticket !== request || !isCurrentSession(session)) return
    result.value = next
    emit('filter-labels', [...next.departments, ...next.items.flatMap(row => row.owner ? [row.owner] : [])])
    selected.value = selected.value.filter(id => next.items.some(r => r.id === id))
  } catch (cause) {
    if (!disposed && ticket === request && isCurrentSession(session)) { result.value = undefined; selected.value = []; error.value = fopAccessError(cause, zh.value); inventoryOpen.value = false; followUpOrder.value = undefined }
  } finally { if (ticket === request && isCurrentSession(session)) loading.value = false }
}
function update(values: Record<string, string | number | undefined>) {
  return router.replace({ query: { ...route.query, ...(props.procurement ? { orderStatus: undefined, reviewStatus: undefined } : {}), page: undefined, ...values } })
}
function sort(field: StockSortField) { void update({ sortBy: field, sortOrder: sortBy.value === field && filters.value.sortOrder === 'asc' ? 'desc' : 'asc' }) }
const sortDirection = (field: StockSortField) => sortBy.value === field ? (filters.value.sortOrder === 'desc' ? 'descending' : 'ascending') : 'none'
const sortIcon = (field: StockSortField) => sortBy.value !== field ? ArrowUpDown : filters.value.sortOrder === 'desc' ? ArrowDown : ArrowUp
function choose(event: Event, key: string) { void update({ [key]: (event.target as HTMLSelectElement).value || undefined, ...(key === 'departmentId' ? { ownerId: undefined } : {}) }) }
function submit() { void update({ search: search.value.trim() || undefined }) }
watch(search, value => { if (!value.trim() && filters.value.search) submit() })
watch(query, () => { search.value = scalar('search'); selected.value = []; inventoryOpen.value = false; followUpOrder.value = undefined; exportController?.abort(); exporting.value = false; exportError.value = ''; void load() }, { immediate: true })
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
const off = onSessionReset(() => { request++; listController?.abort(); result.value = undefined; selected.value = []; inventoryOpen.value = false; followUpOrder.value = undefined; exportController?.abort(); exporting.value = false; loading.value = false; error.value = ''; exportError.value = '' })
onBeforeUnmount(() => { disposed = true; request++; listController?.abort(); off(); exportController?.abort() })
const { expandedProductIds, hasExpandableProducts, allProductsExpanded, setProductExpanded, toggleAllProducts } = useProductExpansion(() => result.value?.items ?? [], row => row.items)
</script>

<template>
  <section class="stock-page">
    <WorkbenchTaskHeading :data-availability="result?.dataAvailability" :replica="result?.replica" :sync-disabled="loading || exporting" @replica-synced="reloadReplica" class="stock-heading" :title="props.procurement ? text('备货待采购清单', 'Stock procurement') : text('备货清单', 'Stock orders')" :description="props.procurement ? text('已审核的备货订单，跟进采购及供应商发货；可查询备货库存，采购处理请在 FOP 完成。', 'Approved stock orders awaiting procurement or supplier shipment. Check stock here; process purchases in FOP.') : text('全款与押金备货订单，覆盖待支付、采购跟进及已入库记录，可按备货阶段和客户付款时间查询。', 'Full-payment and deposit stock orders, from unpaid to procurement and receipt. Filter by stock stage and customer payment time.')"></WorkbenchTaskHeading>
    <div class="stock-panel">
      <form class="stock-filters workbench-filter-toolbar" @submit.prevent="submit">
          <div class="workbench-inline-actions"><WorkbenchRefreshControl :busy="loading" :disabled="loading" :refreshed-at="result?.refreshedAt" @refresh="load" /></div>
        <div class="workbench-filter-main">
          <div class="workbench-filter-search"><div class="stock-search workbench-search-field"><Search :size="15" /><input v-model="search" type="search" maxlength="200" :aria-label="text('搜索备货订单', 'Search stock orders')" :placeholder="text('业务员 / 备货单 / 客户 / SKU', 'Salesperson / Stock no. / Customer / SKU')" /></div><button class="workbench-button workbench-primary" :disabled="loading">{{ text('查询', 'Search') }}</button></div>

          <label>{{ text('备货类型', 'Type') }}<select class="workbench-filter-select" :value="filters.stockType ?? ''" @change="choose($event, 'stockType')"><option value="">{{ text('全部', 'All') }}</option><option v-for="(names, key) in stockTypes" :key="key" :value="key">{{ names[zh ? 0 : 1] }}</option></select></label>
          <label v-if="!props.procurement">{{ text('单据状态', 'Document status') }}<select class="workbench-filter-select" :value="filters.reviewStatus ?? ''" :aria-label="text('单据状态', 'Document status')" @change="choose($event, 'reviewStatus')"><option value="">{{ text('全部', 'All') }}</option><option value="pending">{{ text('未审核', 'Unapproved') }}</option><option value="approved">{{ text('已审核', 'Approved') }}</option></select></label>
          <label v-if="!props.procurement">{{ text('备货阶段', 'Stock stage') }}<select class="workbench-filter-select" :value="filters.lifecycle ?? ''" :aria-label="text('备货阶段', 'Stock stage')" @change="choose($event, 'lifecycle')"><option value="">{{ text('全部', 'All') }}</option><option v-for="(names, key) in stockLifecycles" :key="key" :value="key">{{ names[zh ? 0 : 1] }}</option></select></label>
          <label v-if="!props.procurement">{{ text('备货订单状态', 'Stock order status') }}<select class="workbench-filter-select" :value="filters.orderStatus ?? ''" :aria-label="text('备货订单状态', 'Stock order status')" @change="choose($event, 'orderStatus')"><option value="">{{ text('全部', 'All') }}</option><option v-for="(names, key) in stockOrderStatuses" :key="key" :value="key">{{ names[zh ? 0 : 1] }}</option></select></label>
          <label>{{ text('采购状态', 'Purchase status') }}<select class="workbench-filter-select" :value="filters.purchaseStatus ?? ''" :aria-label="text('采购状态', 'Purchase status')" @change="choose($event, 'purchaseStatus')"><option value="">{{ text('全部', 'All') }}</option><template v-for="(names, key) in stockStatuses" :key="key"><option v-if="key !== 'unknown' && (!props.procurement || key === 'unpurchased' || key === 'partial' || key === 'in_progress' || key === 'purchased')" :value="key">{{ names[zh ? 0 : 1] }}</option></template></select></label>
          <label>{{ text('业务部门', 'Department') }}<select class="workbench-filter-select" :value="filters.departmentId ?? ''" @change="choose($event, 'departmentId')"><option :value="defaultDepartmentValue(result?.departments, filters.departmentId)">{{ defaultDepartmentLabel }}</option><option v-if="filters.departmentId && !result?.departments.some(d => d.id === filters.departmentId)" :value="filters.departmentId">{{ text('所选部门', 'Selected department') }}</option><option v-for="department in departmentOptions(result?.departments)" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          <label>{{ text('收货仓库', 'Receiving warehouse') }}<select class="workbench-filter-select" :value="filters.warehouseCode ?? ''" @change="choose($event, 'warehouseCode')"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ 'HangZhou' }}</option><option value="SZ">{{ 'ShenZhen' }}</option></select></label>
          <label v-if="!props.procurement">{{ text('客户付款时间', 'Customer payment time') }}<select class="workbench-filter-select" :value="filters.timeRange ?? 'all'" :aria-label="text('客户付款时间范围', 'Customer payment time range')" @change="choose($event, 'timeRange')"><option value="all">{{ text('全部', 'All') }}</option><option value="1w">{{ text('近一周', 'Last week') }}</option><option value="1m">{{ text('近一月', 'Last month') }}</option><option value="3m">{{ text('近三月', 'Last three months') }}</option></select></label>
        <div class="workbench-filter-export"><WorkbenchExportButton :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="download" /></div></div>
        <div class="workbench-filter-secondary">



          <button v-if="filters.ownerId" type="button" class="workbench-button" :aria-label="text('清除业务员筛选', 'Clear salesperson filter')" @click="update({ ownerId: undefined })">{{ result?.items.find(row => row.owner?.id === filters.ownerId)?.owner?.name || text('已选业务员', 'Selected salesperson') }} ×</button>
          <span class="count">{{ !result || unavailable ? '—' : text(`共 ${result?.total ?? 0} 笔`, `${result?.total ?? 0} orders`) }}</span>
        </div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []"><ProductExpansionButton :expanded="allProductsExpanded" :disabled="loading || exporting || !hasExpandableProducts" @toggle="toggleAllProducts" />
        <button type="button" class="workbench-button" :disabled="loading" @click="openInventory"><PackageSearch :size="15" />{{ text('查询备货库存', 'Stock inventory') }}</button>
        <template #pagination><WorkbenchPagination :page="query.page" :page-size="query.pageSize" :pages="pages" :disabled="loading || exporting || !result" @page="update({ page: $event })" @page-size="update({ pageSize: $event, page: 1 })" /></template>
      </WorkbenchListActions>
      <p v-if="exportError" class="stock-error workbench-feedback" role="alert">{{ exportError }}</p>
      <div class="stock-table-scroll workbench-list-body"><table v-task-table-layout class="stock-table workbench-task-table" :aria-busy="loading"><thead><tr><th class="stock-number"><input class="workbench-page-checkbox" type="checkbox" :checked="allSelected" :indeterminate="!!result?.items.some(r => selected.includes(r.id)) && !allSelected" :disabled="loading || !result?.items.length" :aria-label="text('全选当前页', 'Select page')" @change="selectAll" />{{ text('备货单号', 'Stock number') }}</th><th>{{ text('商品图片 / 商品信息', 'Products') }}</th><th>{{ text('备货类型', 'Type') }}</th><th v-if="!props.procurement" class="sortable" :aria-sort="sortDirection('orderStatus')"><button class="sort" @click="sort('orderStatus')">{{ text('备货订单状态', 'Stock order status') }}<component :is="sortIcon('orderStatus')" :size="13" /></button></th><th class="sortable" :aria-sort="sortDirection('purchaseStatus')"><button class="sort" @click="sort('purchaseStatus')">{{ text('采购状态', 'Purchase status') }}<component :is="sortIcon('purchaseStatus')" :size="13" /></button></th><th>{{ text('订单金额', 'Amount') }}</th><th class="sortable" :aria-sort="sortDirection('paidAt')"><button class="sort" @click="sort('paidAt')">{{ text('客户付款时间', 'Customer payment time') }}<component :is="sortIcon('paidAt')" :size="13" /></button></th><th class="sortable" :aria-sort="sortDirection('createdAt')"><button class="sort" @click="sort('createdAt')">{{ text('创建时间', 'Created at') }}<component :is="sortIcon('createdAt')" :size="13" /></button></th><th>{{ text('客户名称', 'Customer') }}</th><th v-if="props.procurement">{{ text('店铺', 'Store') }}</th><th>{{ text('收货仓库', 'Warehouse') }}</th><th>{{ text('业务员', 'Salesperson') }}</th><th v-if="props.procurement">{{ text('操作', 'Action') }}</th></tr></thead>
        <tbody :inert="loading || !!error"><tr v-for="order in result?.items" :key="order.id"><td :data-label="text('备货单号', 'Stock number')" class="stock-number"><input v-model="selected" type="checkbox" :value="order.id" :disabled="loading || exporting" :aria-label="text('选择', 'Select') + ' ' + order.stockNumber" /><div class="stock-order-identity"><StockCopy :value="order.stockNumber" /><OrderExceptionLabel :exception="order.exception" /><div v-if="!props.procurement" class="stock-review-line"><WorkbenchStatusBadge class="stock-review-status" :tone="order.rawBillStatus === 'C' ? 'success' : order.rawBillStatus === 'B' ? 'warning' : 'neutral'" :title="text('FOP单据状态；未审核筛选包含暂存与已提交', 'FOP document status; unapproved includes draft and submitted')">{{ stockBillStatusLabels[order.rawBillStatus ?? '']?.[zh ? 0 : 1] ?? '—' }}</WorkbenchStatusBadge></div><span v-if="order.items.length" class="stock-item-summary">{{ text(`${order.items.length} 款商品 · ${orderItemQuantity(order.items) ?? '—'} 件`, `${order.items.length} products · ${orderItemQuantity(order.items) ?? '—'} units`) }}</span></div></td><td :data-label="text('商品信息', 'Products')"><span v-if="!order.items.length">{{ text('暂无商品明细', 'No product details') }}</span><CollapsibleProductLines :show-summary="!order.items.length" :expanded="expandedProductIds.has(order.id)" @update:expanded="setProductExpanded(order.id, $event)" :items="order.items" :label="order.stockNumber" v-slot="{ item }"><div class="stock-product"><OrderProductImage :src="item.imageUrl" :name="skuPickingName(item)" /><div><p v-picking-name-tooltip="skuPickingName(item)">{{ skuPickingName(item) }}</p><div class="sku"><StockCopy :value="item.sku" /><b>× {{ item.quantity ?? '—' }}</b></div></div></div></CollapsibleProductLines></td><td :data-label="text('备货类型', 'Type')"><WorkbenchStatusBadge :tone="order.stockType === 'full_payment' ? 'info' : 'neutral'" class="stock-type" :class="order.stockType">{{ order.stockType ? stockTypes[order.stockType]?.[zh ? 0 : 1] ?? '—' : '—' }}</WorkbenchStatusBadge></td><td v-if="!props.procurement" :data-label="text('备货订单状态', 'Stock order status')"><WorkbenchStatusBadge :tone="order.orderStatus === 'paid' ? 'success' : order.orderStatus === 'unpaid' ? 'warning' : 'neutral'" class="stock-order-status" :class="order.orderStatus">{{ order.orderStatusName || (order.orderStatus ? stockOrderStatuses[order.orderStatus]?.[zh ? 0 : 1] ?? '—' : '—') }}</WorkbenchStatusBadge></td><td :data-label="text('采购状态', 'Purchase status')"><StockProcurementStatus class="stock-status" :class="order.purchaseStatus" :status="order.purchaseStatus ?? 'unpurchased'" :source-name="order.purchaseStatusName" :paid-at="order.procurementPaidAt" :now="currentTime" /></td><td :data-label="text('订单金额', 'Amount')" class="numeric">{{ money(order.amount, order.currency) }}</td><td class="workbench-date-cell" :data-label="text('客户付款时间', 'Customer payment time')">{{ date(order.paidAt) }}</td><td class="workbench-date-cell" :data-label="text('创建时间', 'Created at')">{{ date(order.createdAt ?? null) }}</td><td :data-label="text('客户名称', 'Customer')"><StockCopy v-if="order.customerName" :value="order.customerName" /><span v-else>—</span></td><td v-if="props.procurement" :data-label="text('店铺', 'Store')">{{ order.storeName || '—' }}</td><td :data-label="text('收货仓库', 'Warehouse')">{{ warehouseName(order.warehouse) }}</td><td class="stock-owner" :data-label="text('业务员', 'Salesperson')"><span class="owner-name" :title="order.owner?.name">{{ order.owner?.name || '—' }}</span><small class="owner-department">{{ order.department?.name || '—' }}</small></td><td v-if="props.procurement" :data-label="text('操作', 'Action')"><button v-if="order.purchaseStatus === 'purchased'" type="button" class="stock-follow-up" :disabled="!online || order.dataQuality?.readOnly" :title="order.dataQuality?.readOnly ? text('暂不可操作', 'Currently unavailable') : undefined" :aria-label="`${text('催办', 'Follow up')} ${order.stockNumber}`" @click="followUpOrder = { id: order.id, stockNumber: order.stockNumber }"><MessageCircle :size="14" />{{ text('催办', 'Follow up') }}</button></td></tr><WorkbenchTableState v-if="!result?.items.length" :columns="props.procurement ? 12 : 11" :loading="loading" :error="error" :message="unavailable ? text('备货单数据尚未齐全，暂时无法查询。', 'Stock order data is incomplete.') : text('暂无符合条件的备货订单', 'No matching stock orders')" /></tbody>
      </table></div>

      <div v-if="result?.total" class="stock-totals"><strong>{{ text('筛选合计', 'Filtered total') }}</strong><span>{{ result.totals.orderCount }} {{ text('笔', 'orders') }}</span><span v-for="total in result.totals.amounts" :key="total.currency">{{ money(total.amount, total.currency) }}</span></div>

    </div>
    <SupplierFollowUpDialog v-if="followUpOrder" :key="followUpOrder.id" :order-id="followUpOrder.id" :order-number="followUpOrder.stockNumber" source-kind="stock" @close="followUpOrder = undefined" />
    <StockInventoryDialog v-if="inventoryOpen" :order-ids="inventorySelection" :queue="props.procurement ? 'procurement' : 'all'" @close="inventoryOpen = false" />
  </section>
</template>

<style scoped>
.stock-table-scroll{width:100%;min-width:0;overflow-x:auto}

.stock-review-line { margin: 6px 0 0 24px; }
.stock-follow-up{display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;color:var(--color-chart-link);font-size:12px;padding:6px 4px;border-radius:4px}.stock-follow-up:hover{background:color-mix(in srgb,var(--color-chart-link) 10%,transparent)}.stock-follow-up:disabled{opacity:.45;cursor:not-allowed}
.stock-pagination label{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--color-text-secondary)}


.stock-page{min-width:0;color:var(--color-text)}.stock-pagination{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.mock-badge{font-size:10px;letter-spacing:.1em;padding:3px 7px;border:1px solid #b3904938;border-radius:4px;background:#c9a4591c;color:#b4955d}.stock-panel{container:stock / inline-size;border:1px solid var(--color-border);background:var(--color-surface);border-radius:9px;overflow:clip}.count{font-size:12px;color:var(--color-text-secondary)}.stock-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.stock-table th,.stock-table td{padding:12px 8px;text-align:left;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere}.stock-table th{padding:14px 8px}.stock-table input[type=checkbox]{width:15px;height:15px;accent-color:#687fba;margin-right:10px;vertical-align:middle}.stock-table .stock-number{white-space:nowrap;text-align:center;padding-inline:16px}.stock-number :deep(.stock-copy){max-width:calc(100% - 24px);color:var(--color-chart-link);font-weight:600;font-variant-numeric:tabular-nums}.stock-number :deep(.stock-copy>span){white-space:nowrap;overflow-wrap:normal}.stock-table tbody tr:hover{background:color-mix(in srgb,var(--color-text) 3%,transparent)}.stock-product{display:flex;align-items:center;gap:9px;min-width:0}.stock-product+.stock-product{margin-top:12px}.stock-product>div{min-width:0;flex:1}.stock-product p{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px}.stock-product .sku{display:flex;gap:8px;align-items:center;color:var(--color-text-secondary);font-size:10px}.sku b{font-size:10px;font-weight:500;white-space:nowrap;padding:1px 4px;background:var(--color-background);border-radius:3px}.stock-product small{display:block;margin-top:4px;color:var(--color-text-secondary);font-size:10px}.owner-name,.owner-department{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.65}.owner-department{margin-top:3px;color:var(--color-text-secondary);font-size:11px}.numeric{font-variant-numeric:tabular-nums}.sort{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.stock-totals{display:flex;flex-wrap:wrap;gap:22px;padding:15px 20px;font-size:12px;background:color-mix(in srgb,#647eaf 12%,var(--color-surface));font-variant-numeric:tabular-nums}.stock-pagination{padding:16px 18px;justify-content:flex-end;font-size:12px;color:var(--color-text-secondary)}.stock-pagination label{margin-right:auto}.stock-pagination select{width:70px;padding:7px}.stock-error{margin:15px 18px;color:#c67f83;font-size:12px}
.stock-item-summary { display: block; width: fit-content; max-width: 100%; margin: 8px auto 0; padding: 3px 6px; border-radius: 4px; color: var(--color-text-secondary); background: var(--color-surface-muted); font-size: 10px; line-height: 1.4; font-variant-numeric: tabular-nums; white-space: normal; }
@media (max-width: 767px) {
@container stock (max-width:1500px){.stock-table colgroup{display:none}.stock-table thead{display:block;padding:10px 16px}.stock-table thead tr{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px 18px}.stock-table thead th{display:none;border:0;padding:0}.stock-table thead th:first-child,.stock-table thead th.sortable{display:block}.stock-table tbody{display:block}.stock-table tbody tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--color-border);padding:8px}.stock-table td{display:block;border:0;padding:10px;font-size:12px;min-width:0}.stock-table td:before{content:attr(data-label);display:block;margin-bottom:8px;color:var(--color-text-secondary);font-size:10px}.stock-table td:nth-child(2),.stock-table .stock-owner{grid-column:span 2}.stock-table .stock-number{white-space:normal}.stock-number :deep(.stock-copy){max-width:calc(100% - 24px);color:var(--color-chart-link);font-weight:600;font-variant-numeric:tabular-nums}}@container stock (max-width:600px){.stock-table tbody tr{grid-template-columns:repeat(2,minmax(0,1fr))}.stock-table td:nth-child(2){grid-column:1 / -1}.stock-table td:first-child{grid-column:1 / -1}}
}


</style>

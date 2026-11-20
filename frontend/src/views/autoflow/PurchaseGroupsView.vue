<script setup lang="ts">
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import OrderExceptionLabel from '@/components/autoflow/OrderExceptionLabel.vue'
import { vPickingNameTooltip } from '@/directives/picking-name-tooltip'
import { vTaskTableLayout } from '@/directives/task-table-layout'
import { skuPickingName } from '@/utils/product-display'
import { warehouseName } from '@/utils/warehouse'
import { workbenchTimeRange } from '@/utils/workbench-time-range'
import { physicalProductsFirst } from '@/utils/product-display'
import ProductExpansionButton from '@/components/autoflow/ProductExpansionButton.vue'
import CollapsibleProductLines from '@/components/autoflow/CollapsibleProductLines.vue'
import { isUncollectedPage } from '@/utils/workbench-data'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, Search } from 'lucide-vue-next'
import { purchaseStageLabels, isPurchaseStage, getPurchaseGroups, getPurchaseGroupDetails, exportPurchaseGroups, type PurchaseGroup, type PurchaseDetails, type PurchasePage, type PurchaseFilters, type PurchaseQuery } from '@/api/procurement-groups'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import SupplierShipmentStatus from '@/components/autoflow/SupplierShipmentStatus.vue'
import '@/styles/workbench-list.css'
import WorkbenchRefreshControl from '@/components/autoflow/WorkbenchRefreshControl.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import WorkbenchStatusBadge from '@/components/autoflow/WorkbenchStatusBadge.vue'
import StockCopy from '@/components/autoflow/StockCopy.vue'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import { purchaseCurrentStage } from '@/utils/purchase-current-stage'
import { fopAccessError } from '@/api/fop-access'
import { fopExportError } from '@/api/fop-order-export'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
const { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(d => [d.id, d.name]))))
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh')), t = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const completed = computed(() => route.query.queue === 'completed')
const filters = computed<PurchaseFilters>(() => ({ ...(completed.value ? { completed: true, timeRange: workbenchTimeRange(route.query.timeRange) } : {}), purchaseStage: !completed.value && route.query.queue !== 'procurement_shipping' && isPurchaseStage(route.query.purchaseStage) ? route.query.purchaseStage : undefined, queue: route.query.queue === 'procurement_shipping' ? 'procurement_shipping' : 'procurement', search: scalar('search') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, warehouseCode: scalar('warehouseCode') || undefined, sortOrder: scalar('sortOrder') === 'desc' ? 'desc' : scalar('sortOrder') === 'asc' ? 'asc' : 'desc' }))
const query = computed<PurchaseQuery>(() => ({ ...filters.value, page: Math.max(1, Number(scalar('page')) || 1), pageSize: [20, 50, 100, 200, 500, 1000].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 100 }))
const search = ref(scalar('search')), result = ref<PurchasePage>(), loading = ref(false), error = ref(''), now = ref(Date.now())
const unavailable = computed(() => isUncollectedPage(result.value))
const expanded = ref<string[]>([]), selected = ref<string[]>([]), details = ref<Record<string, PurchaseDetails>>({}), detailErrors = ref<Record<string, string>>({}), detailBusy = ref<Record<string, boolean>>({})
const followUp = ref<{ orderId: string; orderNumber: string; purchaseOrderId: string }>(), exporting = ref(false), exportError = ref('')
let generation = 0, disposed = false, sessionClosed = false, exportController: AbortController | undefined
let listController: AbortController | undefined
const detailControllers = new Map<string, AbortController>()
function cancelListReads() { listController?.abort(); for (const controller of detailControllers.values()) controller.abort(); detailControllers.clear() }
const detailTickets = new Map<string, number>()
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize)))
const canExpandGroup = (_group: PurchaseGroup) => true
const expandableGroups = computed(() => result.value?.items ?? [])
const allExpanded = computed(() => !!expandableGroups.value.length && expandableGroups.value.every(g => expanded.value.includes(g.id)))
const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const allSelected = computed(() => !!result.value?.items.length && result.value.items.every(g => selected.value.includes(g.id)))
const date = (v: string | null) => v ? new Date(v).toLocaleString(zh.value ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const number = (v: number | null) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(zh.value ? 'zh-CN' : 'en-US', { maximumFractionDigits: 8 })
const payments = { paid: ['已付款', 'Paid'], unpaid: ['待付款', 'Unpaid'], partial: ['部分付款', 'Partly paid'], refunded: ['已退款', 'Refunded'], cancelled: ['未支付已取消', 'Cancelled unpaid'], partially_refunded: ['部分退款', 'Partially refunded'], unknown: ['付款待确认', 'Payment unknown'] }
const shipments = { pending: ['供应商待发货', 'Awaiting shipment'], partial: ['供应商部分发货', 'Partly shipped'], shipped: ['已发货', 'Shipped'], unknown: ['发货待确认', 'Shipment unknown'] }
function update(values: Record<string, string | number | undefined>) { return router.replace({ query: { ...route.query, page: undefined, ...values } }) }
function choose(event: Event, key: string) { void update({ [key]: (event.target as HTMLSelectElement).value || undefined, ...(key === 'departmentId' ? { ownerId: undefined } : {}) }) }
function submit() { void update({ search: search.value.trim() || undefined }) }
watch(search, v => { if (!v.trim() && filters.value.search) submit() })
async function loadDetails(id: string, page = 1) {
  if (disposed || sessionClosed) return
  const session = captureSession(), current = generation, ticket = (detailTickets.get(id) ?? 0) + 1
  detailControllers.get(id)?.abort()
  const controller = new AbortController(); detailControllers.set(id, controller)
  detailTickets.set(id, ticket); detailBusy.value[id] = true; delete details.value[id]; delete detailErrors.value[id]
  try {
    const next = await getPurchaseGroupDetails(id, { ...filters.value, page, pageSize: 20 }, controller.signal)
    if (disposed || current !== generation || detailTickets.get(id) !== ticket || !isCurrentSession(session)) return
    details.value[id] = next
    // Refresh the group header with the same snapshot as the expanded rows.
    if (result.value) result.value.items = result.value.items.map(g => g.id === id ? next.group : g)

  } catch (cause) { if (!disposed && current === generation && isCurrentSession(session) && detailTickets.get(id) === ticket) detailErrors.value[id] = fopAccessError(cause, zh.value) }
  finally { if (!disposed && current === generation && detailTickets.get(id) === ticket) detailBusy.value[id] = false }
}
function toggle(id: string) { if (expanded.value.includes(id)) expanded.value = expanded.value.filter(x => x !== id); else { expanded.value.push(id); if (!details.value[id] && !detailBusy.value[id]) void loadDetails(id) } }
// Bound detail reads to four concurrent requests, including 1000-row pages.
async function loadExpanded(ids: string[], ticket = generation) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (!disposed && !sessionClosed && ticket === generation && cursor < ids.length) {
      const id = ids[cursor++]!
      if (expanded.value.includes(id) && !details.value[id] && !detailBusy.value[id]) await loadDetails(id)
    }
  }))
}
function toggleAll() {
  if (allExpanded.value) { expanded.value = []; return }
  const ids = expandableGroups.value.map(g => g.id)
  const newIds = ids.filter(id => !expanded.value.includes(id))
  expanded.value = ids
  void loadExpanded(newIds)
}
function followPurchase(group: PurchaseGroup) {
  if (group.purchase) followUp.value = { orderId: group.id, orderNumber: group.purchase.number, purchaseOrderId: group.purchase.id }
}
function reloadReplica() { selected.value = []; expanded.value = []; exportController?.abort(); exporting.value = false; exportError.value = ''; void load() }
async function load() {
  if (disposed || sessionClosed) return
  const ticket = ++generation, session = captureSession(), prior = [...expanded.value]
  cancelListReads(); listController = new AbortController()
  now.value = Date.now(); loading.value = true; error.value = ''; details.value = {}; detailErrors.value = {}; detailBusy.value = {}; followUp.value = undefined
  try {
    const next = await getPurchaseGroups(query.value, listController.signal)
    if (disposed || ticket !== generation || !isCurrentSession(session)) return
    const lastPage = Math.max(1, Math.ceil(next.total / query.value.pageSize))
    if (query.value.page > lastPage) { await update({ page: lastPage }); return }
    result.value = next; emit('filter-labels', next.departments)
    selected.value = selected.value.filter(id => next.items.some(g => g.id === id))
    expanded.value = prior.filter(id => next.items.some(g => g.id === id && canExpandGroup(g)))
    void loadExpanded(expanded.value, ticket)
  } catch (cause) { if (!disposed && ticket === generation && isCurrentSession(session)) { result.value = undefined; error.value = fopAccessError(cause, zh.value); selected.value = []; expanded.value = [] } }
  finally { if (!disposed && ticket === generation && isCurrentSession(session)) loading.value = false }
}
function selectAll() { selected.value = allSelected.value ? [] : result.value?.items.map(g => g.id) ?? [] }
async function download() {
  if (exporting.value || loading.value) return
  const session = captureSession(), current = generation, controller = new AbortController(); exportController = controller; exporting.value = true; exportError.value = ''
  try {
    const blob = await exportPurchaseGroups({ ...filters.value, ...(selected.value.length ? { mode: 'selected' as const, groupIds: [...selected.value] } : { mode: 'filtered' as const }) }, controller.signal)
    if (disposed || current !== generation || !isCurrentSession(session) || controller.signal.aborted) return
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = '采购关联明细.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { if (!disposed && current === generation && isCurrentSession(session) && !controller.signal.aborted) exportError.value = fopExportError(cause, zh.value) }
  finally { if (exportController === controller) exporting.value = false }
}
watch(query, () => { search.value = scalar('search'); selected.value = []; expanded.value = []; exportController?.abort(); exporting.value = false; exportError.value = ''; void load() }, { immediate: true })
const off = onSessionReset(() => { sessionClosed = true; cancelListReads(); generation++; result.value = undefined; details.value = {}; detailErrors.value = {}; detailBusy.value = {}; selected.value = []; expanded.value = []; followUp.value = undefined; exportController?.abort() })
onBeforeUnmount(() => { disposed = true; cancelListReads(); generation++; exportController?.abort(); off() })
</script>
<template>
  <section class="purchase-groups">
    <WorkbenchTaskHeading :data-availability="result?.dataAvailability" :replica="result?.replica" :sync-disabled="loading || exporting" @replica-synced="reloadReplica" :title="completed ? t('采购完成清单', 'Completed purchases') : filters.queue === 'procurement_shipping' ? t('已采购待发货', 'Awaiting supplier shipment') : t('待采购清单', 'Pending procurement')" :description="completed ? undefined : t('按采购订单跟进付款与发货，展开查看关联履约订单及商品明细。', 'Track purchase payment and shipment. Expand linked fulfillment orders and products.')"></WorkbenchTaskHeading>
    <div class="group-panel">
      <form class="group-filters workbench-filter-toolbar" @submit.prevent="submit">
          <div class="workbench-inline-actions"><slot name="heading-actions" /><WorkbenchRefreshControl :busy="loading" :disabled="loading || exporting" :refreshed-at="result?.refreshedAt" @refresh="load" /></div>
        <div class="workbench-filter-main">
          <div class="workbench-filter-search"><div class="workbench-search-field"><Search :size="16" /><input v-model="search" type="search" maxlength="200" :aria-label="t('搜索采购分组', 'Search purchase groups')" :placeholder="t('采购单 / 供应商 / 履约单 / 客户 / 业务员 / SKU', 'Purchase / supplier / fulfillment / customer / salesperson / SKU')" /></div><button class="workbench-button workbench-primary" :disabled="loading">{{ t('查询', 'Search') }}</button></div>

          <label v-if="!completed && filters.queue === 'procurement'">{{ t('采购进度', 'Purchase progress') }}<select class="workbench-filter-select" :value="filters.purchaseStage || ''" :disabled="loading" :aria-label="t('采购进度筛选', 'Purchase progress filter')" @change="choose($event, 'purchaseStage')"><option value="">{{ t('全部状态', 'All statuses') }}</option><option v-for="(label, value) in Object.fromEntries(Object.entries(purchaseStageLabels).filter(([key]) => ['uncreated','dispatch_preparation','payment_pending'].includes(key)))" :key="value" :value="value">{{ label[zh ? 0 : 1] }}</option></select></label>
          <label>{{ t('业务部门', 'Department') }}<select class="workbench-filter-select" :value="filters.departmentId || ''" @change="choose($event, 'departmentId')"><option :value="defaultDepartmentValue(result?.departments, filters.departmentId)">{{ defaultDepartmentLabel }}</option><option v-for="d in departmentOptions(result?.departments)" :key="d.id" :value="d.id">{{ d.name }}</option></select></label>
          <label>{{ t('发货仓库', 'Warehouse') }}<select class="workbench-filter-select" :value="filters.warehouseCode || ''" @change="choose($event, 'warehouseCode')"><option value="">{{ t('全部', 'All') }}</option><option value="HZ">{{ 'HangZhou' }}</option><option value="SZ">{{ 'ShenZhen' }}</option></select></label>
          <label v-if="completed">{{ t('客户付款时间', 'Customer payment time') }}<select class="workbench-filter-select" :value="filters.timeRange" :disabled="loading" :aria-label="t('客户付款时间范围', 'Customer payment time range')" @change="choose($event, 'timeRange')"><option value="1w">{{ t('近一周', 'Last week') }}</option><option value="1m">{{ t('近一月', 'Last month') }}</option><option value="3m">{{ t('近三月', 'Last three months') }}</option></select></label>
        <div class="workbench-filter-export"><WorkbenchExportButton :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="download" /></div></div>
        <div class="workbench-filter-secondary">

          <button class="workbench-button" type="button" @click="update({sortOrder:filters.sortOrder === 'asc' ? 'desc' : 'asc'})">{{ filters.sortOrder === 'asc' ? t('最早客户付款优先', 'Oldest customer payment first') : t('最新客户付款优先', 'Newest customer payment first') }}</button>
          <button v-if="filters.ownerId" class="workbench-button" type="button" @click="update({ownerId:undefined})">{{ t('清除业务员筛选', 'Clear salesperson filter') }}</button>
          <span class="result-count" aria-live="polite" >
            {{ unavailable ? '—' : result ? t(`共 ${result.totals.purchaseCount ?? '—'} 张采购单`, `${result.totals.purchaseCount ?? '—'} purchase orders`) : '—' }}<template v-if="result?.totals.uncreatedCount"> · {{ t(`待建 ${result.totals.uncreatedCount ?? '—'} 笔`, `${result.totals.uncreatedCount ?? '—'} awaiting creation`) }}</template>
          </span>
        </div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []">
        <ProductExpansionButton class="expand-all" :expanded="allExpanded" :disabled="loading || !expandableGroups.length" @toggle="toggleAll" />

        <template #pagination><WorkbenchPagination :page="query.page" :page-size-label="t('每页采购组', 'Groups per page')" :page-size="query.pageSize" :pages="pages" :disabled="loading || exporting || !result" @page="update({ page: $event })" @page-size="update({ pageSize: $event, page: 1 })" /></template>
      </WorkbenchListActions>
      <p v-if="error || exportError" class="group-error workbench-feedback" role="alert">{{ error || exportError }}</p>
      <div class="purchase-scroll workbench-list-body">
      <div class="purchase-columns"><span class="group-select"><input class="workbench-page-checkbox" type="checkbox" :checked="allSelected" :indeterminate="!!result?.items.some(g => selected.includes(g.id)) && !allSelected" :disabled="loading || exporting || !result?.items.length" :aria-label="t('选择本页采购组', 'Select purchase groups on this page')" @change="selectAll" /></span><span>{{ t('采购订单 / 1688 单号', 'Purchase / 1688 order') }}</span><span>{{ t('供应商', 'Supplier') }}</span><span>{{ t('付款 / 发货状态', 'Payment / shipment') }}</span><span>{{ t('实际支付金额', 'Actual payment') }}</span><span>{{ t('关联履约 / 商品', 'Orders / products') }}</span><span>{{ t('采购付款时间', 'Purchase paid at') }}</span><span>{{ t('操作', 'Actions') }}</span></div>
      <article :inert="loading || !!error" v-for="group in result?.items" :key="group.id" class="purchase-group" :class="{ 'is-expanded': expanded.includes(group.id) }" :data-group="group.id">
        <header class="group-head">
          <div class="group-select"><input v-model="selected" type="checkbox" :value="group.id" :aria-label="t('选择采购组 ', 'Select group ') + (group.purchase?.number || group.id)" /><button type="button" class="group-expand" :aria-expanded="expanded.includes(group.id)" :aria-controls="`purchase-details-${encodeURIComponent(group.id)}`" :aria-label="t('展开采购组 ', 'Expand group ') + (group.purchase?.number || group.id)" @click="toggle(group.id)"><ChevronDown v-if="expanded.includes(group.id)" :size="16" /><ChevronRight v-else :size="16" /></button></div>
          <div class="group-identity"><div class="purchase-number"><StockCopy v-if="group.purchase" :value="group.purchase.number" /><strong v-else>{{ t('待建采购订单', 'Purchase not created') }}</strong></div><div v-if="group.purchase?.platformOrderNumber" class="platform-number"><span class="platform-label">{{ group.purchase.platform === '1688' ? '1688' : t('平台订单', 'Platform order') }}</span><StockCopy :value="group.purchase.platformOrderNumber" /></div><small v-else>{{ group.purchase ? t('采购订单', 'Purchase order') : t('履约订单采购需求', 'Fulfillment purchase demand') }}</small></div>
          <div class="supplier-cell"><span class="supplier-name" v-picking-name-tooltip="group.purchase?.supplier.name">{{ group.purchase?.supplier.name || '—' }}</span><small v-if="group.purchase?.supplier.phone" class="supplier-phone">{{ t('电话', 'Phone') }} {{ group.purchase.supplier.phone }}</small><small v-if="group.purchase">{{ group.purchase.purchaseType === 'offline' ? t('线下采购', 'Offline purchase') : group.purchase.purchaseType === 'online' ? group.purchase.platform === '1688' ? t('线上 · 1688', 'Online · 1688') : t('线上 · 其他平台', 'Online · Other') : '' }}</small></div>
          <div class="group-status group-badges"><template v-if="group.purchase"><WorkbenchStatusBadge v-if="filters.queue === 'procurement' && group.stage === 'dispatch_preparation'" tone="warning">{{ t('待制作发运单', 'Dispatch preparation pending') }}</WorkbenchStatusBadge><WorkbenchStatusBadge v-if="filters.queue !== 'procurement_shipping' || group.purchase.payment !== 'paid'" :current="purchaseCurrentStage(group) === 'payment'" :tone="group.purchase.payment === 'paid' ? 'success' : ['refunded','partially_refunded','cancelled'].includes(group.purchase.payment) ? 'danger' : ['unpaid','partial'].includes(group.purchase.payment) ? 'warning' : 'neutral'">{{ payments[group.purchase.payment][zh ? 0 : 1] }}</WorkbenchStatusBadge><SupplierShipmentStatus v-if="filters.queue === 'procurement_shipping' && group.purchase.payment === 'paid' && (group.shipment === 'pending' || group.shipment === 'partial')" :paid-at="group.purchase.paidAt" :now="now" :shipment="group.shipment" :current="purchaseCurrentStage(group) === 'shipment'" /><small v-else-if="filters.queue === 'procurement_shipping'">{{ shipments[group.shipment][zh ? 0 : 1] }}</small></template><WorkbenchStatusBadge v-else tone="neutral">{{ t('待建采购订单', 'Purchase not created') }}</WorkbenchStatusBadge></div>
          <div class="amount-cell"><strong>{{ money(group.purchase?.actualPaidAmount) }}</strong><small>{{ t('实际支付运费', 'Paid freight') }} {{ money(group.purchase?.actualPaidFreight) }}</small></div>
          <div class="group-counts"><button type="button" class="detail-link" :aria-expanded="expanded.includes(group.id)" @click="toggle(group.id)">{{ group.orderCount ?? '—' }} {{ t('笔履约订单', 'fulfillment orders') }}</button><small>{{ group.skuCount ?? '—' }} SKU · {{ number(group.quantity) }} {{ t('件', 'units') }}</small></div>
          <div class="time-cell">{{ date(group.purchase?.paidAt ?? null) }}</div>
          <div class="group-actions"><button v-if="filters.queue !== 'procurement_shipping'" type="button" class="detail-link" @click="toggle(group.id)">{{ expanded.includes(group.id) ? t('收起', 'Collapse') : t('展开明细', 'Details') }}</button><button v-if="group.purchase?.platform === '1688' && group.purchase.platformOrderNumber && filters.queue === 'procurement_shipping'" type="button" class="group-follow-up" @click="followPurchase(group)">{{ t('旺旺催办', 'Follow up') }}</button></div>
        </header>
        <div v-if="expanded.includes(group.id)" :id="`purchase-details-${encodeURIComponent(group.id)}`" class="group-body">
          <p v-if="detailBusy[group.id]" class="group-message">{{ t('正在加载履约明细…', 'Loading fulfillment details…') }}</p>
          <div v-else-if="detailErrors[group.id]" class="group-error" role="alert">{{ detailErrors[group.id] }} <button class="workbench-button" @click="loadDetails(group.id)">{{ t('重试', 'Retry') }}</button></div>
          <template v-else-if="details[group.id]"><div v-if="details[group.id]!.total > 20" class="detail-pagination"><span>{{ t('履约明细', 'Fulfillment details') }} {{ details[group.id]!.page }} / {{ Math.ceil(details[group.id]!.total / 20) }}</span><button class="workbench-button" :disabled="details[group.id]!.page <= 1" @click="loadDetails(group.id, details[group.id]!.page-1)">{{ t('上一页', 'Previous') }}</button><button class="workbench-button" :disabled="details[group.id]!.page * 20 >= details[group.id]!.total" @click="loadDetails(group.id, details[group.id]!.page+1)">{{ t('下一页', 'Next') }}</button></div><div class="group-table-wrap"><table v-task-table-layout><thead><tr><th>{{ t('履约订单', 'Fulfillment order') }}</th><th>{{ t('关联商品 / SKU', 'Linked products / SKU') }}</th><th>{{ t('客户 / 店铺', 'Customer / store') }}</th><th>{{ t('业务员 / 部门', 'Salesperson / department') }}</th><th >{{ completed ? t('发货仓库 / 采购完成时间', 'Warehouse / purchase completion') : t('发货仓库 / 客户付款时间', 'Warehouse / customer payment time') }}</th></tr></thead><tbody :inert="loading || !!error"><tr v-for="row in details[group.id]!.items" :key="row.orderId || row.orderNumber"><td class="fulfillment-cell"><StockCopy :value="row.orderNumber" /><OrderExceptionLabel :exception="row.exception" /><small v-if="row.shopifyOrderNumber"><StockCopy :value="row.shopifyOrderNumber" /></small></td><td><CollapsibleProductLines :items="physicalProductsFirst(row.lines)" :label="row.orderNumber" v-slot="{ item: line }"><div class="linked-product"><OrderProductImage :src="line.imageUrl" :name="skuPickingName(line)" /><div><p v-picking-name-tooltip="skuPickingName(line)">{{ skuPickingName(line) || '—' }}</p><StockCopy :value="line.sku" /><small v-if="!group.purchase">{{ t('待采购数量', 'Quantity to purchase') }} {{ number(line.quantity) }}</small><small v-else>{{ t('采购', 'Purchased') }} {{ number(line.quantity) }} · {{ t('已发', 'Shipped') }} {{ number(line.shippedQuantity) }} · {{ t('未发', 'Unshipped') }} {{ number(line.quantity == null || line.shippedQuantity == null ? null : Number((line.quantity-line.shippedQuantity).toFixed(8))) }}</small></div></div></CollapsibleProductLines></td><td>{{ row.customerName || '—' }}<small>{{ row.storeName }}</small></td><td>{{ row.ownerName || '—' }}<small>{{ row.departmentName }}</small></td><td>{{ warehouseName(row.warehouse) }}<small>{{ date(completed ? row.completedAt ?? null : row.paidAt ?? null) }}</small></td></tr></tbody></table></div></template>
        </div>
      </article>
      <p v-if="!result?.items.length" class="group-message" role="status">{{ loading ? t('正在查询…', 'Loading…') : error ? t('请刷新重试', 'Refresh to retry') : unavailable ? '' : t('暂无符合条件的采购待办', 'No matching purchase tasks') }}</p>
      </div>


    </div>
    <SupplierFollowUpDialog v-if="followUp" :order-id="followUp.orderId" :order-number="followUp.orderNumber" :purchase-order-id="followUp.purchaseOrderId" :group-filters="filters" @close="followUp = undefined" />
  </section>
</template>
<style scoped>
.purchase-groups{color:var(--color-text);min-width:0}.group-panel{background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;overflow:hidden}

.purchase-scroll{overflow-x:auto}.purchase-columns,.group-head{display:grid;grid-template-columns:32px minmax(170px,1.4fr) minmax(100px,1fr) minmax(108px,1fr) minmax(90px,.8fr) minmax(90px,.8fr) 124px 72px;gap:8px;align-items:center;min-width:0;padding:18px 12px}
.purchase-columns{padding-top:14px;padding-bottom:14px;background:color-mix(in srgb,var(--color-text-secondary) 4%,var(--color-surface));border-bottom:1px solid var(--color-border);font-size:12px;color:var(--color-text-secondary);font-weight:500}
.group-head{font-size:13px;line-height:1.6;min-height:96px;transition:background .15s}.group-head:hover,.is-expanded>.group-head{background:color-mix(in srgb,var(--color-chart-link) 4%,var(--color-surface))}.purchase-group+.purchase-group{border-top:1px solid var(--color-border)}
.group-select{display:flex;align-items:center;gap:10px}.group-expand{padding:4px;color:var(--color-text-secondary);display:flex;border-radius:4px}.group-expand:hover{color:var(--color-chart-link);background:color-mix(in srgb,var(--color-chart-link) 8%,transparent)}
.group-identity,.supplier-cell,.group-counts,.amount-cell{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0}.purchase-number{font-weight:600;color:var(--color-chart-link);font-size:13px}.purchase-number strong{font-weight:600}.platform-number{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text-secondary)}.platform-label{font-size:10px;border:1px solid var(--color-border);border-radius:3px;padding:0 3px}.supplier-name{display:block;width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
small{font-size:12px;color:var(--color-text-secondary);line-height:1.6}.group-status{display:flex;flex-direction:column;align-items:flex-start;gap:6px}.amount-cell strong{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}.time-cell{white-space:nowrap;font-size:12px;font-variant-numeric:tabular-nums}.group-actions{display:flex;flex-direction:column;align-items:flex-start;gap:8px}.detail-link,.group-follow-up{font-size:12px;color:var(--color-chart-link);padding:0;line-height:1.6}.detail-link:hover,.group-follow-up:hover{text-decoration:underline}button:focus-visible{outline:2px solid var(--color-chart-link);outline-offset:3px}
.group-body{min-width:0;padding:0 12px 18px 52px;background:color-mix(in srgb,var(--color-chart-link) 3%,var(--color-surface))}.group-table-wrap{overflow-x:auto;background:var(--color-surface);border:1px solid var(--color-border);border-radius:6px}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}th,td{text-align:left;padding:16px;vertical-align:middle;border-bottom:1px solid var(--color-border)}th{font-size:12px;font-weight:500;color:var(--color-text-secondary);padding-top:12px;padding-bottom:12px}tbody tr:last-child td{border:0}td small{display:block;margin-top:5px}.fulfillment-cell>:deep(.stock-copy){color:var(--color-chart-link)}.linked-product{display:flex;gap:10px;margin-bottom:12px}.linked-product:last-child{margin-bottom:0}.linked-product>div{min-width:0}.linked-product p{margin:0 0 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.detail-pagination{display:flex;justify-content:flex-end;align-items:center;gap:12px;padding:12px 0;font-size:12px;color:var(--color-text-secondary)}.group-message{padding:28px;text-align:center;font-size:13px;color:var(--color-text-secondary)}.group-error{padding:14px 20px;color:var(--color-danger,#dc6b6b);font-size:13px}input[type=checkbox]{accent-color:var(--color-chart-link)}td:last-child small{white-space:nowrap}
</style>

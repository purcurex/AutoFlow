<script setup lang="ts">
import { lockApprovalNavigation } from '@/utils/approvalNavigation'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { exportFopOrders, fopExportError } from '@/api/fop-order-export'
import { downloadBlob } from '@/utils/export'
import type { ApprovalQueue } from '@/api/fop-approvals'
import { formatCurrency } from '@/utils/currency'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import OrderSortHeader from '@/components/autoflow/OrderSortHeader.vue'
import ProcurementStatus from '@/components/autoflow/ProcurementStatus.vue'
import DispatchStatus from '@/components/autoflow/DispatchStatus.vue'
import TableTotals from '@/components/ui/TableTotals.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ArrowDown, ArrowUpDown, Check, Copy, ChevronLeft, ChevronRight, PackageSearch, RefreshCw, Search, MessageCircle, Download } from 'lucide-vue-next'
import { copyText } from '@/utils/copyText'
import { getFopOrders, canSortFopQueue, isFopOrderSortBy, type FopOrderSortBy, isFopOrderQueue, isWarehouseStage, matchesFopQueue, type FopOrder, type FopOrderQuery, type FopQueuePage } from '@/api/fop-orders'
import { fopAccessError } from '@/api/fop-access'

import { defaultWorkbenchQueue, isWorkbenchRole, workbenchOrderLocation, workbenchQueues } from '@/utils/workbench'

type SearchRecovery = { token: symbol; from: string; to: string; search: string }
const props = defineProps<{ searchRecovery?: SearchRecovery; recoverPage?: (recovery: SearchRecovery) => Promise<void> }>()
const emit = defineEmits<{ 'clear-search-recovery': [token: symbol] }>()
const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const role = computed(() => isWorkbenchRole(route.params.role) ? route.params.role : 'sales')
const queue = computed(() => {
  const value = route.query.queue ?? defaultWorkbenchQueue(role.value)
  return isFopOrderQueue(value) && workbenchQueues[role.value].includes(value) ? value : undefined
})
const approvalQueue = computed<ApprovalQueue | undefined>(() => queue.value === 'review' || queue.value === 'allocation_review' ? queue.value : undefined)
const selectedOrders = ref<string[]>([])
const exporting = ref<'selected' | 'filtered'>()
const exportFeedback = ref('')
const exportFailed = ref(false)
let exportController: AbortController | undefined
function cancelExport() { exportController?.abort(); exportController = undefined; exporting.value = undefined; exportFeedback.value = '' }
function currentFilters(): Omit<FopOrderQuery, 'page' | 'pageSize'> {
  return { queue: queue.value!, warehouseStage: queue.value === 'shipping' ? warehouseStage.value : undefined, departmentId: departmentId.value || undefined,
    search: typeof route.query.search === 'string' ? route.query.search : '', orderNumber: typeof route.query.orderNumber === 'string' ? route.query.orderNumber : undefined,
    paidAtOrder: paidAtOrder.value, sortBy: isFopOrderSortBy(route.query.sortBy) ? route.query.sortBy : undefined,
    sortOrder: route.query.sortOrder === 'asc' || route.query.sortOrder === 'desc' ? route.query.sortOrder : undefined }
}
async function exportOrders(mode: 'selected' | 'filtered') {
  if (exporting.value || busy.value || !online.value || !queue.value || !data.value?.total || (mode === 'selected' && !selectedOrders.value.length)) return
  const controller = new AbortController()
  exportController = controller
  const session = captureSession()
  const label = labels.value[queue.value]
  exporting.value = mode
  exportFeedback.value = ''
  exportFailed.value = false
  try {
    const filters = currentFilters()
    const blob = await exportFopOrders(mode === 'selected' ? { ...filters, mode, orderIds: [...selectedOrders.value] } : { ...filters, mode }, controller.signal)
    if (controller.signal.aborted || !isCurrentSession(session)) return
    const timestamp = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19).replace(/[:T]/g, '-')
    downloadBlob(blob, `${label}_${mode === 'selected' ? '所选订单' : '筛选结果'}_${timestamp}.xlsx`)
    exportFeedback.value = text('Excel 已生成，下载已开始。', 'Excel is ready. Download started.')
  } catch (cause) {
    if (controller.signal.aborted || !isCurrentSession(session)) return
    exportFailed.value = true
    exportFeedback.value = fopExportError(cause, zh.value)
  } finally {
    if (exportController === controller) { exporting.value = undefined; exportController = undefined }
  }
}
const approvalOrders = ref<string[]>()
const approvalFinished = ref(false)
let releaseApprovalNavigation: (() => void) | undefined
watch(approvalOrders, value => { releaseApprovalNavigation?.(); releaseApprovalNavigation = value ? lockApprovalNavigation() : undefined }, { flush: 'sync' })
const offApprovalSession = onSessionReset(() => { cancelExport(); selectedOrders.value = []; approvalOrders.value = undefined })
onBeforeRouteLeave(() => !approvalOrders.value)
onBeforeRouteUpdate(() => !approvalOrders.value)
const pageSelected = computed(() => !!data.value?.items.length && data.value.items.every(row => selectedOrders.value.includes(row.id)))
function togglePage(checked: boolean) { selectedOrders.value = checked ? data.value?.items.map(row => row.id) ?? [] : [] }
function approvalCompleted() { approvalFinished.value = true; selectedOrders.value = [] }
function closeApproval() { const refresh = approvalFinished.value; approvalOrders.value = undefined; approvalFinished.value = false; if (refresh) void load() }
const isProcurement = computed(() => queue.value === 'procurement' || queue.value === 'procurement_shipping')
const isAllocation = computed(() => queue.value === 'allocation' || queue.value === 'allocation_review')
const warehouseStage = computed(() => isWarehouseStage(route.query.warehouseStage) ? route.query.warehouseStage : 'all')
const labels = computed(() => ({ unpaid: text('待支付', 'Pending payment'), procurement_shipping: text('已采购待发货', 'Purchased · shipment pending'), allocation_review: text('已齐套待审核', 'Fully allocated · approval pending'), procurement: text('待采购', 'Pending purchase'), review: text('待审核', 'Pending review'), allocation: text('待配货', 'Pending allocation'), dispatch: text('待履约', 'Pending fulfillment'), shipping: text('待出库', 'Pending outbound'), exceptions: text('异常订单', 'Order exceptions') }))
const columns = computed(() => ({ unpaid: text('审核状态', 'Review status'), procurement_shipping: text('供应商发货状态', 'Supplier shipment status'), allocation_review: text('配货单状态', 'Allocation document status'), procurement: text('供应商发货状态', 'Supplier shipment status'), review: text('审核状态', 'Review status'), allocation: text('配货单状态', 'Allocation document status'), dispatch: text('Shopify 履约状态', 'Shopify fulfillment status'), shipping: text('出库状态', 'Outbound status'), exceptions: text('异常原因', 'Exception reason') }))
const descriptions = computed(() => ({
  unpaid: text('尚未付款的履约订单，跟进客户付款进度。', 'Unpaid fulfillment orders awaiting customer payment.'),
  procurement: text('采购尚未完成下单或付款的履约订单，含采购进度待确认。', 'Fulfillment orders awaiting purchase placement or payment, including unconfirmed purchase progress.'),
  procurement_shipping: text('采购已完成下单并付清采购款，供应商尚未全部发货的履约订单。', 'Fully ordered and paid purchases awaiting complete supplier shipment.'),
  allocation_review: text('配货已齐套、配货单尚未审核的履约订单，可查看关联发运单审核进度。', 'Fully allocated orders awaiting allocation approval, with linked dispatch review progress.'),
  review: text('已付款、等待审核的履约订单。', 'Paid fulfillment orders awaiting review.'),
  allocation: text('库存未齐套、尚未完成配货的履约订单。', 'Fulfillment orders awaiting complete stock allocation.'),
  dispatch: text('已审核、等待同步 Shopify 发货的履约订单。', 'Approved fulfillment orders awaiting Shopify fulfillment synchronization.'),
  shipping: text('两组待办：配货单已齐套未审核；配货单已审核未出库（含部分出库）。', 'Two groups: fully allocated awaiting approval; approved awaiting outbound completion, including partial outbound.'),
  exceptions: text('仅显示已支付、尚未发货且存在异常的履约订单。', 'Paid, unshipped fulfillment orders with an active exception.'),
}))
function allocationLabel(order: FopOrder) {
  const progress = order.fulfillmentProgress
  if (progress.stockReadiness === 'incomplete') return text('未齐套，未配货', 'Not fully allocated')
  if (progress.stockReadiness === 'ready' && progress.allocationReview === 'approved') return text('已审核未出库', 'Approved · outbound pending')
  if (progress.stockReadiness === 'ready' && progress.allocationReview === 'pending') return text('已齐套未审核', 'Fully allocated · approval pending')
  return text('待确认', 'Unconfirmed')
}
function queueStatus(order: FopOrder) {
  const progress = order.fulfillmentProgress
  switch (queue.value) {
    case 'unpaid': return order.reviewStatus === 'approved' ? text('已审核', 'Approved') : text('未审核', 'Not reviewed')
    case 'review': return text('待审核', 'Pending review')
    case 'dispatch': return progress.shopifySync === 'partial' ? text('部分同步 · 待完成', 'Partially synced · pending') : text('待同步 Shopify 发货', 'Shopify sync pending')
    case 'procurement_shipping':
    case 'procurement': return progress.supplierShipment === 'partial' ? text('供应商部分发货', 'Supplier partially shipped') : text('供应商未发货', 'Supplier shipment pending')
    case 'allocation_review':
    case 'allocation': return allocationLabel(order)
    case 'shipping': return progress.allocationReview === 'pending' ? text('待配货审核', 'Awaiting allocation approval') : progress.outbound === 'partial' ? text('部分出库 · 待完成', 'Partially outbound · pending') : text('配货已完成 · 待出库', 'Allocation approved · outbound pending')
    case 'exceptions': return order.exception ? reasons.value[order.exception.reason] : '—'
    default: return '—'
  }
}
const reasons = computed(() => ({ stock: text('库存不足', 'Insufficient stock'), address: text('地址待核验', 'Address verification'), tracking: text('物流单号异常', 'Tracking issue') }))
const payments = computed(() => ({ paid: text('已支付', 'Paid'), unpaid: text('未支付', 'Unpaid'), refunded: text('已退款', 'Refunded') }))
const search = ref('')
const data = ref<FopQueuePage>()
const departmentId = computed(() => typeof route.query.departmentId === 'string' ? route.query.departmentId : '')
const departments = computed(() => data.value?.departments ?? [])
const followUpOrder = ref<{ id: string; orderNumber: string }>()
watch(() => route.fullPath, () => { followUpOrder.value = undefined })
const busy = ref(false)
const error = ref('')
const online = ref(navigator.onLine)
const visible = ref(document.visibilityState === 'visible')
const copiedValue = ref('')
const copyMessage = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let recoveringPage = false
const failedImages = ref(new Set<string>())
const page = computed(() => Number(route.query.page || 1))
const pageSize = computed(() => Number(route.query.pageSize || 50))
const sortBy = computed<FopOrderSortBy>(() => isFopOrderSortBy(route.query.sortBy) ? route.query.sortBy : 'paidAt')
const sortOrder = computed(() => route.query.sortOrder === 'desc' ? 'desc' : route.query.sortOrder === 'asc' ? 'asc' : sortBy.value === 'paidAt' && route.query.paidAtOrder === 'desc' ? 'desc' : 'asc')
const paidAtOrder = computed(() => sortBy.value === 'paidAt' ? sortOrder.value : 'asc')
const leadingSortField = computed<FopOrderSortBy | undefined>(() => isAllocation.value || queue.value === 'dispatch' ? 'dispatchDocumentStatus' : queue.value === 'shipping' ? 'allocationDocumentStatus' : undefined)
const mainSortField = computed<FopOrderSortBy | undefined>(() => isAllocation.value ? 'allocationDocumentStatus' : queue.value === 'shipping' ? 'outboundStatus' : undefined)
const dispatchSortHint = computed(() => text('未生成 → 暂存 → 已提交 → 已审核；多单取最早进度；含未知状态的订单置后', 'No document → Draft → Submitted → Approved; earliest document stage; orders with unknown statuses last'))
function sortDirection(field: FopOrderSortBy) { return sortBy.value === field ? sortOrder.value : undefined }
function sortStatus(field: FopOrderSortBy) {
  return navigate({ sortBy: field, sortOrder: sortBy.value === field && sortOrder.value === 'asc' ? 'desc' : 'asc', page: 1 })
}
function sortPayment() {
  return navigate({ sortBy: undefined, sortOrder: undefined, paidAtOrder: sortBy.value === 'paidAt' && paidAtOrder.value === 'asc' ? 'desc' : 'asc', page: 1 })
}
const sortHint = computed(() => sortBy.value !== 'paidAt' ? text('点击按最早收款在前排序', 'Click for oldest payment first') : paidAtOrder.value === 'asc'
  ? text('最早收款在前，点击切换为最新收款在前', 'Oldest payment first; click for newest first')
  : text('最新收款在前，点击切换为最早收款在前', 'Newest payment first; click for oldest first'))
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize.value)))
const columnsThroughAmount = 11
const columnsAfterAmount = computed(() => queue.value === 'exceptions' || queue.value === 'procurement_shipping' ? 5 : queue.value === 'dispatch' || queue.value === 'shipping' ? 6 : 4)
let requestId = 0

async function load(reset = false) {
  // The access guard temporarily unmounts this child before committing navigation.
  // Do not fetch/recover the old page again if it remounts in that interval.
  if (props.searchRecovery?.from === route.fullPath) { busy.value = true; return }
  if (!reset && busy.value) return
  const currentRequest = ++requestId
  if (reset) {
    data.value = undefined
    selectedOrders.value = []
    if (props.searchRecovery?.to === route.fullPath) {
      search.value = props.searchRecovery.search
      emit('clear-search-recovery', props.searchRecovery.token)
    } else if (!recoveringPage) search.value = typeof route.query.search === 'string' ? route.query.search : ''
    recoveringPage = false
  }
  error.value = ''
  if (!queue.value) {
    busy.value = false
    error.value = text('无效的清单类型，请在当前工作台重新选择。', 'Invalid list type. Select a list in this workbench.')
    return
  }
  if (!Number.isInteger(page.value) || page.value < 1 || ![20, 50, 100].includes(pageSize.value)) {
    busy.value = false
    error.value = text('分页参数无效，请重新选择清单。', 'Invalid pagination. Select the queue again.')
    return
  }
  if ((route.query.sortBy !== undefined && (!isFopOrderSortBy(route.query.sortBy) || !canSortFopQueue(queue.value, route.query.sortBy)))
    || (route.query.sortOrder !== undefined && route.query.sortOrder !== 'asc' && route.query.sortOrder !== 'desc')) {
    busy.value = false
    error.value = text('排序参数无效，请重新选择清单。', 'Invalid sort. Select the queue again.')
    return
  }
  if (route.query.paidAtOrder !== undefined && route.query.paidAtOrder !== 'asc' && route.query.paidAtOrder !== 'desc') {
    busy.value = false
    error.value = text('排序参数无效，请重新选择清单。', 'Invalid sort order. Select the queue again.')
    return
  }
  if (route.query.departmentId !== undefined && (typeof route.query.departmentId !== 'string' || departmentId.value.length > 128)) {
    busy.value = false
    error.value = text('部门筛选无效，请重新选择。', 'Invalid department filter. Please select a department again.')
    return
  }
  if (route.query.warehouseStage !== undefined && (queue.value !== 'shipping' || !isWarehouseStage(route.query.warehouseStage))) {
    busy.value = false
    error.value = text('出库阶段筛选无效，请重新选择。', 'Invalid outbound stage. Please select again.')
    return
  }
  busy.value = true
  const selectedQueue = queue.value
  try {
    const result = await getFopOrders({ ...currentFilters(), page: page.value, pageSize: pageSize.value })
    if (currentRequest !== requestId) return
    if (!result.items.every(order => matchesFopQueue(order, selectedQueue, warehouseStage.value))) throw new Error('Unexpected queue data')
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > lastPage) {
      recoveringPage = true
      const location = workbenchOrderLocation(selectedQueue, { ...route.query, page: lastPage })
      const recovery = { token: Symbol('page-recovery'), from: route.fullPath, to: router.resolve(location).fullPath, search: search.value }
      if (props.recoverPage) await props.recoverPage(recovery)
      else await router.replace(location)
      return
    }
    data.value = result
    selectedOrders.value = selectedOrders.value.filter(id => result.items.some(row => row.id === id))
  } catch (cause) {
    if (currentRequest === requestId) {
      data.value = undefined
      error.value = fopAccessError(cause, zh.value)
    }
  } finally {
    if (currentRequest === requestId) busy.value = false
  }
}
function refreshIfActive() {
  online.value = navigator.onLine
  visible.value = document.visibilityState === 'visible'
  if (!approvalOrders.value && !exporting.value && online.value && visible.value && queue.value) void load()
}
watch(() => route.fullPath, () => { cancelExport(); void load(true) }, { immediate: true })
watch(() => props.searchRecovery, (next, previous) => {
  if (!next && previous?.from === route.fullPath) {
    busy.value = false
    search.value = previous.search
    error.value = text('页码更新未完成，请刷新重试。', 'Page update was not completed. Refresh to retry.')
  }
})
onMounted(() => {
  refreshTimer = setInterval(refreshIfActive, 30_000)
  document.addEventListener('visibilitychange', refreshIfActive)
  window.addEventListener('focus', refreshIfActive)
  window.addEventListener('online', refreshIfActive)
  window.addEventListener('offline', refreshIfActive)
})
onBeforeUnmount(() => {
  cancelExport()
  releaseApprovalNavigation?.()
  offApprovalSession()
  requestId++
  clearInterval(refreshTimer)
  clearTimeout(copyTimer)
  document.removeEventListener('visibilitychange', refreshIfActive)
  window.removeEventListener('focus', refreshIfActive)
  window.removeEventListener('online', refreshIfActive)
  window.removeEventListener('offline', refreshIfActive)
})
async function copyOrderValue(order: FopOrder, field: 'orderNumber' | 'customerName') {
  const label = field === 'orderNumber' ? text('订单编号', 'Order number') : text('客户名称', 'Customer name')
  try {
    await copyText(order[field])
    copiedValue.value = `${field}:${order.id}`
    copyMessage.value = text(`${label}已复制`, `${label} copied`)
  } catch {
    copiedValue.value = ''
    copyMessage.value = text(`复制失败，请选中${label}手动复制`, `Copy failed. Select the ${label.toLowerCase()} and copy it manually.`)
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedValue.value = ''; copyMessage.value = '' }, 2400)
}
const refreshedTime = computed(() => data.value?.refreshedAt ? new Date(data.value.refreshedAt).toLocaleTimeString(zh.value ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) : '')
function navigate(values: Record<string, string | number | undefined>) {
  if (!queue.value) return
  return router.push(workbenchOrderLocation(queue.value, { ...route.query, ...values }))
}
function submitSearch() { return navigate({ search: search.value.trim() || undefined, page: 1 }) }
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString(zh.value ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const formatMoney = (amount: number, currency: string) => formatCurrency(amount, currency, zh.value ? 'zh-CN' : 'en-US')
</script>

<template>
  <div class="fulfillment-page" :aria-busy="busy">
      <header class="list-heading">
        <div><h2>{{ queue ? labels[queue] : text('履约订单', 'Fulfillment orders') }}{{ queue && !['exceptions', 'allocation_review', 'procurement_shipping'].includes(queue) ? text('清单', ' orders') : '' }} <span v-if="data?.source === 'mock'" class="source-badge">MOCK</span></h2><p class="description">{{ queue ? descriptions[queue] : '' }}</p></div>
        <div class="refresh-controls"><button class="action-button refresh-orders" :disabled="busy || !queue || !online" @click="load()"><RefreshCw :size="15" :class="{ 'animate-spin': busy }" />{{ busy ? text('刷新中…', 'Refreshing…') : text('刷新', 'Refresh') }}</button><span class="refresh-status" :class="{ 'sync-paused': !online }">{{ !online ? text('网络已断开 · 自动刷新暂停', 'Offline · Auto-refresh paused') : !visible ? text('页面未激活 · 自动刷新暂停', 'Page inactive · Auto-refresh paused') : text('每 30 秒自动刷新', 'Refreshes every 30 seconds') }}<template v-if="refreshedTime"><br />{{ text('最近刷新', 'Last refreshed') }} {{ refreshedTime }} · UTC+8</template></span></div>
      </header>
      <p v-if="!approvalQueue" class="read-only-note">{{ text('仅查看履约进度，业务处理请在 FOP 完成。', 'View fulfillment progress here. Complete business actions in FOP.') }}</p>
      <p v-if="copyMessage" class="copy-feedback" role="status">{{ copyMessage }}</p>
      <section class="list-panel">
        <div class="approval-toolbar">
          <button v-if="approvalQueue" class="action-button primary" data-testid="open-approval" :disabled="busy || !!exporting || !online || !selectedOrders.length" @click="approvalOrders = [...selectedOrders]">{{ text('审核', 'Approve') }}<template v-if="selectedOrders.length"> · {{ selectedOrders.length }}</template></button>
          <span>{{ text(`已选 ${selectedOrders.length} 笔 · 全选仅选当前页`, `${selectedOrders.length} selected · Select all applies to this page`) }}</span>
          <button v-if="selectedOrders.length" class="clear-selection" @click="selectedOrders = []">{{ text('清空', 'Clear') }}</button>
          <div class="export-actions">
            <button class="action-button" data-testid="export-selected" :disabled="busy || !!exporting || !online || !selectedOrders.length || !data" @click="exportOrders('selected')"><Download :size="15" />{{ exporting === 'selected' ? text('导出中…', 'Exporting…') : text('导出所选', 'Export selected') }}</button>
            <button class="action-button" data-testid="export-filtered" :disabled="busy || !!exporting || !online || !data?.total" :title="text('导出当前筛选下的全部订单，包含其他分页', 'Export all matching orders across every page')" @click="exportOrders('filtered')"><Download :size="15" />{{ exporting === 'filtered' ? text('导出中…', 'Exporting…') : text('导出筛选结果', 'Export filtered results') }}</button>
          </div>
        </div>
        <p v-if="exportFeedback" class="export-feedback" :class="{ 'export-error': exportFailed }" :role="exportFailed ? 'alert' : 'status'">{{ exportFeedback }}</p>
        <div class="list-toolbar">
          <label v-if="queue === 'shipping'" class="department-filter outbound-stage-filter"><span>{{ text('出库阶段', 'Outbound stage') }}</span><select :value="warehouseStage" :disabled="busy" :aria-label="text('出库阶段', 'Outbound stage')" @change="navigate({ warehouseStage: ($event.target as HTMLSelectElement).value, page: 1 })"><option value="all">{{ text('全部待出库', 'All pending outbound') }}</option><option value="pending_review">{{ text('已齐套未审核', 'Fully allocated · approval pending') }}</option><option value="pending_outbound">{{ text('已审核未出库', 'Approved · outbound pending') }}</option></select></label>
          <form class="search-form" @submit.prevent="submitSearch"><label class="search-field"><Search :size="16" /><input v-model="search" type="search" :aria-label="text('搜索履约订单', 'Search fulfillment orders')" :placeholder="text('订单编号 / Shopify 单号 / 客户 / 店铺 / SKU', 'Order / Shopify order / customer / store / SKU')" /></label><button class="action-button primary" :disabled="busy || !queue">{{ text('查询', 'Search') }}</button></form>
          <span class="result-count" aria-live="polite">{{ data ? text(`共 ${data.total} 笔订单`, `${data.total} orders`) : '—' }}</span>
          <label class="department-filter"><span>{{ text('所属部门', 'Department') }}</span><select :value="departmentId" :disabled="busy || !queue" :aria-label="text('所属部门', 'Department')" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部部门', 'All departments') }}</option><option v-if="departmentId && !departments.some(item => item.id === departmentId)" :value="departmentId" disabled>{{ text('所选部门', 'Selected department') }}</option><option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
        </div>
        <div v-if="route.query.orderNumber" class="exact-filter"><span>{{ text('指定订单', 'Selected order') }}：{{ route.query.orderNumber }}</span><button @click="navigate({ orderNumber: undefined, page: 1 })">{{ text('查看该类全部订单', 'View all orders in this queue') }}</button></div>
        <p v-if="error" class="state-message error-message" role="alert">{{ text('刷新未成功，当前进度暂不可用。', 'Refresh failed; current progress is unavailable.') }} {{ error }} <button v-if="queue" @click="load()">{{ text('重试', 'Retry') }}</button></p>
        <div v-else-if="busy && !data" class="state-message" role="status"><RefreshCw class="animate-spin" :size="22" />{{ text('正在加载订单…', 'Loading orders…') }}</div>
        <template v-else-if="data && queue">
          <div class="table-scroll" tabindex="0" :aria-label="text('履约订单明细表，可横向滚动', 'Fulfillment orders, scroll horizontally for more fields')">
            <table>
              <thead><tr><th class="order-cell"><input type="checkbox" class="order-checkbox" :checked="pageSelected" :indeterminate="!!selectedOrders.length && !pageSelected" :disabled="busy || !data.items.length" :aria-label="text('全选当前页订单', 'Select all orders on this page')" @change="togglePage(($event.target as HTMLInputElement).checked)" />{{ text('订单编号', 'Order number') }}</th><th class="product-cell">{{ text('商品图片 / 商品信息', 'Product image / details') }}</th><th>{{ text('Shopify 单号', 'Shopify order') }}</th><th>{{ text('客户名称', 'Customer') }}</th><th :aria-sort="sortBy !== 'paidAt' ? 'none' : paidAtOrder === 'asc' ? 'ascending' : 'descending'"><button type="button" class="sort-payment" :disabled="busy" :title="`${sortHint}（UTC+8）`" :aria-label="`${text('收款日期', 'Payment date')}：${sortHint}`" @click="sortPayment()">{{ text('收款日期', 'Payment date') }}<component :is="sortBy !== 'paidAt' ? ArrowUpDown : paidAtOrder === 'asc' ? ArrowUp : ArrowDown" :size="13" aria-hidden="true" /></button></th><OrderSortHeader v-if="leadingSortField" :label="leadingSortField === 'dispatchDocumentStatus' ? text('发运单状态', 'Dispatch document status') : text('配货单状态', 'Allocation document status')" :direction="sortDirection(leadingSortField)" :disabled="busy" :hint="leadingSortField === 'dispatchDocumentStatus' ? dispatchSortHint : undefined" @sort="sortStatus(leadingSortField)" /><th v-else>{{ isProcurement ? text('采购订单状态', 'Purchase order status') : text('支付状态', 'Payment status') }}</th><OrderSortHeader v-if="mainSortField" :label="columns[queue]" :direction="sortDirection(mainSortField)" :disabled="busy" @sort="sortStatus(mainSortField)" /><th v-else>{{ columns[queue] }}</th><th>{{ text('店铺', 'Store') }}</th><th>{{ text('本地 SKU / 规格', 'Local SKU / variant') }}</th><th>{{ text('数量', 'Quantity') }}</th><th>{{ text('订单金额', 'Order amount') }}</th><th v-if="queue === 'exceptions'">{{ text('异常时长', 'Exception age') }}</th><th>{{ text('发货仓库', 'Warehouse') }}</th><th v-if="queue === 'dispatch' || queue === 'shipping'">{{ text('物流商', 'Carrier') }}</th><th v-if="queue === 'dispatch' || queue === 'shipping'">{{ text('跟踪号', 'Tracking number') }}</th><th>{{ text('业务员', 'Salesperson') }}</th><th>{{ text('所属部门', 'Department') }}</th><th>{{ text('创建时间', 'Created at') }}</th><th v-if="queue === 'procurement_shipping'" class="follow-up-cell">{{ text('操作', 'Action') }}</th></tr></thead>
              <tbody><tr v-for="order in data.items" :key="order.id">
                <td class="order-cell"><input v-model="selectedOrders" type="checkbox" class="order-checkbox" :value="order.id" :disabled="busy" :aria-label="`${text('选择订单', 'Select order')} ${order.orderNumber}`" /><button type="button" class="copy-order" :aria-label="`${text('复制订单编号', 'Copy order number')} ${order.orderNumber}`" :title="text('复制订单编号', 'Copy order number')" @click="copyOrderValue(order, 'orderNumber')"><strong>{{ order.orderNumber }}</strong><Check v-if="copiedValue === `orderNumber:${order.id}`" :size="14" /><Copy v-else :size="14" /></button><span v-if="order.items.length > 1" class="multi-item-badge">{{ text(`${order.items.length} 款商品 · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} 件`, `${order.items.length} products · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} units`) }}</span></td><td class="product-cell"><div v-for="(item, index) in order.items" :key="index" class="product"><img v-if="item.imageUrl && !failedImages.has(item.imageUrl)" :src="item.imageUrl" :alt="item.name" loading="lazy" @error="failedImages.add(item.imageUrl!)" /><span v-else class="image-fallback"><PackageSearch :size="20" /></span><span :title="item.name">{{ item.name }}</span></div></td><td class="mono">{{ order.shopifyOrderNumber }}</td><td><button type="button" class="copy-customer" :aria-label="`${text('复制客户名称', 'Copy customer name')} ${order.customerName}`" :title="text('复制客户名称', 'Copy customer name')" @click="copyOrderValue(order, 'customerName')"><span>{{ order.customerName }}</span><Check v-if="copiedValue === `customerName:${order.id}`" :size="14" /><Copy v-else :size="14" /></button></td><td>{{ formatDate(order.paidAt) }}</td>

                <td v-if="isProcurement"><ProcurementStatus :progress="order.procurementProgress" :shipment="order.fulfillmentProgress.supplierShipment" /></td>
                <td v-else-if="queue === 'dispatch' || isAllocation"><DispatchStatus :documents="order.dispatchDocuments" /></td>
                <td v-else-if="queue === 'shipping'"><span class="status-pill" :class="order.fulfillmentProgress.allocationReview === 'pending' ? 'tone-warning' : 'tone-success'">{{ allocationLabel(order) }}</span></td>
                <td v-else><span class="status-pill" :class="order.paymentStatus">{{ payments[order.paymentStatus] }}</span></td>
                <td><span class="status-pill" :class="queue === 'allocation' && order.fulfillmentProgress.stockReadiness === 'incomplete' ? 'tone-warning' : 'pending'">{{ queueStatus(order) }}</span></td><td>{{ order.storeName }}</td>
                <td><div v-for="(item, index) in order.items" :key="index" class="sku-item"><strong>{{ item.sku }}</strong><small>{{ item.variant }}</small></div></td>
                <td><div v-for="(item, index) in order.items" :key="index" class="quantity-item">{{ item.quantity }}</div></td><td class="money">{{ formatMoney(order.amount, order.currency) }}</td>

                <td v-if="queue === 'exceptions'">{{ order.exception?.hours }}h</td><td>{{ order.warehouse }}</td><td v-if="queue === 'dispatch' || queue === 'shipping'">{{ order.carrier || '—' }}</td><td v-if="queue === 'dispatch' || queue === 'shipping'" class="mono">{{ order.trackingNumber || '—' }}</td><td>{{ order.owner?.name || order.salesperson }}</td><td><RouterLink v-if="order.department" :to="{ name: 'Organization', query: { node: order.department.id } }" class="text-indigo-600">{{ order.department.name }}</RouterLink><span v-else>—</span></td><td>{{ formatDate(order.createdAt) }}</td>
              <td v-if="queue === 'procurement_shipping'" class="follow-up-cell"><button type="button" class="follow-up-order" :disabled="!online" :aria-label="`${text('催办', 'Follow up')} ${order.orderNumber}`" @click="followUpOrder = { id: order.id, orderNumber: order.orderNumber }"><MessageCircle :size="14" />{{ text('催办', 'Follow up') }}</button></td></tr><tr v-if="!data.items.length"><td :colspan="columnsThroughAmount + columnsAfterAmount"><div class="state-message" role="status"><PackageSearch :size="36" /><strong>{{ text('暂无符合条件的订单', 'No matching orders') }}</strong><span>{{ text('请调整搜索条件，或切换上方清单。', 'Adjust your search or select another queue.') }}</span></div></td></tr></tbody>
              <TableTotals>
                <th scope="row">{{ text('筛选合计', 'Filtered total') }} · {{ data.totals?.orderCount.toLocaleString() ?? '—' }} {{ text('笔订单', 'orders') }}</th>
                <td :colspan="columnsThroughAmount - 3" />
                <td class="quantity-total">{{ data.totals?.itemQuantity.toLocaleString() ?? '—' }}</td>
                <td class="money"><OrderAmountTotals :totals="data.totals" /></td>
                <td :colspan="columnsAfterAmount"><small>{{ text('全部筛选结果 · 金额按币种汇总', 'All filtered results · Amounts grouped by currency') }}</small></td>
              </TableTotals>
            </table>
          </div>
          <footer class="pagination"><span>{{ text('按订单分页，多商品在同一订单中展示', 'Paginated by order; items stay grouped') }}</span><div><label>{{ text('每页', 'Per page') }}<select :value="pageSize" :aria-label="text('每页条数', 'Page size')" @change="navigate({ pageSize: ($event.target as HTMLSelectElement).value, page: 1 })"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option></select></label><button :disabled="page <= 1" :aria-label="text('上一页', 'Previous page')" @click="navigate({ page: page - 1 })"><ChevronLeft :size="16" /></button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" :aria-label="text('下一页', 'Next page')" @click="navigate({ page: page + 1 })"><ChevronRight :size="16" /></button></div></footer>
        </template>
      </section>
      <p v-if="data?.source === 'mock'" class="demo-note">{{ text('当前为演示订单，非真实履约业务数据。', 'Demo orders only; these are not live fulfillment records.') }}</p>
    <OrderApprovalDialog v-if="approvalOrders && approvalQueue" :queue="approvalQueue" :order-ids="approvalOrders" @completed="approvalCompleted" @close="closeApproval" />
    <SupplierFollowUpDialog v-if="followUpOrder" :key="followUpOrder.id" :order-id="followUpOrder.id" :order-number="followUpOrder.orderNumber" @close="followUpOrder = undefined" />
  </div>
</template>

<style scoped>
.approval-toolbar{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--color-border);background:color-mix(in srgb,var(--color-chart-link) 4%,var(--color-surface));font-size:12px;color:var(--color-text-secondary)}.export-actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto}.export-feedback{margin:0;padding:10px 20px;color:var(--color-text-secondary);font-size:12px;border-bottom:1px solid var(--color-border)}.export-error{color:var(--color-warning,#c69568)}.clear-selection{color:var(--color-chart-link)}input.order-checkbox{width:15px;height:15px;min-width:15px;margin-right:10px;padding:0;vertical-align:middle;accent-color:#8398c9}.action-button:disabled{opacity:.45;cursor:not-allowed}

.follow-up-cell{position:sticky;right:0;z-index:2;background:var(--color-surface);min-width:90px;box-shadow:-1px 0 0 var(--color-border)}
.follow-up-order{display:inline-flex;align-items:center;gap:5px;color:var(--color-chart-link);padding:6px 9px;border-radius:6px;background:color-mix(in srgb,var(--color-chart-link) 9%,transparent);white-space:nowrap}
.follow-up-order:hover{background:color-mix(in srgb,var(--color-chart-link) 16%,transparent)}
.follow-up-order:disabled{opacity:.45;cursor:not-allowed}

.fulfillment-page { color: var(--color-text, #243247); }
.back-link { display: inline-flex; align-items: center; gap: 7px; color: #718096; font-size: 12px; margin-bottom: 22px; }
.back-link:hover { color: #5873d4; }
.list-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 16px; }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .15em; color: #7a8ba2; margin-bottom: 8px; }
h2 { display: flex; gap: 12px; align-items: center; font-size: 21px; font-weight: 750; letter-spacing: -.03em; }
.description { margin-top: 8px; font-size: 12px; color: #8490a3; line-height: 1.7; }
.source-badge { border: 1px solid #f4d59a; color: #ae7616; background: #fff8e8; border-radius: 5px; padding: 3px 7px; font-size: 10px; letter-spacing: .06em; }
.action-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--color-border); background: var(--color-surface); border-radius: 6px; padding: 9px 14px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.primary { background: #5873d4; border-color: #5873d4; color: white; }
.queue-tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 18px; }
.queue-tabs a { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 11px 17px; border: 1px solid transparent; border-radius: 6px; color: #8490a3; font-size: 13px; white-space: nowrap; }
.queue-tabs a.active { background: var(--color-surface); border-color: var(--color-border); color: #5873d4; font-weight: 700; box-shadow: 0 2px 5px #23375805; }
.list-panel { border: 1px solid var(--color-border); border-radius: 9px; overflow: hidden; background: var(--color-surface); }
.list-toolbar { padding: 18px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.department-filter { display: flex; align-items: center; gap: 10px; color: var(--color-text-secondary); font-size: 12px; margin-left: auto; white-space: nowrap; }
.outbound-stage-filter { margin-left: 0; }
.department-filter select { min-width: 160px; max-width: 280px; padding: 9px 28px 9px 12px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text); font-size: 12px; }
.search-form { display: flex; gap: 8px; flex: 1; max-width: 640px; }
.search-field { display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 6px; color: #8a96a8; flex: 1; min-width: 0; }
input { width: 100%; min-width: 0; background: transparent; color: var(--color-text); border: 0; padding: 10px 0; font-size: 12px; }
.result-count { white-space: nowrap; color: #8490a3; font-size: 12px; }
.exact-filter { padding: 0 20px 16px; display: flex; gap: 16px; font-size: 12px; }
.exact-filter button, .error-message button { color: #5873d4; text-decoration: underline; }
.table-scroll { overflow-x: auto; border-top: 1px solid var(--color-border); }
table { width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; white-space: nowrap; font-size: 12px; }
th { position: sticky; top: 0; z-index: 2; background: var(--color-surface); color: #8490a3; font-size: 11px; font-weight: 600; padding: 14px 16px; border-bottom: 1px solid var(--color-border); }
td { border-bottom: 1px solid var(--color-border); padding: 8px 14px; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--color-surface) 94%, #5873d4); }
.order-cell { position: sticky; left: 0; background: var(--color-surface); z-index: 1; min-width: 170px; border-right: 1px solid var(--color-border); }
th.order-cell { z-index: 3; }
.order-cell strong { color: var(--color-chart-link); font-size: 12px; font-weight: 600; }
.product-cell { min-width: 270px; max-width: 320px; }
.product { display: flex; align-items: center; gap: 10px; height: 72px; }
.product > span:last-child { max-width: 200px; white-space: normal; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.product img, .image-fallback { width: 42px; height: 42px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.image-fallback { display: flex; align-items: center; justify-content: center; background: #e5eaf1; color: #8893a5; }
.sku-item { height: 72px; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.sku-item strong { font-weight: 500; font-size: 11px; }.sku-item small { color: #8490a3; font-size: 10px; }
.quantity-item { height: 72px; display: flex; align-items: center; }.money, .mono { font-variant-numeric: tabular-nums; }
.status-pill { display: inline-flex; border-radius: 4px; padding: 4px 7px; font-size: 11px; white-space: nowrap; }
.paid { color: #0f9874; background: #14b8a612; }.unpaid, .refunded { color: #b57b20; background: #f59e0b12; }.pending { color: #5873d4; background: #5873d412; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--color-border); padding: 14px 20px; color: #8490a3; font-size: 11px; }
.pagination div, .pagination label { display: flex; align-items: center; gap: 12px; }.pagination button { padding: 5px; }.pagination select { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; padding: 4px; }
.state-message { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #8490a3; font-size: 13px; padding: 24px; text-align: center; }.error-message { color: #dc6767; }
.demo-note { margin-top: 14px; color: #8a96a8; font-size: 11px; }
button:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 700px) { .list-heading { align-items: flex-start; }h2 { font-size: 23px; }.list-toolbar { flex-wrap: wrap; padding: 14px; }.search-form { flex-basis: 100%; }.pagination { flex-wrap: wrap; padding: 14px; }.queue-tabs a { padding: 9px 12px; }.order-cell { position: static; }.exact-filter { flex-wrap: wrap; } }

.dark .source-badge { color: #ebc781; background: #352e23; border-color: #5b4d31; }
.dark .paid { color: #79d2b8; background: #203b38; }
.dark .unpaid, .dark .refunded { color: #e5bc7f; background: #392f23; }
.dark .pending { color: #b2c5f6; background: #25344f; }
.dark .image-fallback { background: #253347; color: #b5c4d9; }

.refresh-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.refresh-status { color: var(--color-text-secondary); font-size: 11px; line-height: 1.8; }
.sync-paused { color: #c68e45; }
.read-only-note { color: var(--color-text-secondary); font-size: 12px; margin: -5px 0 16px; }
.copy-order, .copy-customer { display: inline-flex; align-items: center; gap: 8px; text-align: left; user-select: text; }
.copy-order svg, .copy-customer svg { color: var(--color-text-secondary); flex-shrink: 0; }
.copy-order:hover svg, .copy-customer:hover svg { color: #91a9e9; }
.sort-payment { display: inline-flex; align-items: center; gap: 5px; color: inherit; font: inherit; cursor: pointer; }
.sort-payment svg { color: var(--color-chart-link); }
.multi-item-badge { display: block; width: fit-content; margin-top: 8px; color: var(--color-text-secondary); background: var(--color-surface-muted); border-radius: 4px; padding: 3px 6px; font-size: 10px; }
.copy-feedback { position: fixed; top: 82px; right: 24px; z-index: 70; padding: 10px 16px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 7px; box-shadow: 0 5px 20px #0002; font-size: 12px; }
.sku-item { box-sizing: border-box; overflow: hidden; }
.sku-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
@media (max-width: 700px) { .list-heading { flex-wrap: wrap; }.refresh-controls { justify-content: flex-start; } }
</style>

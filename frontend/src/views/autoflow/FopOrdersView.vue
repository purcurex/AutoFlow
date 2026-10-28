<script setup lang="ts">
import { orderTimestamp } from '@/utils/order-timestamp'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { exportFopOrders, fopExportError } from '@/api/fop-order-export'
import { downloadBlob } from '@/utils/export'
import { formatCurrency } from '@/utils/currency'
import AllocationInventoryDialog from '@/components/autoflow/AllocationInventoryDialog.vue'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import WorkbenchStatusBadge from '@/components/autoflow/WorkbenchStatusBadge.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import OrderSortHeader from '@/components/autoflow/OrderSortHeader.vue'
import SupplierShipmentStatus from '@/components/autoflow/SupplierShipmentStatus.vue'
import ProcurementStatus from '@/components/autoflow/ProcurementStatus.vue'
import { canFilterTaskStatus, getTaskStatus, taskStatusHeading, taskStatusLabel, taskStatusOptions } from '@/utils/workbench-status'
import { canFilterProcurementStage, getProcurementStage, procurementStageLabels } from '@/utils/procurement-stage'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'
import RecipientDetailsDialog from '@/components/autoflow/RecipientDetailsDialog.vue'
import ShippingCountryBadge from '@/components/autoflow/ShippingCountryBadge.vue'
import OrderLogisticsInfo from '@/components/autoflow/OrderLogisticsInfo.vue'
import TrackingNumberCopy from '@/components/autoflow/TrackingNumberCopy.vue'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'
import { lockApprovalNavigation } from '@/utils/approvalNavigation'
import DispatchStatus from '@/components/autoflow/DispatchStatus.vue'
import TableTotals from '@/components/ui/TableTotals.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ArrowDown, ArrowUpDown, Check, Copy, ChevronLeft, ChevronRight, PackageSearch, RefreshCw, Search, MessageCircle } from 'lucide-vue-next'
import { copyText } from '@/utils/copyText'
import { procurementPaymentTime } from '@/utils/procurement-payment'
import { getFopOrders, canSortFopQueue, isFopOrderSortBy, type FopOrderSortBy, isFopOrderQueue, isWarehouseStage, matchesFopQueue, type FopOrder, type FopOrderQuery, type FopQueuePage } from '@/api/fop-orders'
import { fopAccessError } from '@/api/fop-access'

import { defaultWorkbenchQueue, isWorkbenchRole, workbenchOrderLocation, workbenchQueues } from '@/utils/workbench'

type SearchRecovery = { token: symbol; from: string; to: string; search: string }
const props = defineProps<{ searchRecovery?: SearchRecovery; recoverPage?: (recovery: SearchRecovery) => Promise<void> }>()
const emit = defineEmits<{ 'clear-search-recovery': [token: symbol]; 'filter-labels': [rows: { id: string; name: string }[]] }>()
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
const selectedOrders = ref<string[]>([])
const inventoryOrderIds = ref<string[]>()
const approvalOrderIds = ref<string[]>()
const approvalQueue = computed(() => queue.value === 'review' || queue.value === 'allocation_review' ? queue.value : undefined)
const hasApprovableSelection = computed(() => selectedOrders.value.some(id => data.value?.items.some(row => row.id === id
  && (approvalQueue.value === 'review' || approvalQueue.value === 'allocation_review' && getTaskStatus(row, 'allocation_review') === 'dispatch_complete'))))
let unlockApproval: (() => void) | undefined
let approvalNeedsRefresh = false
function openApproval() {
  if (!approvalQueue.value || busy.value || !online.value || !hasApprovableSelection.value || approvalOrderIds.value) return
  approvalNeedsRefresh = false
  approvalOrderIds.value = [...selectedOrders.value]
  unlockApproval = lockApprovalNavigation()
}
function clearApproval() { approvalOrderIds.value = undefined; unlockApproval?.(); unlockApproval = undefined }
function approvalCompleted() { approvalNeedsRefresh = true; selectedOrders.value = [] }
function closeApproval() { clearApproval(); if (approvalNeedsRefresh) { approvalNeedsRefresh = false; void load() } }
function preventApprovalUnload(event: BeforeUnloadEvent) { if (approvalOrderIds.value) { event.preventDefault(); event.returnValue = '' } }
const exporting = ref<'selected' | 'filtered'>()
const exportFeedback = ref('')
const exportFailed = ref(false)
let exportController: AbortController | undefined
function cancelExport() { exportController?.abort(); exportController = undefined; exporting.value = undefined; exportFeedback.value = '' }
function currentFilters(): Omit<FopOrderQuery, 'page' | 'pageSize'> {
  return { queue: queue.value!, procurementStage: procurementStage.value, taskStatus: taskStatus.value, warehouseStage: queue.value === 'shipping' ? warehouseStage.value : undefined, departmentId: departmentId.value || undefined, ownerId: ownerId.value || undefined, warehouseCode: warehouseCode.value || undefined,
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
const offSession = onSessionReset(() => { inventoryOrderIds.value = undefined; clearApproval(); approvalNeedsRefresh = false; cancelExport(); selectedOrders.value = []; recipientOrderId.value = undefined; data.value = undefined; requestId++ })
const pageSelected = computed(() => !!data.value?.items.length && data.value.items.every(row => selectedOrders.value.includes(row.id)))
function togglePage(checked: boolean) { selectedOrders.value = checked ? data.value?.items.map(row => row.id) ?? [] : [] }
const isAllocation = computed(() => queue.value === 'allocation' || queue.value === 'allocation_review')
const showDispatchNumbers = computed(() => queue.value === 'dispatch' || isAllocation.value)
const procurementStage = computed(() => canFilterProcurementStage(queue.value ?? '', route.query.procurementStage) ? route.query.procurementStage : undefined)
const taskStatus = computed(() => canFilterTaskStatus(queue.value ?? '', route.query.taskStatus) ? route.query.taskStatus : undefined)
const statusOptions = computed(() => taskStatusOptions(queue.value ?? ''))
const statusHeading = computed(() => taskStatusHeading(queue.value ?? '')[zh.value ? 0 : 1])
const hasStatus = computed(() => statusOptions.value.length > 0)
function statusLabel(order: FopOrder) { return taskStatusLabel(getTaskStatus(order, queue.value ?? ''), queue.value ?? '')[zh.value ? 0 : 1] }
const warehouseStage = computed(() => isWarehouseStage(route.query.warehouseStage) ? route.query.warehouseStage : 'all')
const labels = computed(() => ({ unpaid: text('待支付', 'Pending payment'), procurement_shipping: text('已采购待发货', 'Purchased · shipment pending'), allocation_review: text('已齐套未审核', 'Fully allocated · approval pending'), procurement: text('待采购', 'Pending purchase'), review: text('待审核', 'Pending review'), allocation: text('未齐套', 'Incomplete allocation'), dispatch: text('待履约', 'Pending fulfillment'), shipping: text('待出库', 'Pending outbound'), exceptions: text('异常订单', 'Order exceptions') }))
const descriptions = computed(() => ({
  unpaid: text('尚未付款的履约订单，跟进客户付款进度。', 'Unpaid fulfillment orders awaiting customer payment.'),
  procurement: text('跟进采购建单、1688 下单及采购付款，业务处理请在 FOP 完成。', 'Track purchase preparation, 1688 placement and payment. Process orders in FOP.'),
  procurement_shipping: text('采购款已付清，等待供应商发货；超过 24 小时提醒，超过 48 小时预警。', 'Paid purchases awaiting supplier shipment; reminders after 24 hours and alerts after 48 hours.'),
  allocation_review: text('已齐套的配货单待审核；发运单制作完成后，可单笔或批量审核配货单。请及时处理未完成的发运单后审核配货单。', 'Fully allocated documents awaiting approval. Once dispatch preparation is complete, approve allocations individually or in batches. Please complete unfinished dispatch documents promptly, then approve the allocation documents.'),
  review: text('等待审核的履约订单，可勾选后单笔或批量审核。', 'Fulfillment orders awaiting review. Select orders for individual or batch approval.'),
  allocation: text('已生成配货单但尚未齐套，可按选中订单查询即时库存，配货操作请在 FOP 完成。', 'Existing allocation documents awaiting stock completion. Query current inventory for selected orders and allocate in FOP.'),
  dispatch: text('跟进发运单制作与 Shopify 同步，重点关注已审核未同步的订单。', 'Track dispatch preparation and Shopify sync, especially approved orders still awaiting sync.'),
  shipping: text('配货单已审核，等待仓库打包及出库，包含尚未全部出库的订单。', 'Approved allocations awaiting packing and outbound completion, including partially shipped orders.'),
  exceptions: text('尚未发货且存在异常的履约订单。', 'Unshipped fulfillment orders with an active exception.'),
}))
const search = ref('')
const data = ref<FopQueuePage>()
const departmentId = computed(() => typeof route.query.departmentId === 'string' ? route.query.departmentId : '')
const departments = computed(() => data.value?.departments ?? [])
const ownerId = computed(() => typeof route.query.ownerId === 'string' ? route.query.ownerId : '')
const warehouseCode = computed(() => route.query.warehouseCode === 'HZ' || route.query.warehouseCode === 'SZ' ? route.query.warehouseCode : '')
const selectedOwnerName = computed(() => data.value?.salespeople?.find(person => person.id === ownerId.value)?.name ?? text('指定业务员', 'Selected salesperson'))
const recipientOrderId = ref<string>()
const recipientOrder = computed(() => data.value?.items.find(order => order.id === recipientOrderId.value && order.shippingRecipient))
watch(recipientOrder, order => { if (!order) recipientOrderId.value = undefined })
const followUpOrder = ref<{ id: string; orderNumber: string }>()
watch(() => route.fullPath, () => { followUpOrder.value = undefined; recipientOrderId.value = undefined })
const busy = ref(false)
const error = ref('')
const online = ref(navigator.onLine)
const visible = ref(document.visibilityState === 'visible')
const currentTime = ref(Date.now())
const copiedValue = ref('')
const copyMessage = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let recoveringPage = false
const page = computed(() => Number(route.query.page || 1))
const pageSize = computed(() => Number(route.query.pageSize || 50))
const sortBy = computed<FopOrderSortBy>(() => isFopOrderSortBy(route.query.sortBy) ? route.query.sortBy : 'paidAt')
const sortOrder = computed(() => route.query.sortOrder === 'desc' ? 'desc' : route.query.sortOrder === 'asc' ? 'asc' : sortBy.value === 'paidAt' && route.query.paidAtOrder === 'desc' ? 'desc' : 'asc')
const paidAtOrder = computed(() => sortBy.value === 'paidAt' ? sortOrder.value : 'asc')
const leadingSortField = computed<FopOrderSortBy | undefined>(() => isAllocation.value || queue.value === 'dispatch' ? 'dispatchDocumentStatus' : queue.value === 'shipping' ? 'outboundStatus' : undefined)
const dispatchSortHint = computed(() => queue.value === 'allocation_review' ? text('未完成 → 已完成；关联发运单全部审核后为已完成', 'Incomplete → Complete; all linked dispatch documents approved') : queue.value === 'dispatch' ? text('未创建 → 暂存 → 已提交 → 已审核未同步；多单取最早进度；含未知状态的订单置后', 'Not created → Draft → Submitted → Approved · sync pending; earliest document stage; unknown statuses last') : text('未创建 → 暂存 → 已提交 → 已审核 → 已同步；多单取最早进度；含未知状态的订单置后', 'Not created → Draft → Submitted → Approved → Synced; earliest document stage; orders with unknown statuses last'))
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
// Shared field weights keep all queues consistent and spread available space
// across every column, instead of leaving a few columns to absorb the remainder.
const listColumns = computed(() => {
  const columns: { key: string; width: number }[] = [
    { key: 'order', width: 196 }, { key: 'product', width: 240 },
    { key: 'shopify', width: 104 }, { key: 'amount', width: 96 },
    { key: 'recipient', width: 96 }, { key: 'receipt-time', width: 100 },
  ]
  // TO/FY/AO: two letters + YYMMDD + six digits; include selection/copy controls.
  if (queue.value === 'allocation_review') columns.push({ key: 'allocation-document', width: 148 })
  if (showDispatchNumbers.value) columns.push({ key: 'dispatch-document', width: 148 })
  if (hasStatus.value) columns.push({ key: 'status', width: 112 })
  columns.push({ key: 'customer', width: 116 }, { key: 'store', width: 116 })
  if (queue.value === 'exceptions') columns.push({ key: 'exception-age', width: 80 })
  columns.push({ key: 'warehouse', width: 72 })
  if (queue.value === 'review' || queue.value === 'unpaid') columns.push({ key: 'channel', width: 144 })
  if (queue.value === 'dispatch') columns.push({ key: 'logistics', width: 184 })
  if (queue.value === 'shipping') columns.push({ key: 'carrier', width: 88 }, { key: 'tracking', width: 172 })
  columns.push({ key: 'salesperson', width: 116 }, { key: 'event-time', width: 100 })
  if (queue.value === 'procurement_shipping') columns.push({ key: 'action', width: 80 })
  const total = columns.reduce((sum, column) => sum + column.width, 0)
  // Percentage widths also work in fixed-layout tables that ignore mixed-unit calc().
  return columns.map(column => ({ ...column, size: `${column.width / total * 100}%` }))
})
const columnCount = computed(() => listColumns.value.length)
let requestId = 0

async function load(reset = false) {
  currentTime.value = Date.now()
  if (approvalOrderIds.value) return
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
  if (queue.value === 'dispatch' && route.query.taskStatus === 'dispatch_synced') {
    busy.value = false
    await router.replace({ query: { ...route.query, taskStatus: undefined, page: '1' } })
    return
  }
  if (queue.value === 'procurement') {
    const retired: Record<string, string | undefined> = { application_pending: 'purchase_order_pending', dispatch_missing: 'dispatch_preparation', logistics_pending: 'dispatch_preparation', unknown: undefined }
    const legacy: Record<string, string | undefined> = { application_pending: 'purchase_order_pending', unknown: undefined }
    const changes: Record<string, string | undefined> = {}
    if (typeof route.query.taskStatus === 'string' && Object.hasOwn(retired, route.query.taskStatus)) changes.taskStatus = retired[route.query.taskStatus]
    if (typeof route.query.procurementStage === 'string' && Object.hasOwn(legacy, route.query.procurementStage)) changes.procurementStage = legacy[route.query.procurementStage]
    if (Object.keys(changes).length) {
      busy.value = false
      await router.replace({ query: { ...route.query, ...changes, page: '1' } })
      return
    }
  }
  if (queue.value === 'allocation_review' && typeof route.query.taskStatus === 'string'
    && ['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved', 'dispatch_synced', 'unknown'].includes(route.query.taskStatus)) {
    const completed = ['dispatch_approved', 'dispatch_synced'].includes(route.query.taskStatus)
    busy.value = false
    await router.replace({ query: { ...route.query, taskStatus: completed ? 'dispatch_complete' : 'dispatch_incomplete', page: '1' } })
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
  if (route.query.taskStatus !== undefined && !canFilterTaskStatus(queue.value, route.query.taskStatus)) {
    busy.value = false
    error.value = text('状态筛选无效，请重新选择清单。', 'Invalid status filter. Select the queue again.')
    return
  }
  if (route.query.procurementStage !== undefined && !canFilterProcurementStage(queue.value, route.query.procurementStage)) {
    busy.value = false
    error.value = text('采购状态筛选无效，请重新选择清单。', 'Invalid procurement filter. Select the queue again.')
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
  if (route.query.warehouseCode !== undefined && !warehouseCode.value) {
    busy.value = false
    error.value = text('仓库筛选无效，请重新选择清单。', 'Invalid warehouse filter. Select the queue again.')
    return
  }
  if (route.query.ownerId !== undefined && (typeof route.query.ownerId !== 'string' || ownerId.value.length > 128)) {
    busy.value = false
    error.value = text('业务员筛选无效，请重新选择。', 'Invalid salesperson filter. Please select again.')
    return
  }
  if (route.query.warehouseStage !== undefined && (queue.value !== 'shipping' || !isWarehouseStage(route.query.warehouseStage))) {
    busy.value = false
    error.value = text('配货单状态筛选无效，请重新选择。', 'Invalid allocation document status. Please select again.')
    return
  }
  busy.value = true
  const selectedQueue = queue.value
  try {
    const result = await getFopOrders({ ...currentFilters(), page: page.value, pageSize: pageSize.value })
    if (currentRequest !== requestId) return
    if (!result.items.every(order => matchesFopQueue(order, selectedQueue, warehouseStage.value) && (!taskStatus.value || getTaskStatus(order, selectedQueue) === taskStatus.value) && (!procurementStage.value || getProcurementStage(order.procurementProgress, order.fulfillmentProgress.supplierShipment) === procurementStage.value))) throw new Error('Unexpected queue data')
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
    emit('filter-labels', [...(result.departments ?? []), ...(result.salespeople ?? [])])
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
  currentTime.value = Date.now()
  online.value = navigator.onLine
  visible.value = document.visibilityState === 'visible'
  if (!inventoryOrderIds.value && !exporting.value && online.value && visible.value && queue.value) void load()
}
watch(() => route.fullPath, () => { inventoryOrderIds.value = undefined; cancelExport(); void load(true) }, { immediate: true })
watch(() => props.searchRecovery, (next, previous) => {
  if (!next && previous?.from === route.fullPath) {
    busy.value = false
    search.value = previous.search
    error.value = text('页码更新未完成，请刷新重试。', 'Page update was not completed. Refresh to retry.')
  }
})
onMounted(() => {
  window.addEventListener('beforeunload', preventApprovalUnload)
  refreshTimer = setInterval(refreshIfActive, 30_000)
  document.addEventListener('visibilitychange', refreshIfActive)
  window.addEventListener('focus', refreshIfActive)
  window.addEventListener('online', refreshIfActive)
  window.addEventListener('offline', refreshIfActive)
})
onBeforeUnmount(() => {
  clearApproval()
  window.removeEventListener('beforeunload', preventApprovalUnload)
  cancelExport()
  offSession()
  requestId++
  clearInterval(refreshTimer)
  clearTimeout(copyTimer)
  document.removeEventListener('visibilitychange', refreshIfActive)
  window.removeEventListener('focus', refreshIfActive)
  window.removeEventListener('online', refreshIfActive)
  window.removeEventListener('offline', refreshIfActive)
})
async function copyValue(value: string, key: string, label: string) {
  try {
    await copyText(value)
    copiedValue.value = key
    copyMessage.value = text(`${label}已复制`, `${label} copied`)
  } catch {
    copiedValue.value = ''
    copyMessage.value = text(`复制失败，请选中${label}手动复制`, `Copy failed. Select the ${label.toLowerCase()} and copy it manually.`)
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedValue.value = ''; copyMessage.value = '' }, 2400)
}
function copyOrderValue(order: FopOrder, field: 'orderNumber' | 'customerName') {
  return copyValue(order[field], `${field}:${order.id}`, field === 'orderNumber' ? text('订单编号', 'Order number') : text('客户名称', 'Customer name'))
}
const refreshedTime = computed(() => data.value?.refreshedAt ? new Date(data.value.refreshedAt).toLocaleTimeString(zh.value ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) : '')
function navigate(values: Record<string, string | number | undefined>) {
  if (!queue.value) return
  return router.push(workbenchOrderLocation(queue.value, { ...route.query, ...values }))
}
function clearSearchIfEmpty(event: Event) {
  if (!(event.target as HTMLInputElement).value.trim() && typeof route.query.search === 'string' && route.query.search.trim()) {
    search.value = ''
    void navigate({ search: undefined, page: 1 })
  }
}
function submitSearch() { return navigate({ search: search.value.trim() || undefined, page: 1 }) }
const usesConsumerOrderTime = computed(() => ['unpaid', 'review', 'exceptions', 'dispatch', 'allocation'].includes(queue.value ?? ''))
const timeSortField = computed(() => queue.value === 'procurement' ? 'reviewedAt' as const : usesConsumerOrderTime.value ? 'consumerPaidAt' as const : null)
const createdTimeLabel = computed(() => queue.value === 'shipping' ? text('WMS创建时间', 'WMS creation time') : queue.value === 'procurement' ? text('订单审核时间', 'Order approval time') : queue.value === 'allocation_review' ? text('齐套时间', 'Allocation completion time') : queue.value === 'procurement_shipping' ? text('采购付款时间', 'Procurement payment time') : usesConsumerOrderTime.value ? text('C端下单时间', 'Consumer order time') : text('创建时间', 'Created at'))
const searchPlaceholder = computed(() => queue.value === 'unpaid' ? text('业务员 / 订单 / 客户 / 自定义物流渠道', 'Salesperson / order / customer / custom channel') : text('业务员 / 订单 / 客户 / SKU / 物流服务商', 'Salesperson / order / customer / SKU / carrier'))
const searchHint = computed(() => queue.value === 'unpaid' ? text('支持按业务员姓名、订单编号、Shopify 单号、客户、店铺、SKU 或自定义物流渠道名称查询', 'Search by salesperson name, order number, Shopify order, customer, store, SKU or custom logistics channel name') : text('支持按业务员姓名、订单编号、Shopify 单号、客户、店铺、SKU 或物流服务商查询', 'Search by salesperson name, order number, Shopify order, customer, store, SKU or carrier'))
const createdTimeHint = computed(() => queue.value === 'shipping' ? text('发货通知成功推送 WMS 出库指令的时间（UTC+8）', 'Delivery notice successfully sent to WMS for outbound processing (UTC+8)') : queue.value === 'procurement' ? text('履约订单实际审核时间（UTC+8）', 'Actual fulfillment order approval time (UTC+8)') : queue.value === 'allocation_review'
  ? text('当前配货单实际齐套时间（UTC+8）；释放后重新齐套以最新齐套时间为准', 'Current allocation completion (UTC+8); reallocation uses the latest completion time')
  : queue.value === 'procurement_shipping'
  ? text('实际采购付款时间（UTC+8）；关联多笔未发货采购时取最早付款时间', 'Actual procurement payment (UTC+8); earliest payment among outstanding supplier shipments')
  : usesConsumerOrderTime.value ? text('消费者在 Shopify 店铺首次完成订单付款的时间（UTC+8）', 'First completed consumer payment in Shopify (UTC+8)') : undefined)
function orderTime(order: FopOrder): string | null {
  if (queue.value === 'shipping') {
    const at = orderTimestamp(order.wmsCreatedAt)
    return at === null ? null : new Date(at).toISOString()
  }
  if (queue.value === 'procurement') {
    const at = orderTimestamp(order.reviewedAt)
    return at === null ? null : new Date(at).toISOString()
  }
  if (queue.value === 'allocation_review') {
    const at = orderTimestamp(order.allocationReadyAt)
    return at === null ? null : new Date(at).toISOString()
  }
  if (queue.value === 'procurement_shipping') {
    const at = procurementPaymentTime(order.procurementPaidAt)
    return at === null ? null : new Date(at).toISOString()
  }
  return usesConsumerOrderTime.value ? order.consumerPaidAt ?? null : order.createdAt
}
const consumerSortHint = computed(() => timeSortField.value === 'reviewedAt' ? sortDirection('reviewedAt') === 'asc' ? text('最早审核在前，点击切换为最新审核在前', 'Oldest approval first; click for newest first') : sortDirection('reviewedAt') === 'desc' ? text('最新审核在前，点击切换为最早审核在前', 'Newest approval first; click for oldest first') : text('点击按最早审核在前排序', 'Click for oldest approval first') : sortDirection(timeSortField.value ?? 'consumerPaidAt') === 'asc'
  ? text('最早下单在前，点击切换为最新下单在前', 'Oldest checkout first; click for newest first')
  : sortDirection(timeSortField.value ?? 'consumerPaidAt') === 'desc' ? text('最新下单在前，点击切换为最早下单在前', 'Newest checkout first; click for oldest first')
  : text('点击按最早下单在前排序', 'Click for oldest checkout first'))
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString(zh.value ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const formatMoney = (amount: number, currency: string) => formatCurrency(amount, currency, zh.value ? 'zh-CN' : 'en-US')
</script>

<template>
  <div class="fulfillment-page" :aria-busy="busy">
      <WorkbenchTaskHeading class="list-heading" :title="(queue ? labels[queue] : text('履约订单', 'Fulfillment orders')) + (queue && !['exceptions', 'allocation_review', 'procurement_shipping'].includes(queue) ? text('清单', ' orders') : '')" :description="queue ? descriptions[queue] : undefined">
        <div class="refresh-controls"><button class="workbench-button refresh-orders workbench-refresh" :disabled="busy || !queue || !online" @click="load()"><RefreshCw :size="15" :class="{ 'animate-spin': busy }" />{{ busy ? text('刷新中…', 'Refreshing…') : text('刷新', 'Refresh') }}</button><span class="refresh-status" :class="{ 'sync-paused': !online }">{{ !online ? text('网络已断开 · 自动刷新暂停', 'Offline · Auto-refresh paused') : !visible ? text('页面未激活 · 自动刷新暂停', 'Page inactive · Auto-refresh paused') : text('每 30 秒自动刷新', 'Refreshes every 30 seconds') }}<template v-if="refreshedTime"><br />{{ text('最近刷新', 'Last refreshed') }} {{ refreshedTime }} · UTC+8</template></span></div>
      </WorkbenchTaskHeading>
      <p v-if="queue === 'shipping' && warehouseStage === 'pending_review'" class="read-only-note">{{ text('已齐套未审核已归入配货工作台。', 'Allocation approval is tracked in the Allocation Workbench.') }} <button class="clear-selection" @click="navigate({ warehouseStage: undefined, page: 1 })">{{ text('查看待出库清单', 'View pending outbound') }}</button></p>
      <p v-if="copyMessage" class="copy-feedback" role="status">{{ copyMessage }}</p>
      <section class="list-panel">
        <WorkbenchListActions :selected-count="selectedOrders.length" @clear="selectedOrders = []">
          <button v-if="queue === 'allocation' || queue === 'shipping'" type="button" class="workbench-button" data-testid="open-inventory" :disabled="busy || !online || !data" @click="inventoryOrderIds = [...selectedOrders]"><PackageSearch :size="15" />{{ text('查询即时库存', 'Current inventory') }}</button>
          <template #export>
            <WorkbenchExportButton :selected-count="selectedOrders.length" :total="data?.total ?? 0" :disabled="busy || !online || !data" :busy="!!exporting" @export="exportOrders" />
          </template>
        </WorkbenchListActions>
        <p v-if="exportFeedback" class="export-feedback" :class="{ 'export-error': exportFailed }" :role="exportFailed ? 'alert' : 'status'">{{ exportFeedback }}</p>
        <div class="list-toolbar">
          <div class="query-controls">
            <button v-if="approvalQueue" type="button" class="workbench-button workbench-primary" data-testid="open-approval" :disabled="busy || !online || !hasApprovableSelection || !data || !!approvalOrderIds" :title="queue === 'allocation_review' ? text('审核发运单制作已完成的配货单', 'Approve allocations with completed dispatch preparation') : undefined" @click="openApproval"><Check :size="15" />{{ text('审核', 'Approve') }}</button>
            <label v-if="hasStatus" class="department-filter status-filter">{{ statusHeading }}
              <select class="workbench-filter-select" :value="taskStatus ?? (procurementStage ? `legacy:${procurementStage}` : '')" :disabled="busy" :aria-label="`${statusHeading}${text('筛选', ' filter')}`" @change="navigate({ taskStatus: ($event.target as HTMLSelectElement).value || undefined, procurementStage: undefined, page: 1 })">
                <option value="">{{ queue === 'dispatch' ? text('全部待履约', 'All pending fulfillment') : text('全部状态', 'All statuses') }}</option>
                <option v-if="procurementStage && !taskStatus" :value="`legacy:${procurementStage}`" disabled>{{ procurementStageLabels[procurementStage][zh ? 0 : 1] }}{{ text('（原筛选）', ' (legacy filter)') }}</option>
                <option v-for="value in statusOptions" :key="value" :value="value">{{ taskStatusLabel(value, queue ?? '')[zh ? 0 : 1] }}</option>
              </select>
            </label>
          <form class="search-form" @submit.prevent="submitSearch"><label class="search-field workbench-search-field"><Search :size="16" /><input v-model="search" type="search" @input="clearSearchIfEmpty" :aria-label="text('搜索履约订单', 'Search fulfillment orders')" :placeholder="searchPlaceholder" :title="searchHint" /></label><button class="workbench-button workbench-primary" :disabled="busy || !queue">{{ text('查询', 'Search') }}</button></form>
          <span class="result-count" aria-live="polite">{{ data ? text(`共 ${data.total} 笔订单`, `${data.total} orders`) : '—' }}</span>
          </div>
          <div class="scope-filters">
          <label class="department-filter warehouse-filter"><span>{{ text('发货仓库', 'Shipping warehouse') }}</span><select class="workbench-filter-select" :value="warehouseCode" :disabled="busy || !queue" :aria-label="text('发货仓库', 'Shipping warehouse')" @change="navigate({ warehouseCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ text('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ text('深圳仓', 'Shenzhen') }}</option></select></label>
          <label class="department-filter"><span>{{ text('业务部门', 'Business department') }}</span><select class="workbench-filter-select" :value="departmentId" :disabled="busy || !queue" :aria-label="text('业务部门', 'Business department')" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, ownerId: undefined, page: 1 })"><option value="">{{ text('营销中心', 'Marketing Center') }}</option><option v-if="departmentId && !departments.some(item => item.id === departmentId)" :value="departmentId" disabled>{{ text('所选业务部门', 'Selected business department') }}</option><option v-for="department in departments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          </div>
        </div>
        <div v-if="procurementStage && taskStatus" class="exact-filter legacy-status-filter"><span>{{ text('原采购筛选', 'Legacy purchase filter') }}：{{ procurementStageLabels[procurementStage][zh ? 0 : 1] }}</span><button :disabled="busy" :aria-label="text('清除原采购状态筛选', 'Clear legacy purchase status filter')" @click="navigate({ procurementStage: undefined, page: 1 })">{{ text('清除', 'Clear') }}</button></div>
        <div v-if="ownerId" class="exact-filter legacy-owner-filter"><span>{{ text('业务员', 'Salesperson') }}：{{ selectedOwnerName }}</span><button :disabled="busy" @click="navigate({ ownerId: undefined, page: 1 })">{{ text('清除业务员筛选', 'Clear salesperson filter') }}</button></div>
        <div v-if="route.query.orderNumber" class="exact-filter"><span>{{ text('指定订单', 'Selected order') }}：{{ route.query.orderNumber }}</span><button @click="navigate({ orderNumber: undefined, page: 1 })">{{ text('查看该类全部订单', 'View all orders in this queue') }}</button></div>
        <p v-if="error" class="state-message error-message" role="alert">{{ text('刷新未成功，当前进度暂不可用。', 'Refresh failed; current progress is unavailable.') }} {{ error }} <button v-if="queue" @click="load()">{{ text('重试', 'Retry') }}</button></p>
        <div v-else-if="busy && !data" class="state-message" role="status"><RefreshCw class="animate-spin" :size="22" />{{ text('正在加载订单…', 'Loading orders…') }}</div>
        <template v-else-if="data && queue">
          <div class="compact-list-controls">
            <label><input type="checkbox" class="order-checkbox" :checked="pageSelected" :indeterminate="!!selectedOrders.length && !pageSelected" :disabled="busy || !data.items.length" :aria-label="text('选择本页全部订单', 'Select current page')" @change="togglePage(($event.target as HTMLInputElement).checked)" />{{ text('全选本页', 'Select page') }}</label>
            <button class="compact-payment-sort" :disabled="busy" :aria-label="`${text('按收款日期排序', 'Sort payment date')}：${sortHint}`" @click="sortPayment()">{{ text('收款日期', 'Payment date') }}<component :is="sortBy !== 'paidAt' ? ArrowUpDown : paidAtOrder === 'asc' ? ArrowUp : ArrowDown" :size="13" /></button>
            <button v-if="timeSortField" class="compact-consumer-sort" :disabled="busy" :aria-label="`${createdTimeLabel}：${consumerSortHint}`" @click="sortStatus(timeSortField)">{{ createdTimeLabel }}<component :is="sortDirection(timeSortField) === 'asc' ? ArrowUp : sortDirection(timeSortField) === 'desc' ? ArrowDown : ArrowUpDown" :size="13" /></button>
            <button v-if="leadingSortField" class="compact-status-sort" :disabled="busy" :aria-label="`${statusHeading}：${sortDirection(leadingSortField) === 'asc' ? text('当前升序，点击降序', 'Ascending; sort descending') : sortDirection(leadingSortField) === 'desc' ? text('当前降序，点击升序', 'Descending; sort ascending') : text('点击按状态升序排列', 'Sort status ascending')}`" @click="sortStatus(leadingSortField)">{{ statusHeading }}<component :is="sortDirection(leadingSortField) === 'asc' ? ArrowUp : sortDirection(leadingSortField) === 'desc' ? ArrowDown : ArrowUpDown" :size="13" /></button>
          </div>
          <div class="table-scroll" :aria-label="text('履约订单明细表', 'Fulfillment orders')">
            <table class="workbench-task-table">
              <colgroup><col v-for="column in listColumns" :key="column.key" :class="`${column.key}-column`" :style="{ width: column.size }" /></colgroup>
              <thead><tr>
                <th class="order-cell"><input type="checkbox" class="order-checkbox" :checked="pageSelected" :indeterminate="!!selectedOrders.length && !pageSelected" :disabled="busy || !data.items.length" :aria-label="text('全选当前页订单', 'Select all orders on this page')" @change="togglePage(($event.target as HTMLInputElement).checked)" />{{ text('订单编号', 'Order number') }}</th>
                <th class="product-cell">{{ text('商品图片 / 商品信息', 'Product image / details') }}</th>
                <th class="shopify-cell">{{ text('Shopify 单号', 'Shopify order') }}</th><th class="amount-cell">{{ text('订单金额', 'Order amount') }}</th>
                <th :title="text('订单收货国家', 'Delivery destination country')">Customer</th>
                <th :aria-sort="sortBy !== 'paidAt' ? 'none' : paidAtOrder === 'asc' ? 'ascending' : 'descending'"><button type="button" class="sort-payment" :disabled="busy" :title="`${sortHint}（UTC+8）`" :aria-label="`${text('收款日期', 'Payment date')}：${sortHint}`" @click="sortPayment()">{{ text('收款日期', 'Payment date') }}<component :is="sortBy !== 'paidAt' ? ArrowUpDown : paidAtOrder === 'asc' ? ArrowUp : ArrowDown" :size="13" aria-hidden="true" /></button></th>
                <th v-if="queue === 'allocation_review'">{{ text('配货单号', 'Allocation document number') }}</th>
                <th v-if="showDispatchNumbers">{{ text('发运单编号', 'Dispatch document number') }}</th>
                <OrderSortHeader v-if="leadingSortField" :label="statusHeading" :direction="sortDirection(leadingSortField)" :disabled="busy" :hint="leadingSortField === 'dispatchDocumentStatus' ? dispatchSortHint : undefined" @sort="sortStatus(leadingSortField)" /><th v-else-if="hasStatus">{{ statusHeading }}</th>
                <th>{{ text('客户名称', 'Customer name') }}</th><th>{{ text('店铺', 'Store') }}</th>
                <th v-if="queue === 'exceptions'">{{ text('异常时长', 'Exception age') }}</th><th>{{ text('发货仓库', 'Shipping warehouse') }}</th>
                <th v-if="queue === 'review'">{{ text('物流渠道', 'Logistics channel') }}</th>
                <th v-if="queue === 'unpaid'">{{ text('自定义物流渠道', 'Custom logistics channel') }}</th>
                <th v-if="queue === 'dispatch'">{{ text('物流信息', 'Logistics information') }}</th><th v-if="queue === 'shipping'">{{ text('物流商', 'Carrier') }}</th><th v-if="queue === 'shipping'">{{ text('跟踪号', 'Tracking number') }}</th>
                <th>{{ text('业务员', 'Salesperson') }}</th>
                <th v-if="timeSortField" :aria-sort="sortDirection(timeSortField) === 'asc' ? 'ascending' : sortDirection(timeSortField) === 'desc' ? 'descending' : 'none'"><button type="button" class="sort-consumer" :disabled="busy" :aria-label="`${createdTimeLabel}：${consumerSortHint}`" :title="`${consumerSortHint} · ${createdTimeHint}`" @click="sortStatus(timeSortField)">{{ createdTimeLabel }}<component :is="sortDirection(timeSortField) === 'asc' ? ArrowUp : sortDirection(timeSortField) === 'desc' ? ArrowDown : ArrowUpDown" :size="13" aria-hidden="true" /></button></th>
                <th v-else>{{ createdTimeLabel }}</th><th v-if="queue === 'procurement_shipping'">{{ text('操作', 'Action') }}</th>
              </tr></thead>
              <tbody><tr v-for="order in data.items" :key="order.id" class="order-record" :style="{ '--detail-rows': Math.ceil((columnCount - 2 + (showDispatchNumbers ? 1 : 0) + (queue === 'allocation_review' || queue === 'dispatch' || queue === 'shipping' ? 1 : 0)) / 4) }">
                <td class="order-cell" :data-label="text('订单编号', 'Order number')">
                  <input v-model="selectedOrders" type="checkbox" class="order-checkbox" :value="order.id" :disabled="busy" :aria-label="`${text('选择订单', 'Select order')} ${order.orderNumber}`" />
                  <button type="button" class="copy-order" :aria-label="`${text('复制订单编号', 'Copy order number')} ${order.orderNumber}`" :title="order.orderNumber" @click="copyOrderValue(order, 'orderNumber')"><strong>{{ order.orderNumber }}</strong><Check v-if="copiedValue === `orderNumber:${order.id}`" :size="14" /><Copy v-else :size="14" /></button>
                  <span v-if="order.items.length > 1" class="multi-item-badge">{{ text(`${order.items.length} 款商品 · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} 件`, `${order.items.length} products · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} units`) }}</span>
                </td>
                <td class="product-cell" :data-label="text('商品图片 / 商品信息', 'Product image / details')"><div v-for="(item, index) in order.items" :key="index" class="product">
                  <OrderProductImage :src="item.imageUrl" :name="item.name" />
                  <div class="product-details"><span class="product-name" :title="item.name">{{ item.name }}</span><span class="product-sku-meta"><span class="product-sku mono"><button v-if="item.sku?.trim()" type="button" class="copy-value" :title="item.sku" :aria-label="`${text('复制SKU', 'Copy SKU')} ${item.sku}`" @click="copyValue(item.sku, `sku:${order.id}:${index}`, 'SKU')"><span>SKU · {{ item.sku }}</span><Check v-if="copiedValue === `sku:${order.id}:${index}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>SKU · —</span></span><span class="product-quantity" :aria-label="`${item.sku} ${text('数量', 'quantity')} ${item.quantity}`">× {{ item.quantity }}</span></span><span v-if="item.variant" class="product-variant">{{ item.variant }}</span></div>
                </div></td>
                <td class="mono shopify-cell" :data-label="text('Shopify 单号', 'Shopify order')"><button v-if="order.shopifyOrderNumber?.trim()" type="button" class="copy-value" :title="order.shopifyOrderNumber" :aria-label="`${text('复制Shopify 单号', 'Copy Shopify order')} ${order.shopifyOrderNumber}`" @click="copyValue(order.shopifyOrderNumber, `shopify:${order.id}`, text('Shopify 单号', 'Shopify order'))"><span>{{ order.shopifyOrderNumber }}</span><Check v-if="copiedValue === `shopify:${order.id}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>—</span></td>
                <td class="money amount-cell" :data-label="text('订单金额', 'Order amount')">{{ formatMoney(order.amount, order.currency) }}</td>
                <td class="country-cell" data-label="Customer"><div class="order-recipient"><ShippingCountryBadge :code="order.shippingCountryCode" /><button v-if="order.shippingRecipient" type="button" class="recipient-name" :aria-label="`${text('查看收件人信息', 'View recipient details')} · ${order.shippingRecipient.name || order.orderNumber}`" @click="recipientOrderId = order.id">{{ order.shippingRecipient.name || text('查看收件人', 'View recipient') }}</button><span v-else class="recipient-empty">—</span></div></td>
                <td :data-label="text('收款日期', 'Payment date')">{{ formatDate(order.paidAt) }}</td>
                <td v-if="queue === 'allocation_review'" class="dispatch-numbers mono" :data-label="text('配货单号', 'Allocation document number')"><button v-if="order.allocationDocument?.number?.trim()" type="button" class="copy-value" :title="order.allocationDocument.number" :aria-label="`${text('复制配货单号', 'Copy allocation number')} ${order.allocationDocument.number}`" @click="copyValue(order.allocationDocument.number, `allocation:${order.id}`, text('配货单号', 'Allocation number'))"><span>{{ order.allocationDocument.number }}</span><Check v-if="copiedValue === `allocation:${order.id}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>—</span></td>
                <td v-if="showDispatchNumbers" class="dispatch-numbers mono" :data-label="text('发运单编号', 'Dispatch document number')"><div v-for="document in order.dispatchDocuments" :key="document.id"><button v-if="document.number?.trim()" type="button" class="copy-value" :title="document.number" :aria-label="`${text('复制发运单编号', 'Copy dispatch number')} ${document.number}`" @click="copyValue(document.number, `dispatch:${order.id}:${document.id}`, text('发运单编号', 'Dispatch number'))"><span>{{ document.number }}</span><Check v-if="copiedValue === `dispatch:${order.id}:${document.id}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>—</span></div><span v-if="!order.dispatchDocuments?.length">—</span></td>
                <td v-if="queue === 'procurement'" :data-label="statusHeading"><ProcurementStatus :paid-at="order.procurementPaidAt" :now="currentTime" :progress="order.procurementProgress" :shipment="order.fulfillmentProgress.supplierShipment" /></td>
                <td v-else-if="queue === 'dispatch' || isAllocation" :data-label="statusHeading"><DispatchStatus :queue="queue ?? undefined" :documents="order.dispatchDocuments" :shopify-sync="order.fulfillmentProgress.shopifySync" /></td>
                <td v-else-if="queue === 'procurement_shipping'" :data-label="statusHeading"><SupplierShipmentStatus class="status-pill" :paid-at="order.procurementPaidAt" :now="currentTime" :shipment="order.fulfillmentProgress.supplierShipment === 'partial' ? 'partial' : 'pending'" /></td>
                <td v-else-if="hasStatus" :data-label="statusHeading"><WorkbenchStatusBadge class="status-pill pending" tone="info">{{ statusLabel(order) }}</WorkbenchStatusBadge></td>
                <td :data-label="text('客户名称', 'Customer name')"><button type="button" class="copy-customer" :aria-label="`${text('复制客户名称', 'Copy customer name')} ${order.customerName}`" :title="text('复制客户名称', 'Copy customer name')" @click="copyOrderValue(order, 'customerName')"><span>{{ order.customerName }}</span><Check v-if="copiedValue === `customerName:${order.id}`" :size="14" /><Copy v-else :size="14" /></button></td>
                <td :data-label="text('店铺', 'Store')">{{ order.storeName }}</td>
                <td v-if="queue === 'exceptions'" :data-label="text('异常时长', 'Exception age')">{{ order.exception?.hours }}h</td>
                <td :data-label="text('发货仓库', 'Shipping warehouse')">{{ order.warehouse }}</td>
                <td v-if="queue === 'review'" class="logistics-channel-cell" :data-label="text('物流渠道', 'Logistics channel')"><div v-for="(channel, index) in order.logisticsChannels" :key="index" class="logistics-channel-entry"><span class="logistics-channel-name" :title="channel.name || undefined">{{ channel.name || '—' }}</span><span class="logistics-channel-code" :title="channel.code || undefined">{{ channel.code || '—' }}</span></div><span v-if="!order.logisticsChannels?.length">—</span></td>
                <td v-if="queue === 'unpaid'" class="logistics-channel-cell" :data-label="text('自定义物流渠道', 'Custom logistics channel')">{{ order.customLogisticsChannelName || '—' }}</td>
                <td v-if="queue === 'dispatch'" class="logistics-info-cell" :data-label="text('物流信息', 'Logistics information')"><OrderLogisticsInfo :groups="order.logisticsInfo" :carrier="order.carrier" /></td>
                <td v-if="queue === 'shipping'" :data-label="text('物流商', 'Carrier')">{{ order.carrier || '—' }}</td>
                <td v-if="queue === 'shipping'" class="mono tracking-cell" :data-label="text('跟踪号', 'Tracking number')"><TrackingNumberCopy v-if="order.trackingNumber" :number="order.trackingNumber" /><span v-else>—</span></td>
                <td class="salesperson-cell" :data-label="text('业务员', 'Salesperson')"><span class="salesperson-name" :title="order.owner?.name || order.salesperson">{{ order.owner?.name || order.salesperson || '—' }}</span><RouterLink v-if="order.department" class="salesperson-department" :title="order.department.name" :to="{ name: 'Organization', query: { node: order.department.id } }">{{ order.department.name }}</RouterLink><span v-else class="salesperson-department">—</span></td>
                <td :data-label="createdTimeLabel" :title="createdTimeHint">{{ formatDate(orderTime(order)) }}</td>
                <td v-if="queue === 'procurement_shipping'" class="follow-up-cell" :data-label="text('操作', 'Action')"><button type="button" class="follow-up-order" :disabled="!online" :aria-label="`${text('催办', 'Follow up')} ${order.orderNumber}`" @click="followUpOrder = { id: order.id, orderNumber: order.orderNumber }"><MessageCircle :size="14" />{{ text('催办', 'Follow up') }}</button></td>
              </tr><tr v-if="!data.items.length"><td :colspan="columnCount"><div class="state-message" role="status"><PackageSearch :size="36" /><strong>{{ text('暂无符合条件的订单', 'No matching orders') }}</strong><span>{{ text('请调整搜索条件，或切换上方清单。', 'Adjust your search or select another queue.') }}</span></div></td></tr></tbody>
              <TableTotals>
                <th scope="row">{{ text('筛选合计', 'Filtered total') }} · {{ data.totals?.orderCount.toLocaleString() ?? '—' }} {{ text('笔订单', 'orders') }}</th>
                <td class="quantity-total">{{ data.totals?.itemQuantity.toLocaleString() ?? '—' }} {{ text('件', 'units') }}</td><td class="total-spacer" />
                <td class="money amount-cell"><OrderAmountTotals :totals="data.totals" /></td>
                <td :colspan="columnCount - 4" class="total-caption"><small>{{ text('全部筛选结果 · 金额按币种汇总', 'All filtered results · Amounts grouped by currency') }}</small></td>
              </TableTotals>
            </table>
          </div>
          <footer class="pagination"><span>{{ text('按订单分页，多商品在同一订单中展示', 'Paginated by order; items stay grouped') }}</span><div><label>{{ text('每页', 'Per page') }}<select class="workbench-filter-select" :value="pageSize" :aria-label="text('每页条数', 'Page size')" @change="navigate({ pageSize: ($event.target as HTMLSelectElement).value, page: 1 })"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option></select></label><button :disabled="page <= 1" :aria-label="text('上一页', 'Previous page')" @click="navigate({ page: page - 1 })"><ChevronLeft :size="16" /></button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" :aria-label="text('下一页', 'Next page')" @click="navigate({ page: page + 1 })"><ChevronRight :size="16" /></button></div></footer>
        </template>
      </section>
    <RecipientDetailsDialog v-if="recipientOrder?.shippingRecipient" :recipient="recipientOrder.shippingRecipient" :country-code="recipientOrder.shippingCountryCode" :order-number="recipientOrder.orderNumber" @close="recipientOrderId = undefined" />
    <OrderApprovalDialog v-if="approvalOrderIds && approvalQueue" :queue="approvalQueue" :order-ids="approvalOrderIds" @close="closeApproval" @completed="approvalCompleted" />
      <AllocationInventoryDialog v-if="inventoryOrderIds" :order-ids="inventoryOrderIds" :queue="queue === 'shipping' ? 'shipping' : 'allocation'" :warehouse-code="warehouseCode || undefined" @close="inventoryOrderIds = undefined" />
      <SupplierFollowUpDialog v-if="followUpOrder" :key="followUpOrder.id" :order-id="followUpOrder.id" :order-number="followUpOrder.orderNumber" @close="followUpOrder = undefined" />
  </div>
</template>

<style scoped>

.export-feedback{margin:0;padding:10px 20px;color:var(--color-text-secondary);font-size:12px;border-bottom:1px solid var(--color-border)}.export-error{color:var(--color-warning,#c69568)}.clear-selection{color:var(--color-chart-link)}input.order-checkbox{width:15px;height:15px;min-width:15px;margin-right:10px;padding:0;vertical-align:middle;accent-color:#8398c9}

.follow-up-cell{position:static;min-width:0;}
.follow-up-order{display:inline-flex;align-items:center;gap:5px;color:var(--color-chart-link);padding:6px 9px;border-radius:6px;background:color-mix(in srgb,var(--color-chart-link) 9%,transparent);white-space:nowrap}
.follow-up-order:hover{background:color-mix(in srgb,var(--color-chart-link) 16%,transparent)}
.follow-up-order:disabled{opacity:.45;cursor:not-allowed}

.dispatch-numbers { min-width: 0; line-height: 1.9; }
.fulfillment-page { color: var(--color-text, #243247); }
.back-link { display: inline-flex; align-items: center; gap: 7px; color: #718096; font-size: 12px; margin-bottom: 22px; }
.back-link:hover { color: #5873d4; }
.list-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px 24px; margin-bottom: 20px; }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .15em; color: #7a8ba2; margin-bottom: 8px; }
h2 { display: flex; gap: 12px; align-items: center; font-size: 21px; font-weight: 750; letter-spacing: -.03em; }
.description { margin-top: 8px; font-size: 12px; color: #8490a3; line-height: 1.7; }
.source-badge { border: 1px solid #f4d59a; color: #ae7616; background: #fff8e8; border-radius: 5px; padding: 3px 7px; font-size: 10px; letter-spacing: .06em; }

.queue-tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 18px; }
.queue-tabs a { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 11px 17px; border: 1px solid transparent; border-radius: 6px; color: #8490a3; font-size: 13px; white-space: nowrap; }
.queue-tabs a.active { background: var(--color-surface); border-color: var(--color-border); color: #5873d4; font-weight: 700; box-shadow: 0 2px 5px #23375805; }
.list-panel { container: order-list / inline-size; width: 100%; max-width: 100%; min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; overflow: hidden; background: var(--color-surface); }
.list-toolbar { padding: 18px 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.department-filter { display: flex; align-items: center; gap: 10px; color: var(--color-text-secondary); font-size: 12px; margin-left: auto; white-space: nowrap; }
.outbound-stage-filter { margin-left: 0; }
.scope-filters { display: flex; flex-wrap: wrap; align-items: center; flex: 0 1 auto; justify-content: flex-end; gap: 16px; margin-left: auto; max-width: 100%; }
.scope-filters .department-filter { margin-left: 0; }
.query-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; flex: 0 1 auto; min-width: 0; max-width: 100%; }
.query-controls .status-filter { margin-left: 0; flex-shrink: 0; }
.query-controls .search-form { flex: 0 1 calc(var(--query-search-width) + 64px); width: calc(var(--query-search-width) + 64px); min-width: min(240px, 100%); max-width: 100%; }
.status-filter select { min-width: 150px; }
.department-filter select { min-width:160px;max-width:280px; }
.search-form { display: flex; gap: 8px; }
.search-field { flex:1; }

.result-count { white-space: nowrap; color: #8490a3; font-size: 12px; }
.exact-filter { padding: 0 20px 16px; display: flex; gap: 16px; font-size: 12px; }
.exact-filter button, .error-message button { color: #5873d4; text-decoration: underline; }
.table-scroll { width: 100%; min-width: 0; max-width: 100%; border-top: 1px solid var(--color-border); }
table { table-layout: fixed; width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
th { position: sticky; top: 0; z-index: 2; background: var(--color-surface); padding: 14px 8px; border-bottom: 1px solid var(--color-border); }
td { border-bottom: 1px solid var(--color-border); padding: 12px 8px; min-width: 0; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--color-surface) 94%, #5873d4); }
.order-cell { position: static; background: var(--color-surface); z-index: 1; min-width: 0; padding-left: 16px; padding-right: 16px; text-align: center; white-space: nowrap; border-right: 1px solid var(--color-border); }
.order-cell .order-checkbox { margin-right: 7px; }
th.order-cell { z-index: 3; }
.order-cell strong { color: var(--color-chart-link); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
/* Column widths come from the common field baselines above. */
.shopify-cell { padding-right: 16px; white-space: nowrap; }
.amount-cell { padding-left: 16px; }
.product-cell { min-width: 0; }
.country-cell { min-width: 0; }
.logistics-channel-cell { line-height: 1.6; overflow-wrap: anywhere; }
.logistics-channel-cell > div + div { margin-top: 6px; }
.logistics-channel-entry { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 100%; }
.logistics-channel-name, .logistics-channel-code { display: block; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.logistics-channel-code { color: var(--color-text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; }
.table-scroll .text-indigo-600 { color: var(--color-chart-link); }
.product { display: flex; align-items: center; gap: 10px; min-height: 80px; padding: 6px 0; }
.product-details { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; flex: 1; }
.product-name { display: block; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; }
.product-sku, .product-variant { font-size: 10px; color: var(--color-text-secondary); line-height: 1.5; white-space: normal; overflow-wrap: anywhere; }

.image-fallback { display: flex; align-items: center; justify-content: center; background: #e5eaf1; color: #8893a5; }
.money, .mono { font-variant-numeric: tabular-nums; }

.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--color-border); padding: 14px 20px; color: #8490a3; font-size: 11px; }
.pagination div, .pagination label { display: flex; align-items: center; gap: 12px; }.pagination button { padding: 5px; }.pagination select { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; padding: 4px; }
.state-message { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #8490a3; font-size: 13px; padding: 24px; text-align: center; }.error-message { color: #dc6767; }
.demo-note { margin-top: 14px; color: #8a96a8; font-size: 11px; }
button:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 700px) { .list-heading { align-items: flex-start; }h2 { font-size: 23px; }.list-toolbar { flex-wrap: wrap; padding: 14px; }.query-controls { flex-wrap: wrap; flex-basis: 100%; }.query-controls .search-form { flex-basis: 100%; min-width: 0; }.pagination { flex-wrap: wrap; padding: 14px; }.queue-tabs a { padding: 9px 12px; }.order-cell { position: static; }.exact-filter { flex-wrap: wrap; } }

.dark .source-badge { color: #ebc781; background: #352e23; border-color: #5b4d31; }

.dark .image-fallback { background: #253347; color: #b5c4d9; }

.refresh-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.refresh-status { color: var(--color-text-secondary); font-size: 11px; line-height: 1.8; }
.sync-paused { color: #c68e45; }
.read-only-note { color: var(--color-text-secondary); font-size: 12px; margin: -5px 0 16px; }
.copy-order, .copy-customer { display: inline-flex; align-items: center; gap: 8px; text-align: left; user-select: text; }
.copy-order svg, .copy-customer svg { color: var(--color-text-secondary); flex-shrink: 0; }
.copy-order:hover svg, .copy-customer:hover svg { color: #91a9e9; }
.sort-payment, .sort-consumer { display: inline-flex; align-items: center; gap: 5px; color: inherit; font: inherit; cursor: pointer; }
.sort-payment svg, .sort-consumer svg { color: var(--color-chart-link); }
.copy-value { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; font: inherit; color: inherit; text-align: left; user-select: text; }
.copy-value span { min-width: 0; overflow-wrap: anywhere; }
.copy-value svg { flex-shrink: 0; color: var(--color-text-secondary); opacity: .7; }
.copy-value:hover svg, .copy-value:focus-visible svg { color: var(--color-chart-link); opacity: 1; }
.product-sku { min-width: 0; max-width: 100%; }
.multi-item-badge { display: block; width: fit-content; margin: 8px auto 0; color: var(--color-text-secondary); background: var(--color-surface-muted); border-radius: 4px; padding: 3px 6px; font-size: 10px; }
.copy-feedback { position: fixed; top: 82px; right: 24px; z-index: 70; padding: 10px 16px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 7px; box-shadow: 0 5px 20px #0002; font-size: 12px; }
@media (max-width: 700px) { .list-heading { flex-wrap: wrap; }.refresh-controls { justify-content: flex-start; } }

.product-sku-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; }
.product-quantity { display: inline-block; font-size: 11px; color: var(--color-text); background: var(--color-background); padding: 1px 6px; border-radius: 4px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.copy-order, .copy-customer { min-width: 0; max-width: 100%; white-space: normal; }
.copy-customer span { min-width: 0; overflow-wrap: anywhere; white-space: normal; }
.copy-order strong, .dispatch-numbers .copy-value span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.copy-order { gap: 4px; }
.order-cell .copy-order { max-width: calc(100% - 25px); gap: 3px; }
.salesperson-name, .salesperson-department { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.65; }
.salesperson-department { margin-top: 3px; font-size: 11px; color: var(--color-text-secondary); }
a.salesperson-department:hover { color: var(--color-chart-link); }
.copy-order svg, .copy-customer svg { flex-shrink: 0; }
.dispatch-numbers { min-width: 0; white-space: normal; }
.table-scroll :deep(.dispatch-status), .table-scroll :deep(.procurement-status) { min-width: 0; }
.status-pill, .table-scroll :deep(.dispatch-stage), .table-scroll :deep(.procurement-stage), .table-scroll :deep(.sort-status), .sort-payment { white-space: normal; flex-wrap: wrap; }
.table-scroll :deep(.order-currency-total) { white-space: normal; overflow-wrap: anywhere; }
.follow-up-order { max-width: 100%; white-space: normal; flex-wrap: wrap; }
.table-scroll :deep(.app-table-totals > tr > :is(th, td)) { position: static; overflow-wrap: anywhere; }
.compact-list-controls { display: none; }
@container order-list (max-width: 1680px) {
  .compact-list-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 22px; padding: 12px 20px; border-top: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-secondary); }
  .compact-list-controls label, .compact-list-controls button { display: inline-flex; align-items: center; gap: 7px; }
  table, tbody { display: block; width: 100%; }
  colgroup, thead { display: none; }
  .order-record { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) minmax(72px,.65fr) repeat(3,minmax(0,1fr)); padding: 16px 20px; gap: 18px 22px; border-bottom: 1px solid var(--color-border); }
  .order-record:nth-child(even) { background: color-mix(in srgb, var(--color-surface) 96%, var(--color-text)); }
  .order-record td { display: block; padding: 0; border: 0; background: transparent; min-width: 0; }
  .order-record .amount-cell { padding-left: 8px; }
  .order-record:hover td { background: transparent; }
  .order-record td::before { content: attr(data-label); display: block; font-size: 10px; font-weight: 500; color: var(--color-text-secondary); margin-bottom: 7px; }
  .order-record .order-cell { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); }
  .order-record .order-cell::before { display: none; }
  .order-cell .multi-item-badge { margin: 0 0 0 auto; }
  .order-record .product-cell { grid-column: span 2; grid-row: span var(--detail-rows, 3); }
  .order-record .logistics-info-cell, .order-record .dispatch-numbers, .order-record .tracking-cell { grid-column: span 2; }
  .table-scroll :deep(.app-table-totals) { display: block; }
  .table-scroll :deep(.app-table-totals > tr) { display: flex; flex-wrap: wrap; align-items: center; background: var(--color-total-surface); padding: 14px 20px; gap: 12px 24px; }
  .table-scroll :deep(.app-table-totals > tr > :is(th,td)) { display: block; border: 0; box-shadow: none; background: transparent; padding: 0; }
  .table-scroll :deep(.app-table-totals > tr > .total-spacer) { display: none; }
  .table-scroll :deep(.app-table-totals > tr > .total-caption) { margin-left: auto; }
}
@container order-list (max-width: 850px) {
  .order-record { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; padding: 16px; }
  .order-record .product-cell { grid-column: 1 / -1; grid-row: auto; }
  .order-record .product-cell .product { min-height: 65px; }
  .scope-filters { justify-content: flex-start; margin-left: 0; }
  .query-controls { flex-basis: 100%; }
}
@container order-list (max-width: 400px) {
  .order-record { grid-template-columns: minmax(0, 1fr); }
  .order-record .logistics-info-cell, .order-record .dispatch-numbers, .order-record .tracking-cell { grid-column: auto; }
  .order-record .amount-cell { padding-left: 0; }
  .query-controls .search-form { min-width: 0; flex-basis: 100%; }
  .department-filter { max-width: 100%; }
  .department-filter select { min-width:160px;max-width:280px; }
  .pagination > div { flex-wrap: wrap; }
}
.order-recipient{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0}.recipient-name{border:0;padding:0;background:none;color:var(--color-chart-link);font:inherit;text-align:left;line-height:1.5;white-space:normal;overflow-wrap:anywhere;max-width:100%;cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}.recipient-name:hover,.recipient-name:focus-visible{text-decoration-color:currentColor}.recipient-empty{color:var(--color-text-secondary)}
</style>

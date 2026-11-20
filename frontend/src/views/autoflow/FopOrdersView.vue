<script setup lang="ts">
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import OrderExceptionLabel from '@/components/autoflow/OrderExceptionLabel.vue'
import { vPickingNameTooltip } from '@/directives/picking-name-tooltip'
import { vTaskTableLayout } from '@/directives/task-table-layout'
import { skuPickingName } from '@/utils/product-display'
import { warehouseName } from '@/utils/warehouse'
import { workbenchTimeRange } from '@/utils/workbench-time-range'
import { useProductExpansion } from '@/composables/useProductExpansion'
import ProductExpansionButton from '@/components/autoflow/ProductExpansionButton.vue'
import CollapsibleProductLines from '@/components/autoflow/CollapsibleProductLines.vue'
import { isUncollectedPage } from '@/utils/workbench-data'
import { completedQueues, completedNames, completedTimeNames, completionTime } from '@/utils/completed-orders'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import { orderTimestamp } from '@/utils/order-timestamp'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { exportFopOrders, fopExportError } from '@/api/fop-order-export'
import { downloadBlob } from '@/utils/export'
import { formatKnownCurrency } from '@/utils/currency'
import AllocationInventoryDialog from '@/components/autoflow/AllocationInventoryDialog.vue'
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import WorkbenchStatusBadge from '@/components/autoflow/WorkbenchStatusBadge.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import WorkbenchRefreshControl from '@/components/autoflow/WorkbenchRefreshControl.vue'
import WorkbenchTableState from '@/components/autoflow/WorkbenchTableState.vue'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import OrderSortHeader from '@/components/autoflow/OrderSortHeader.vue'
import { sourceStatusLabel, businessStatusLabel, completedPurchaseLabel } from '@/utils/fulfillment-source-status'
import SupplierShipmentStatus from '@/components/autoflow/SupplierShipmentStatus.vue'
import ProcurementStatus from '@/components/autoflow/ProcurementStatus.vue'
import ProcurementSourceSummary from '@/components/autoflow/ProcurementSourceSummary.vue'
import ProcurementSourceDetailsDialog from '@/components/autoflow/ProcurementSourceDetailsDialog.vue'
import type { ProcurementSourceFilter } from '@/api/fop-orders'
import { canFilterTaskStatus, getTaskStatus, matchesTaskStatus, taskStatusHeading, taskStatusLabel, taskStatusOptions } from '@/utils/workbench-status'
import { canFilterProcurementStage, procurementStageLabels } from '@/utils/procurement-stage'
import OrderProductImage from '@/components/autoflow/OrderProductImage.vue'
import RecipientDetailsDialog from '@/components/autoflow/RecipientDetailsDialog.vue'
import ShippingCountryBadge from '@/components/autoflow/ShippingCountryBadge.vue'
import { normalizeShippingCountry } from '@/utils/shipping-country'
import OrderLogisticsChannels from '@/components/autoflow/OrderLogisticsChannels.vue'
import OrderLogisticsInfo from '@/components/autoflow/OrderLogisticsInfo.vue'
import LogisticsChannelName from '@/components/autoflow/LogisticsChannelName.vue'
import OrderApprovalDialog from '@/components/autoflow/OrderApprovalDialog.vue'
import { lockApprovalNavigation } from '@/utils/approvalNavigation'
import DispatchStatus from '@/components/autoflow/DispatchStatus.vue'
import TableTotals from '@/components/ui/TableTotals.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import OrderAmountBreakdown from '@/components/ui/OrderAmountBreakdown.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUp, ArrowDown, ArrowUpDown, Check, Copy, PackageSearch, Search, MessageCircle } from 'lucide-vue-next'
import { copyText } from '@/utils/copyText'
import { procurementPaymentTime } from '@/utils/procurement-payment'
import { getFopOrders, isFopOrderPageDataValid, orderItemQuantity, canSortFopQueue, isFopOrderSortBy, type FopOrderSortBy, isFopOrderQueue, isWarehouseStage, matchesFopQueue, type FopOrder, type FopOrderQuery, type FopQueuePage } from '@/api/fop-orders'
import { fopAccessError } from '@/api/fop-access'

import { defaultWorkbenchQueue, isWorkbenchRole, workbenchOrderLocation, workbenchQueues } from '@/utils/workbench'

type SearchRecovery = { token: symbol; from: string; to: string; search: string }
const props = defineProps<{ searchRecovery?: SearchRecovery; recoverPage?: (recovery: SearchRecovery) => Promise<void> }>()
const { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue } = useWorkbenchDepartment(computed(() => Object.fromEntries((data.value?.departments ?? []).map(d => [d.id, d.name]))))
const emit = defineEmits<{ 'clear-search-recovery': [token: symbol]; 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const role = computed(() => isWorkbenchRole(route.params.role) ? route.params.role : 'sales')
const completed = computed(() => route.query.queue === 'completed')
const isFulfilledDispatch = computed(() => completed.value && role.value === 'dispatch')
const showEventTime = computed(() => !isFulfilledDispatch.value)
const queue = computed(() => {
  if (completed.value) return completedQueues[role.value]
  const value = route.query.queue ?? defaultWorkbenchQueue(role.value)
  return isFopOrderQueue(value) && workbenchQueues[role.value].includes(value) ? value : undefined
})
const showProcurementSourceFilter = computed(() => role.value === 'procurement' && (queue.value === 'procurement' || queue.value === 'procurement_shipping'))
const procurementSource = computed(() => showProcurementSourceFilter.value && ['full_payment', 'deposit', 'direct'].includes(String(route.query.procurementSource)) ? route.query.procurementSource as ProcurementSourceFilter : undefined)
const skuAssociation = computed(() => queue.value === 'unpaid' ? route.query.skuAssociation === 'unlinked' ? 'unlinked' : 'linked' : undefined)
const timeRange = computed(() => completed.value ? workbenchTimeRange(route.query.timeRange) : queue.value === 'unpaid' ? workbenchTimeRange(route.query.timeRange, true) : undefined)
const shippingCountryCode = computed(() => queue.value === 'review' ? normalizeShippingCountry(route.query.shippingCountryCode) ?? '' : '')
const shippingCountries = computed(() => [...new Set((data.value?.shippingCountries ?? []).map(normalizeShippingCountry).filter((code): code is string => code !== null))].sort())
const countryFlag = (code: string) => String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)))
const selectedOrders = ref<string[]>([])
const inventoryOrderIds = ref<string[]>()
const approvalOrderIds = ref<string[]>()
const approvalQueue = computed(() => !completed.value && (queue.value === 'review' || queue.value === 'allocation_review') ? queue.value : undefined)
const billStatus = computed(() => approvalQueue.value && ['A','B'].includes(String(route.query.billStatus)) ? route.query.billStatus as 'A' | 'B' : undefined)
function canApproveRow(row: FopOrder) {
  if (approvalQueue.value === 'review') return row.rawBillStatus === 'B'
  const documents = row.allocationDocuments ?? (row.allocationDocument ? [row.allocationDocument] : [])
  return approvalQueue.value === 'allocation_review' && documents.length === 1 && documents[0].rawBillStatus === 'B' && getTaskStatus(row, 'allocation_review') === 'dispatch_complete'
}
const hasApprovableSelection = computed(() => selectedOrders.value.some(id => data.value?.items.some(row => row.id === id && canApproveRow(row))))
let unlockApproval: (() => void) | undefined
let approvalNeedsRefresh = false
function openApproval() {
  if (!approvalQueue.value || busy.value || !online.value || !hasApprovableSelection.value || approvalOrderIds.value) return
  approvalNeedsRefresh = false
  approvalOrderIds.value = selectedOrders.value.filter(id => data.value?.items.some(row => row.id === id && canApproveRow(row)))
  unlockApproval = lockApprovalNavigation()
}
function clearApproval() { approvalOrderIds.value = undefined; unlockApproval?.(); unlockApproval = undefined }
async function approvalCompleted() { approvalNeedsRefresh = true; selectedOrders.value = []; await load(false, true); if (!error.value) approvalNeedsRefresh = false }
function closeApproval() { clearApproval(); if (approvalNeedsRefresh) { approvalNeedsRefresh = false; void load() } }
function preventApprovalUnload(event: BeforeUnloadEvent) { if (approvalOrderIds.value) { event.preventDefault(); event.returnValue = '' } }
const exporting = ref<'selected' | 'filtered'>()
const exportFeedback = ref('')
const exportFailed = ref(false)
let listController: AbortController | undefined
let exportController: AbortController | undefined
function cancelExport() { exportController?.abort(); exportController = undefined; exporting.value = undefined; exportFeedback.value = '' }
function currentFilters(): Omit<FopOrderQuery, 'page' | 'pageSize'> {
  return { queue: queue.value!, billStatus: billStatus.value, skuAssociation: skuAssociation.value, ...(completed.value ? { completed: true } : {}), timeRange: timeRange.value, shippingCountryCode: shippingCountryCode.value || undefined, procurementStage: procurementStage.value, procurementSource: procurementSource.value, taskStatus: taskStatus.value, warehouseStage: !completed.value && queue.value === 'shipping' ? warehouseStage.value : undefined, departmentId: departmentId.value || undefined, ownerId: ownerId.value || undefined, warehouseCode: warehouseCode.value || undefined,
    search: typeof route.query.search === 'string' ? route.query.search : '', orderNumber: typeof route.query.orderNumber === 'string' ? route.query.orderNumber : undefined,
    paidAtOrder: paidAtOrder.value, sortBy: isFopOrderSortBy(route.query.sortBy) ? route.query.sortBy : 'consumerPaidAt',
    sortOrder: route.query.sortOrder === 'asc' || route.query.sortOrder === 'desc' ? route.query.sortOrder : completed.value ? 'desc' : undefined }
}
async function exportOrders(mode: 'selected' | 'filtered') {
  if (exporting.value || busy.value || !online.value || !queue.value || !data.value?.total || (mode === 'selected' && !selectedOrders.value.length)) return
  const controller = new AbortController()
  exportController = controller
  const session = captureSession()
  const label = completed.value ? completedNames[role.value][zh.value ? 0 : 1] : labels.value[queue.value]
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
const offSession = onSessionReset(() => {
  listController?.abort(); inventoryOrderIds.value = undefined; clearApproval(); approvalNeedsRefresh = false; cancelExport(); selectedOrders.value = []; recipientOrderId.value = undefined; data.value = undefined; requestId++ })
const pageSelected = computed(() => !!data.value?.items.length && data.value.items.every(row => selectedOrders.value.includes(row.id)))
function togglePage(checked: boolean) { selectedOrders.value = checked ? data.value?.items.map(row => row.id) ?? [] : [] }
const isAllocation = computed(() => queue.value === 'allocation' || queue.value === 'allocation_review')
const showDispatchNumbers = computed(() => queue.value === 'dispatch' || isAllocation.value)
const procurementStage = computed(() => !completed.value && canFilterProcurementStage(queue.value ?? '', route.query.procurementStage) ? route.query.procurementStage : undefined)
const taskStatus = computed(() => !completed.value && canFilterTaskStatus(queue.value ?? '', route.query.taskStatus) ? route.query.taskStatus : undefined)
const statusOptions = computed(() => completed.value ? [] : taskStatusOptions(queue.value ?? ''))
const filterStatusHeading = computed(() => taskStatusHeading(queue.value ?? '')[zh.value ? 0 : 1])
const statusHeading = computed(() => queue.value === 'procurement' ? text('采购状态', 'Purchase status') : queue.value === 'shipping' ? text('出库状态', 'Outbound status') : completed.value ? queue.value === 'dispatch' ? text('履约状态', 'Fulfillment status') : queue.value === 'allocation_review' ? text('审核状态', 'Approval status') : text('完成状态', 'Completion status') : taskStatusHeading(queue.value ?? '')[zh.value ? 0 : 1])
const pendingOutbound = computed(() => queue.value === 'shipping' && !completed.value)
const hasStatus = computed(() => completed.value ? queue.value !== 'review' : statusOptions.value.length > 0)
function exceptionReason(order: FopOrder): string { return order.exception?.reason || '' }
function statusLabel(order: FopOrder) {
  if (queue.value === 'exceptions' && order.dataQuality?.readOnly && !order.exception?.type) return text('待核查', 'Needs review')
  return taskStatusLabel(getTaskStatus(order, queue.value ?? ''), queue.value ?? '')[zh.value ? 0 : 1] }
const warehouseStage = computed(() => isWarehouseStage(route.query.warehouseStage) ? route.query.warehouseStage : 'all')
const labels = computed(() => ({ unpaid: text('待支付', 'Pending payment'), procurement_shipping: text('已采购待发货', 'Purchased · shipment pending'), allocation_review: text('已齐套未审核', 'Fully allocated · approval pending'), procurement: text('待采购', 'Pending purchase'), review: text('待审核', 'Pending review'), allocation: text('未齐套', 'Incomplete allocation'), dispatch: text('待履约', 'Pending fulfillment'), shipping: text('待出库', 'Pending outbound'), exceptions: text('异常订单', 'Order exceptions') }))
const descriptions = computed(() => ({
  unpaid: text('展示订单状态为“未关联本地 SKU”或“待支付”的履约订单，排除源单已发货及源单付款状态为已退款、已作废、已过期、未付款的订单；时间取C端源单付款时间。', 'Fulfillment orders with status “Local SKU not linked” or “Pending payment”, excluding fulfilled source orders and refunded, voided, expired or unpaid source payments. Dates use source-order buyer payment time.'),
  procurement: text('跟进采购建单、1688 下单及采购付款，业务处理请在 FOP 完成。', 'Track purchase preparation, 1688 placement and payment. Process orders in FOP.'),
  procurement_shipping: text('展示直接采购及全款／押金备货中已采购待发货的商品。', 'Items awaiting supplier shipment from direct purchases, fully paid stock or deposit stock.'),
  allocation_review: text('已齐套的配货单待审核；发运单制作完成后，可单笔或批量审核配货单。请及时处理未完成的发运单后审核配货单。', 'Fully allocated documents awaiting approval. Once dispatch preparation is complete, approve allocations individually or in batches. Please complete unfinished dispatch documents promptly, then approve the allocation documents.'),
  review: text('订单状态已支付、单据状态暂存或已提交的履约订单。', 'Paid fulfillment orders with draft or submitted document status.'),
  allocation: text('已生成配货单但尚未齐套，可按选中订单查询即时库存，配货操作请在 FOP 完成。', 'Existing allocation documents awaiting stock completion. Query current inventory for selected orders and allocate in FOP.'),
  dispatch: text('已审核履约订单按实际跟踪号区分待建发运单、已建单未取号、已取号未同步；取消履约进入订单异常，部分履约及已履约进入已履约清单。', 'Approved orders grouped by current tracking; cancelled fulfillment moves to order exceptions, while partial and full fulfillment move to fulfilled orders.'),
  shipping: text('配货单已审核，按履约订单整单跟进打包及出库。', 'Approved allocations awaiting packing and whole-order outbound completion.'),
  exceptions: text('按异常类型跟进；正常清单同时保留业务行并标红，问题解决且同步后取消异常。', 'Track exceptions alongside normal queues; resolved issues clear after synchronization.'),
}))
const search = ref('')
const data = ref<FopQueuePage>()
const unavailable = computed(() => isUncollectedPage(data.value))
const departmentId = computed(() => typeof route.query.departmentId === 'string' ? route.query.departmentId : '')
const departments = computed(() => data.value?.departments ?? [])
const ownerId = computed(() => typeof route.query.ownerId === 'string' ? route.query.ownerId : '')
const warehouseCode = computed(() => route.query.warehouseCode === 'HZ' || route.query.warehouseCode === 'SZ' ? route.query.warehouseCode : '')
const selectedOwnerName = computed(() => data.value?.salespeople?.find(person => person.id === ownerId.value)?.name ?? text('指定业务员', 'Selected salesperson'))
const recipientOrderId = ref<string>()
const recipientOrder = computed(() => data.value?.items.find(order => order.id === recipientOrderId.value && order.shippingRecipient))
watch(recipientOrder, order => { if (!order) recipientOrderId.value = undefined })
const sourceSelection = ref<{ orderId: string; skuId: string }>()
const sourceDetails = computed(() => {
  if (!sourceSelection.value) return undefined
  const order = data.value?.items.find(row => row.id === sourceSelection.value?.orderId)
  const source = order?.items.find(item => item.procurementSource?.skuId === sourceSelection.value?.skuId)?.procurementSource
  return order && source ? { orderNumber: order.orderNumber, source } : undefined
})
watch(sourceDetails, details => { if (!details) sourceSelection.value = undefined })
const followUpOrder = ref<{ id: string; orderNumber: string }>()
watch(() => route.fullPath, () => { followUpOrder.value = undefined; recipientOrderId.value = undefined; sourceSelection.value = undefined })
const busy = ref(false)
const error = ref('')
const online = ref(navigator.onLine)
const currentTime = ref(Date.now())
const copiedValue = ref('')
const copyMessage = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
let recoveringPage = false
const page = computed(() => Number(route.query.page || 1))
const pageSize = computed(() => Number(route.query.pageSize || 100))
const sortBy = computed<FopOrderSortBy>(() => isFopOrderSortBy(route.query.sortBy) ? route.query.sortBy : 'consumerPaidAt')
const sortOrder = computed(() => route.query.sortOrder === 'desc' ? 'desc' : route.query.sortOrder === 'asc' ? 'asc' : sortBy.value === 'paidAt' ? route.query.paidAtOrder === 'asc' ? 'asc' : 'desc' : ['completedAt', 'consumerPaidAt', 'reviewedAt'].includes(sortBy.value) ? 'desc' : 'asc')
const paidAtOrder = computed(() => sortBy.value === 'paidAt' ? sortOrder.value : 'desc')
const leadingSortField = computed<FopOrderSortBy | undefined>(() => completed.value ? undefined : isAllocation.value || queue.value === 'dispatch' ? 'dispatchDocumentStatus' : queue.value === 'shipping' ? 'outboundStatus' : undefined)
const dispatchSortHint = computed(() => isAllocation.value ? text('未完成 → 已完成；关联发运单全部审核后为已完成', 'Incomplete → Complete; all linked dispatch documents approved') : queue.value === 'dispatch' ? text('待建发运单 → 已建单未取号 → 已取号未同步；依据履约订单状态与有效跟踪号，未知置后', 'Awaiting dispatch → Created, awaiting tracking → Tracking obtained; native order state and active tracking, unknown last') : text('未创建 → 暂存 → 已提交 → 已审核 → 已同步；多单取最早进度；含未知状态的订单置后', 'Not created → Draft → Submitted → Approved → Synced; earliest document stage; orders with unknown statuses last'))
function sortDirection(field: FopOrderSortBy) { return sortBy.value === field ? sortOrder.value : undefined }
function sortStatus(field: FopOrderSortBy) {
  return navigate({ sortBy: field, sortOrder: sortBy.value === field ? sortOrder.value === 'asc' ? 'desc' : 'asc' : field === 'completedAt' ? 'desc' : 'asc', page: 1 })
}
function sortPayment() {
  const direction = sortBy.value === 'paidAt' && paidAtOrder.value === 'asc' ? 'desc' : 'asc'
  return navigate({ sortBy: 'paidAt', sortOrder: direction, paidAtOrder: direction, page: 1 })
}
const sortHint = computed(() => sortBy.value !== 'paidAt' ? text('点击按最早收款在前排序', 'Click for oldest payment first') : paidAtOrder.value === 'asc'
  ? text('最早收款在前，点击切换为最新收款在前', 'Oldest payment first; click for newest first')
  : text('最新收款在前，点击切换为最早收款在前', 'Newest payment first; click for oldest first'))
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize.value)))
const extraConsumerTime = computed(() => completed.value || ['procurement', 'procurement_shipping', 'allocation_review', 'shipping'].includes(queue.value ?? ''))
// Structural count only; the shared directive owns every column width.
const showOrderRemark = computed(() => queue.value === 'review' && !completed.value)
const columnCount = computed(() => 8 - (pendingOutbound.value ? 2 : 0)
  + (showOrderRemark.value ? 1 : 0)
  + (queue.value === 'review' ? 2 : 1)
  + (queue.value !== 'unpaid' ? 1 : 0)
  + (queue.value === 'allocation_review' && completed.value ? 1 : 0)
  + (showDispatchNumbers.value ? 1 : 0)
  + (hasStatus.value ? 1 : 0)
  + (queue.value === 'exceptions' ? 2 : 0)
  + (['unpaid', 'dispatch', 'shipping'].includes(queue.value ?? '') ? 1 : 0)
  + (extraConsumerTime.value ? 1 : 0)
  + (showEventTime.value ? 1 : 0)
  + (queue.value === 'procurement_shipping' ? 1 : 0))
let requestId = 0

function reloadReplica() { inventoryOrderIds.value = undefined; recipientOrderId.value = undefined; followUpOrder.value = undefined; clearApproval(); approvalNeedsRefresh = false; cancelExport(); selectedOrders.value = []; void load(true) }
async function load(reset = false, afterApproval = false) {
  currentTime.value = Date.now()
  if (approvalOrderIds.value && !afterApproval) return
  // The access guard temporarily unmounts this child before committing navigation.
  // Do not fetch/recover the old page again if it remounts in that interval.
  if (props.searchRecovery?.from === route.fullPath) { busy.value = true; return }
  if (!reset && busy.value) return
  const currentRequest = ++requestId
  listController?.abort()
  if (reset) {
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
  if (queue.value === 'shipping' && !completed.value && route.query.taskStatus === 'outbound_partial') {
    busy.value = false
    await router.replace({ query: { ...route.query, taskStatus: 'outbound_pending', page: '1' } })
    return
  }
  if (queue.value === 'dispatch' && ['dispatch_updating', 'dispatch_synced', 'dispatch_cancelled'].includes(String(route.query.taskStatus))) {
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
  if (isAllocation.value && typeof route.query.taskStatus === 'string'
    && ['dispatch_missing', 'dispatch_draft', 'dispatch_submitted', 'dispatch_approved', 'dispatch_synced', 'unknown'].includes(route.query.taskStatus)) {
    const completed = ['dispatch_approved', 'dispatch_synced'].includes(route.query.taskStatus)
    busy.value = false
    await router.replace({ query: { ...route.query, taskStatus: completed ? 'dispatch_complete' : 'dispatch_incomplete', page: '1' } })
    return
  }
  if (!Number.isInteger(page.value) || page.value < 1 || ![20, 50, 100, 200, 500, 1000].includes(pageSize.value)) {
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
  if (route.query.procurementSource !== undefined && !procurementSource.value) {
    busy.value = false
    error.value = text('采购来源筛选无效，请重新选择。', 'Invalid procurement source. Please select again.')
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
  listController = new AbortController()
  try {
    const result = await getFopOrders({ ...currentFilters(), page: page.value, pageSize: pageSize.value }, listController.signal)
    if (currentRequest !== requestId) return
    if (!isFopOrderPageDataValid(result)) throw new Error('Unexpected partial data')
    if (!result.items.every(order => matchesFopQueue(order, selectedQueue, warehouseStage.value, completed.value) && (!taskStatus.value || matchesTaskStatus(order, selectedQueue, taskStatus.value)) && (!procurementStage.value || getTaskStatus(order, selectedQueue) === procurementStage.value))) throw new Error('Unexpected queue data')
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > lastPage) {
      recoveringPage = true
      const location = listLocation({ page: lastPage }, selectedQueue)
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
function syncLocalStatus() {
  currentTime.value = Date.now()
  online.value = navigator.onLine
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
  document.addEventListener('visibilitychange', syncLocalStatus)
  window.addEventListener('focus', syncLocalStatus)
  window.addEventListener('online', syncLocalStatus)
  window.addEventListener('offline', syncLocalStatus)
})
onBeforeUnmount(() => {
  listController?.abort()
  clearApproval()
  window.removeEventListener('beforeunload', preventApprovalUnload)
  cancelExport()
  offSession()
  requestId++
  clearTimeout(copyTimer)
  document.removeEventListener('visibilitychange', syncLocalStatus)
  window.removeEventListener('focus', syncLocalStatus)
  window.removeEventListener('online', syncLocalStatus)
  window.removeEventListener('offline', syncLocalStatus)
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
function listLocation(values: Record<string, string | number | undefined>, selectedQueue = queue.value!) {
  return completed.value ? { name: 'RoleWorkbench', params: { role: role.value }, query: { ...route.query, ...values, queue: 'completed' } }
    : workbenchOrderLocation(selectedQueue, { ...route.query, ...values })
}
function navigate(values: Record<string, string | number | undefined>) {
  if (!queue.value) return
  return router.push(listLocation(values))
}
function clearSearchIfEmpty(event: Event) {
  if (!(event.target as HTMLInputElement).value.trim() && typeof route.query.search === 'string' && route.query.search.trim()) {
    search.value = ''
    void navigate({ search: undefined, page: 1 })
  }
}
function submitSearch() { return navigate({ search: search.value.trim() || undefined, page: 1 }) }
const usesConsumerOrderTime = computed(() => ['unpaid', 'review', 'exceptions', 'dispatch', 'allocation'].includes(queue.value ?? ''))
const timeSortField = computed(() => !showEventTime.value ? null : completed.value ? 'completedAt' as const : queue.value === 'procurement' ? 'reviewedAt' as const : usesConsumerOrderTime.value ? 'consumerPaidAt' as const : null)
const createdTimeLabel = computed(() => completed.value ? completedTimeNames[role.value][zh.value ? 0 : 1] : queue.value === 'shipping' ? text('WMS创建时间', 'WMS creation time') : queue.value === 'procurement' ? text('订单审核时间', 'Order approval time') : queue.value === 'allocation_review' ? text('齐套时间', 'Allocation completion time') : queue.value === 'procurement_shipping' ? text('采购付款时间', 'Procurement payment time') : queue.value === 'unpaid' ? text('C端付款时间', 'Buyer payment time') : usesConsumerOrderTime.value ? text('客户付款时间', 'Customer payment time') : text('创建时间', 'Created at'))
const searchPlaceholder = computed(() => queue.value === 'unpaid' ? text('订单 / Shopify单号 / 客户 / SKU / 自定义物流渠道', 'Order / Shopify / customer / SKU / custom channel') : text('业务员 / 订单 / 客户 / SKU / 物流服务商', 'Salesperson / order / customer / SKU / carrier'))
const searchHint = computed(() => queue.value === 'unpaid' ? text('支持按业务员姓名、订单编号、Shopify 单号、客户、店铺、SKU 或自定义物流渠道名称查询', 'Search by salesperson name, order number, Shopify order, customer, store, SKU or custom logistics channel name') : text('支持按业务员姓名、订单编号、Shopify 单号、客户、店铺、SKU 或物流服务商查询', 'Search by salesperson name, order number, Shopify order, customer, store, SKU or carrier'))
const createdTimeHint = computed(() => completed.value ? role.value === 'dispatch'
  ? text('关联有效发运单的最后审核时间（UTC+8），不是Shopify同步完成时间', 'Latest approval time of current shipments (UTC+8), not Shopify sync time')
  : text('当前阶段实际完成时间（UTC+8）', 'Actual phase completion time (UTC+8)') : queue.value === 'shipping' ? text('发货通知成功推送 WMS 出库指令的时间（UTC+8）', 'Delivery notice successfully sent to WMS for outbound processing (UTC+8)') : queue.value === 'procurement' ? text('履约订单实际审核时间（UTC+8）', 'Actual fulfillment order approval time (UTC+8)') : queue.value === 'allocation_review'
  ? text('当前配货单实际齐套时间（UTC+8）；释放后重新齐套以最新齐套时间为准', 'Current allocation completion (UTC+8); reallocation uses the latest completion time')
  : queue.value === 'procurement_shipping'
  ? text('实际采购付款时间（UTC+8）；关联多笔采购时取最早付款时间；任一时间未知则留空', 'Actual procurement payment (UTC+8); earliest linked purchase payment; blank if any timestamp is unknown')
  : queue.value === 'unpaid' ? text('C端付款时间，取履约订单源单付款时间（UTC+8）；未填写时留空', 'Buyer payment time from the source order (UTC+8); blank when unavailable')
  : queue.value === 'review' ? text('客户完成付款时间（UTC+8）；未填写时显示为空', 'Completed customer payment time (UTC+8); blank when unavailable')
  : usesConsumerOrderTime.value ? text('客户完成付款时间（UTC+8）；未填写时显示为空', 'Completed customer payment time (UTC+8); blank when unavailable') : undefined)
function orderTime(order: FopOrder): string | null {
  if (completed.value) return completionTime(order, role.value)
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
  if (queue.value === 'unpaid') return order.sourceOrderPaidAt ?? null
  return usesConsumerOrderTime.value ? order.paidAt ?? null : order.createdAt
}
const consumerSortHint = computed(() => completed.value && role.value === 'dispatch'
  ? sortDirection('completedAt') === 'asc' ? text('最早审核在前，点击切换为最新审核在前', 'Oldest approval first; click for newest first')
    : sortDirection('completedAt') === 'desc' ? text('最新审核在前，点击切换为最早审核在前', 'Newest approval first; click for oldest first')
    : text('点击按最新审核在前排序', 'Click for newest approval first')
  : completed.value ? sortDirection('completedAt') === 'asc' ? text('最早完成在前，点击切换为最新完成在前', 'Oldest completion first; click for newest first') : sortDirection('completedAt') === 'desc' ? text('最新完成在前，点击切换为最早完成在前', 'Latest completion first; click for oldest first') : text('点击按最新完成在前排序', 'Click for latest completion first') : timeSortField.value === 'reviewedAt' ? sortDirection('reviewedAt') === 'asc' ? text('最早审核在前，点击切换为最新审核在前', 'Oldest approval first; click for newest first') : sortDirection('reviewedAt') === 'desc' ? text('最新审核在前，点击切换为最早审核在前', 'Newest approval first; click for oldest first') : text('点击按最早审核在前排序', 'Click for oldest approval first') : sortDirection(timeSortField.value ?? 'consumerPaidAt') === 'asc'
  ? text('最早付款在前，点击切换为最新付款在前', 'Oldest payment first; click for newest first')
  : sortDirection(timeSortField.value ?? 'consumerPaidAt') === 'desc' ? text('最新付款在前，点击切换为最早付款在前', 'Newest payment first; click for oldest first')
  : text('点击按最早付款在前排序', 'Click for oldest payment first'))
const formatDate = (value: string | null) => value ? new Date(value).toLocaleString(zh.value ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const formatMoney = (amount: number | null, currency: string | null) => formatKnownCurrency(amount, currency, zh.value ? 'zh-CN' : 'en-US')
const { expandedProductIds, hasExpandableProducts, allProductsExpanded, setProductExpanded, toggleAllProducts } = useProductExpansion(() => data.value?.items ?? [], row => row.items)
</script>

<template>
  <div class="fulfillment-page" :aria-busy="busy">
      <WorkbenchTaskHeading :data-availability="data?.dataAvailability" :replica="data?.replica" :sync-disabled="busy || !!exporting || !!approvalOrderIds" @replica-synced="reloadReplica" class="list-heading" :title="completed ? completedNames[role][zh ? 0 : 1] : (queue ? labels[queue] : text('履约订单', 'Fulfillment orders')) + (queue && !['exceptions', 'allocation_review', 'procurement_shipping'].includes(queue) ? text('清单', ' orders') : '')" :description="completed ? role === 'sales' ? text('单据状态为已审核的履约订单，默认按客户付款时间查询近一月。', 'Approved fulfillment orders, defaulting to the last month by customer payment time.') : undefined : queue ? descriptions[queue] : undefined">
        <slot name="heading-actions" /><WorkbenchRefreshControl :busy="busy" :disabled="busy || !queue || !online" :refreshed-at="data?.refreshedAt" :offline="!online" @refresh="load()" />
      </WorkbenchTaskHeading>
      <p v-if="queue === 'shipping' && warehouseStage === 'pending_review'" class="read-only-note">{{ text('已齐套未审核已归入配货工作台。', 'Allocation approval is tracked in the Allocation Workbench.') }} <button class="clear-selection" @click="navigate({ warehouseStage: undefined, page: 1 })">{{ text('查看待出库清单', 'View pending outbound') }}</button></p>
      <p v-if="copyMessage" class="copy-feedback" role="status">{{ copyMessage }}</p>
      <section class="list-panel">
        <div class="list-toolbar workbench-filter-toolbar">
          <div class="query-controls workbench-filter-main">
            <form class="search-form workbench-filter-search" @submit.prevent="submitSearch"><label class="search-field workbench-search-field"><Search :size="16" /><input v-model="search" type="search" @input="clearSearchIfEmpty" :aria-label="text('搜索履约订单', 'Search fulfillment orders')" :placeholder="searchPlaceholder" :title="searchHint" /></label><button class="workbench-button workbench-primary" :disabled="busy || !queue">{{ text('查询', 'Search') }}</button></form>
            <label class="department-filter"><span>{{ text('业务部门', 'Business department') }}</span><select class="workbench-filter-select" :value="departmentId" :disabled="busy || !queue" :aria-label="text('业务部门', 'Business department')" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, ownerId: undefined, page: 1 })"><option :value="defaultDepartmentValue(departments, departmentId)">{{ defaultDepartmentLabel }}</option><option v-if="departmentId && !departments.some(item => item.id === departmentId)" :value="departmentId" disabled>{{ text('所选业务部门', 'Selected business department') }}</option><option v-for="department in departmentOptions(departments)" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
            <label class="department-filter warehouse-filter"><span>{{ text('发货仓库', 'Shipping warehouse') }}</span><select class="workbench-filter-select" :value="warehouseCode" :disabled="busy || !queue" :aria-label="text('发货仓库', 'Shipping warehouse')" @change="navigate({ warehouseCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ 'HangZhou' }}</option><option value="SZ">{{ 'ShenZhen' }}</option></select></label>
          <div class="workbench-filter-export"><WorkbenchExportButton :selected-count="selectedOrders.length" :total="data?.total ?? 0" :disabled="busy || !online || !data" :busy="!!exporting" @export="exportOrders" /></div></div>
          <div class="workbench-filter-secondary">
            <label v-if="showProcurementSourceFilter" class="department-filter"><span>{{ text('采购来源', 'Procurement source') }}</span><select class="workbench-filter-select" :value="procurementSource || ''" :disabled="busy" :aria-label="text('采购来源', 'Procurement source')" @change="navigate({ procurementSource: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部来源', 'All sources') }}</option><option value="full_payment">{{ text('全款备货', 'Fully paid stock') }}</option><option value="deposit">{{ text('押金备货', 'Deposit stock') }}</option><option value="direct">{{ text('直接采购', 'Direct purchase') }}</option></select></label>
            <label v-if="queue === 'unpaid'" class="department-filter"><span>{{ text('关联SKU', 'SKU association') }}</span><select class="workbench-filter-select" :value="skuAssociation" :disabled="busy" :aria-label="text('关联SKU', 'SKU association')" @change="navigate({ skuAssociation: ($event.target as HTMLSelectElement).value, page: 1 })"><option value="linked">{{ text('已关联', 'Linked') }}</option><option value="unlinked">{{ text('未关联', 'Unlinked') }}</option></select></label>
            <label v-if="approvalQueue" class="department-filter"><span>{{ text('单据状态', 'Document status') }}</span><select class="workbench-filter-select" :value="billStatus || ''" :disabled="busy" :aria-label="text('单据状态', 'Document status')" @change="navigate({ billStatus: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="A">{{ text('暂存', 'Draft') }}</option><option value="B">{{ text('已提交', 'Submitted') }}</option></select></label>
            <label v-if="completed" class="department-filter">{{ text('客户付款时间', 'Customer payment time') }}<select class="workbench-filter-select" :value="timeRange" :disabled="busy" :aria-label="text('客户付款时间范围', 'Customer payment time range')" @change="navigate({ timeRange: ($event.target as HTMLSelectElement).value, page: 1 })"><option value="1w">{{ text('近一周', 'Last week') }}</option><option value="1m">{{ text('近一月', 'Last month') }}</option><option value="3m">{{ text('近三月', 'Last three months') }}</option></select></label>
          <label v-if="queue === 'unpaid'" class="department-filter"><span>{{ text('C端付款时间', 'Buyer payment time') }}</span>
              <select class="workbench-filter-select" :value="timeRange" :disabled="busy" :aria-label="text('C端付款时间范围', 'Buyer payment time range')" @change="navigate({ timeRange: ($event.target as HTMLSelectElement).value, page: 1 })">
                <option value="all">{{ text('全部', 'All') }}</option><option value="1w">{{ text('近一周', 'Last week') }}</option><option value="1m">{{ text('近一月', 'Last month') }}</option><option value="3m">{{ text('近三月', 'Last three months') }}</option>
              </select>
            </label>
            <label v-if="queue === 'review'" class="department-filter"><span>{{ text('发货国家', 'Shipping country') }}</span>
              <select class="workbench-filter-select" :value="shippingCountryCode" :disabled="busy" :aria-label="text('发货国家', 'Shipping country')" @change="navigate({ shippingCountryCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })">
                <option value="">{{ text('全部', 'All') }}</option>
                <option v-if="shippingCountryCode && !shippingCountries.includes(shippingCountryCode)" :value="shippingCountryCode" disabled>{{ countryFlag(shippingCountryCode) }} {{ shippingCountryCode }}{{ busy ? '' : text('（无匹配订单）', ' (no matching orders)') }}</option>
                <option v-for="code in shippingCountries" :key="code" :value="code">{{ countryFlag(code) }} {{ code }}</option>
              </select>
            </label>
            <label v-if="hasStatus && !completed" class="department-filter status-filter">{{ filterStatusHeading }}
              <select class="workbench-filter-select" :value="taskStatus ?? (procurementStage ? `legacy:${procurementStage}` : '')" :disabled="busy" :aria-label="`${filterStatusHeading}${text('筛选', ' filter')}`" @change="navigate({ taskStatus: ($event.target as HTMLSelectElement).value || undefined, procurementStage: undefined, page: 1 })">
                <option value="">{{ queue === 'dispatch' ? text('全部待履约', 'All pending fulfillment') : text('全部状态', 'All statuses') }}</option>
                <option v-if="procurementStage && !taskStatus" :value="`legacy:${procurementStage}`" disabled>{{ procurementStageLabels[procurementStage][zh ? 0 : 1] }}{{ text('（原筛选）', ' (legacy filter)') }}</option>
                <option v-for="value in statusOptions" :key="value" :value="value">{{ taskStatusLabel(value, queue ?? '')[zh ? 0 : 1] }}</option>
              </select>
            </label>
            <span class="result-count" aria-live="polite">{{ unavailable ? '—' : data ? text(`共 ${data.total} 笔订单`, `${data.total} orders`) : '—' }}</span>
          </div>
        </div>
        <WorkbenchListActions :selected-count="selectedOrders.length" @clear="selectedOrders = []">
          <button v-if="approvalQueue" type="button" class="workbench-button workbench-primary" data-testid="open-approval" :disabled="busy || !online || !hasApprovableSelection || !data || !!approvalOrderIds" :title="queue === 'allocation_review' ? text('审核发运单制作已完成的配货单', 'Approve allocations with completed dispatch preparation') : undefined" @click="openApproval"><Check :size="15" />{{ text('审核', 'Approve') }}</button>
          <button v-if="!completed && (queue === 'allocation' || queue === 'shipping')" type="button" class="workbench-button" data-testid="open-inventory" :disabled="busy || !online || !data" @click="inventoryOrderIds = [...selectedOrders]"><PackageSearch :size="15" />{{ text('查询即时库存', 'Current inventory') }}</button>
          <ProductExpansionButton :expanded="allProductsExpanded" :disabled="busy || !hasExpandableProducts" @toggle="toggleAllProducts" />
          <template #pagination><WorkbenchPagination :page="page" :page-size="pageSize" :pages="pageCount" :disabled="busy || !data" @page="navigate({ page: $event })" @page-size="navigate({ pageSize: $event, page: 1 })" /></template>
        </WorkbenchListActions>
        <p v-if="exportFeedback" class="export-feedback workbench-feedback" :class="{ 'export-error': exportFailed }" :role="exportFailed ? 'alert' : 'status'">{{ exportFeedback }}</p>
        <div v-if="procurementStage && taskStatus" class="exact-filter legacy-status-filter"><span>{{ text('原采购筛选', 'Legacy purchase filter') }}：{{ procurementStageLabels[procurementStage][zh ? 0 : 1] }}</span><button :disabled="busy" :aria-label="text('清除原采购状态筛选', 'Clear legacy purchase status filter')" @click="navigate({ procurementStage: undefined, page: 1 })">{{ text('清除', 'Clear') }}</button></div>
        <div v-if="ownerId" class="exact-filter legacy-owner-filter"><span>{{ text('业务员', 'Salesperson') }}：{{ selectedOwnerName }}</span><button :disabled="busy" @click="navigate({ ownerId: undefined, page: 1 })">{{ text('清除业务员筛选', 'Clear salesperson filter') }}</button></div>
        <div v-if="route.query.orderNumber" class="exact-filter"><span>{{ text('指定订单', 'Selected order') }}：{{ route.query.orderNumber }}</span><button @click="navigate({ orderNumber: undefined, page: 1 })">{{ text('查看该类全部订单', 'View all orders in this queue') }}</button></div>
        <p v-if="error && !queue" class="state-message error-message" role="alert">{{ error }}</p>
        <template v-if="queue">
          <div class="compact-list-controls">
            <label><input type="checkbox" class="order-checkbox" :checked="pageSelected" :indeterminate="!!selectedOrders.length && !pageSelected" :disabled="busy || !data?.items?.length" :aria-label="text('选择本页全部订单', 'Select current page')" @change="togglePage(($event.target as HTMLInputElement).checked)" />{{ text('订单编号', 'Order number') }}</label>
            <button v-if="queue !== 'unpaid'" class="compact-payment-sort" :disabled="busy" :aria-label="`${text('按收款日期排序', 'Sort payment date')}：${sortHint}`" @click="sortPayment()">{{ text('收款日期', 'Payment date') }}<component :is="sortBy !== 'paidAt' ? ArrowUpDown : paidAtOrder === 'asc' ? ArrowUp : ArrowDown" :size="13" /></button>
            <button v-if="timeSortField" class="compact-consumer-sort" :disabled="busy" :aria-label="`${createdTimeLabel}：${consumerSortHint}`" @click="sortStatus(timeSortField)">{{ createdTimeLabel }}<component :is="sortDirection(timeSortField) === 'asc' ? ArrowUp : sortDirection(timeSortField) === 'desc' ? ArrowDown : ArrowUpDown" :size="13" /></button>
            <button v-if="extraConsumerTime" class="compact-consumer-payment-sort" :disabled="busy" @click="sortStatus('consumerPaidAt')">{{ text('客户付款时间', 'Customer payment time') }}<component :is="sortDirection('consumerPaidAt') === 'desc' ? ArrowDown : ArrowUp" :size="13" /></button>
            <button v-if="leadingSortField" class="compact-status-sort" :disabled="busy" :aria-label="`${statusHeading}：${sortDirection(leadingSortField) === 'asc' ? text('当前升序，点击降序', 'Ascending; sort descending') : sortDirection(leadingSortField) === 'desc' ? text('当前降序，点击升序', 'Descending; sort ascending') : text('点击按状态升序排列', 'Sort status ascending')}`" @click="sortStatus(leadingSortField)">{{ statusHeading }}<component :is="sortDirection(leadingSortField) === 'asc' ? ArrowUp : sortDirection(leadingSortField) === 'desc' ? ArrowDown : ArrowUpDown" :size="13" /></button>
          </div>
          <div class="table-scroll workbench-list-body" :aria-label="text('履约订单明细表', 'Fulfillment orders')">
            <table v-task-table-layout class="workbench-task-table">

              <thead><tr>
                <th class="order-cell" :aria-sort="pendingOutbound ? sortDirection('outboundStatus') === 'asc' ? 'ascending' : sortDirection('outboundStatus') === 'desc' ? 'descending' : 'none' : undefined"><input type="checkbox" class="order-checkbox" :checked="pageSelected" :indeterminate="!!selectedOrders.length && !pageSelected" :disabled="busy || !data?.items?.length" :aria-label="text('全选当前页订单', 'Select all orders on this page')" @change="togglePage(($event.target as HTMLInputElement).checked)" />{{ text('订单编号', 'Order number') }}<button v-if="pendingOutbound" type="button" class="identity-outbound-sort" :disabled="busy" :aria-label="`${statusHeading}：${sortDirection('outboundStatus') === 'asc' ? '当前升序，点击降序' : sortDirection('outboundStatus') === 'desc' ? '当前降序，点击升序' : '点击按状态升序排列'}`" @click="sortStatus('outboundStatus')">{{statusHeading}}<component :is="sortDirection('outboundStatus') === 'asc' ? ArrowUp : sortDirection('outboundStatus') === 'desc' ? ArrowDown : ArrowUpDown" :size="12" /></button></th>
                <th class="product-cell">{{ text('商品图片 / 商品信息', 'Product image / details') }}</th>
                <th class="shopify-cell">{{ text('Shopify 单号', 'Shopify order') }}</th><th class="amount-cell">{{ text('订单金额', 'Order amount') }}</th>
                <th :title="text('订单收货国家', 'Delivery destination country')">Customer</th>
                <th v-if="queue === 'review'">{{ text('物流信息', 'Logistics information') }}</th>
                <th v-if="queue === 'review'">{{ text('发货仓库', 'Shipping warehouse') }}</th>
                <th v-if="queue !== 'unpaid'" :aria-sort="sortBy !== 'paidAt' ? 'none' : paidAtOrder === 'asc' ? 'ascending' : 'descending'"><button type="button" class="sort-payment" :disabled="busy" :title="`${sortHint}（UTC+8）`" :aria-label="`${text('收款日期', 'Payment date')}：${sortHint}`" @click="sortPayment()">{{ text('收款日期', 'Payment date') }}<component :is="sortBy !== 'paidAt' ? ArrowUpDown : paidAtOrder === 'asc' ? ArrowUp : ArrowDown" :size="13" aria-hidden="true" /></button></th>
                <th v-if="queue === 'allocation_review' && completed">{{ text('配货单号', 'Allocation document number') }}</th>
                <th v-if="showDispatchNumbers">{{ text('发运单编号', 'Dispatch document number') }}</th>
                <OrderSortHeader v-if="leadingSortField && !pendingOutbound" :label="statusHeading" :direction="sortDirection(leadingSortField)" :disabled="busy" :hint="leadingSortField === 'dispatchDocumentStatus' ? dispatchSortHint : undefined" @sort="sortStatus(leadingSortField)" /><th v-else-if="hasStatus && !pendingOutbound">{{ statusHeading }}</th>
                <th v-if="showOrderRemark">{{ text('订单备注', 'Order remark') }}</th><th v-if="!pendingOutbound">{{ text('客户名称', 'Customer name') }}</th><th>{{ text('店铺', 'Store') }}</th>
                <th v-if="queue === 'exceptions'">{{ text('异常原因', 'Exception reason') }}</th><th v-if="queue === 'exceptions'">{{ text('异常时长', 'Exception age') }}</th><th v-if="queue !== 'review'">{{ text('发货仓库', 'Shipping warehouse') }}</th>
                <th v-if="queue === 'unpaid'">{{ text('自定义物流渠道', 'Custom logistics channel') }}</th>
                <th v-if="queue === 'dispatch'">{{ text('物流渠道 / 跟踪号', 'Channel / Tracking number') }}</th><th v-if="queue === 'shipping'">{{ text('物流渠道 / 跟踪号', 'Channel / Tracking number') }}</th>
                <th>{{ text('业务员', 'Salesperson') }}</th>
                <OrderSortHeader v-if="extraConsumerTime" :label="text('客户付款时间', 'Customer payment time')" :direction="sortDirection('consumerPaidAt')" :disabled="busy" @sort="sortStatus('consumerPaidAt')" />
                <th v-if="timeSortField" :aria-sort="sortDirection(timeSortField) === 'asc' ? 'ascending' : sortDirection(timeSortField) === 'desc' ? 'descending' : 'none'"><button type="button" class="sort-consumer" :disabled="busy" :aria-label="`${createdTimeLabel}：${consumerSortHint}`" :title="`${consumerSortHint} · ${createdTimeHint}`" @click="sortStatus(timeSortField)">{{ createdTimeLabel }}<component :is="sortDirection(timeSortField) === 'asc' ? ArrowUp : sortDirection(timeSortField) === 'desc' ? ArrowDown : ArrowUpDown" :size="13" aria-hidden="true" /></button></th>
                <th v-else-if="showEventTime">{{ createdTimeLabel }}</th><th v-if="queue === 'procurement_shipping'">{{ text('操作', 'Action') }}</th>
              </tr></thead>
              <tbody :inert="busy || !!error"><tr v-for="order in error ? [] : data?.items" :key="order.id" class="order-record" :style="{ '--detail-rows': Math.ceil((columnCount - 2 + (showDispatchNumbers ? 1 : 0) + (queue === 'allocation_review' || queue === 'dispatch' || queue === 'shipping' ? 1 : 0)) / 4) }">
                <td class="order-cell" :data-label="text('订单编号', 'Order number')">
                  <input v-model="selectedOrders" type="checkbox" class="order-checkbox" :value="order.id" :disabled="busy" :aria-label="`${text('选择订单', 'Select order')} ${order.orderNumber}`" />
                  <span class="order-identity">
                  <button type="button" class="copy-order" :aria-label="`${text('复制订单编号', 'Copy order number')} ${order.orderNumber}`" :title="order.orderNumber" @click="copyOrderValue(order, 'orderNumber')"><strong>{{ order.orderNumber }}</strong><Check v-if="copiedValue === `orderNumber:${order.id}`" :size="14" /><Copy v-else :size="14" /></button>
<div v-if="pendingOutbound"><WorkbenchStatusBadge v-if="order.sourceOutboundStatus !== undefined" class="identity-bill-status identity-outbound-status" :tone="order.businessStatus ? (order.businessStatus.outbound === 'completed' ? 'success' : order.businessStatus.outbound === 'partial' ? 'warning' : 'neutral') : order.sourceOutboundStatus === '2' ? 'success' : order.sourceOutboundStatus === '1' ? 'warning' : 'info'">{{ order.businessStatus ? businessStatusLabel(order.businessStatus.outbound, 'outbound', !zh) : sourceStatusLabel(order.sourceOutboundStatus, 'outbound', !zh) }}</WorkbenchStatusBadge><WorkbenchStatusBadge v-else class="identity-bill-status identity-outbound-status" tone="info">{{ statusLabel(order) }}</WorkbenchStatusBadge></div>
<WorkbenchStatusBadge class="identity-bill-status" v-if="queue === 'review' && !completed && order.rawBillStatus && ['A','B','C'].includes(order.rawBillStatus)" :tone="order.rawBillStatus === 'C' ? 'success' : order.rawBillStatus === 'B' ? 'info' : 'warning'">{{ order.rawBillStatus === 'A' ? text('暂存', 'Draft') : order.rawBillStatus === 'B' ? text('已提交', 'Submitted') : text('已审核', 'Approved') }}</WorkbenchStatusBadge>
<div v-if="!completed && (queue === 'allocation' || queue === 'allocation_review')" class="allocation-references">
  <div v-for="document in (order.allocationDocuments ?? (order.allocationDocument ? [order.allocationDocument] : []))" :key="document.id" class="allocation-reference">
    <span v-if="document.number?.trim()" class="allocation-reference-number">{{ document.number }}</span>
    <WorkbenchStatusBadge v-if="document.rawBillStatus && ['A','B','C'].includes(document.rawBillStatus)" :tone="document.rawBillStatus === 'C' ? 'success' : document.rawBillStatus === 'B' ? 'info' : 'warning'">{{ document.rawBillStatus === 'A' ? text('暂存', 'Draft') : document.rawBillStatus === 'B' ? text('已提交', 'Submitted') : text('已审核', 'Approved') }}</WorkbenchStatusBadge>
  </div>
</div>
<OrderExceptionLabel :exception="order.exception" /></span>
                  <span v-if="queue === 'shipping' && !completed && (order.shipmentInterceptStatus === 'intercepted' || order.shipmentInterceptStatus === 'released')" class="shipment-intercept-status"><WorkbenchStatusBadge :tone="order.shipmentInterceptStatus === 'intercepted' ? 'danger' : 'success'" current>{{ order.shipmentInterceptStatus === 'intercepted' ? text('拦截发货', 'Shipment intercepted') : text('取消拦截', 'Interception released') }}</WorkbenchStatusBadge></span>
                  <div v-if="completed && (role === 'sales' || role === 'dispatch' || order.businessStatus)" class="business-status-summary"><span v-if="role !== 'dispatch' && order.businessStatus">{{ businessStatusLabel(order.businessStatus.order, 'order', !zh) }}</span><span>{{ text('采购：', 'Purchase: ') }}{{ completedPurchaseLabel(order, role === 'sales' || role === 'dispatch', !zh) }}</span></div>
                  <span v-if="order.items.length > 1" class="multi-item-badge">{{ text(`${order.items.length} 款商品 · ${orderItemQuantity(order.items) ?? '—'} 件`, `${order.items.length} products · ${orderItemQuantity(order.items) ?? '—'} units`) }}</span>
                </td>
                <td class="product-cell" :data-label="text('商品图片 / 商品信息', 'Product image / details')"><CollapsibleProductLines :show-summary="order.items.length <= 1" :expanded="expandedProductIds.has(order.id)" @update:expanded="setProductExpanded(order.id, $event)" :items="order.items" :label="order.orderNumber" v-slot="{ item, index }"><div class="product" :class="{ 'product-with-source': item.procurementSource }">
                  <OrderProductImage :src="item.imageUrl" :name="skuPickingName(item)" />
                  <div class="product-details"><span class="product-name" v-picking-name-tooltip="skuPickingName(item)">{{ skuPickingName(item) }}</span><span class="product-sku-meta"><span class="product-sku mono"><button v-if="item.sku?.trim()" type="button" class="copy-value" :title="item.sku" :aria-label="`${text('复制SKU', 'Copy SKU')} ${item.sku}`" @click="copyValue(item.sku, `sku:${order.id}:${index}`, 'SKU')"><span>SKU · {{ item.sku }}</span><Check v-if="copiedValue === `sku:${order.id}:${index}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>SKU · —</span></span><span class="product-quantity" :aria-label="`${item.sku} ${text('数量', 'quantity')} ${item.quantity}`">× {{ item.quantity ?? '—' }}</span></span></div><ProcurementSourceSummary v-if="item.procurementSource" :source="item.procurementSource" @open="sourceSelection = { orderId: order.id, skuId: item.procurementSource.skuId }" />
                </div></CollapsibleProductLines></td>
                <td class="mono shopify-cell" :data-label="text('Shopify 单号', 'Shopify order')"><button v-if="order.shopifyOrderNumber?.trim() && !order.sourceOrderNumberIsManual && order.documentKind !== 'stock_order'" type="button" class="copy-value" :title="order.shopifyOrderNumber" :aria-label="`${text('复制Shopify 单号', 'Copy Shopify order')} ${order.shopifyOrderNumber}`" @click="copyValue(order.shopifyOrderNumber, `shopify:${order.id}`, text('Shopify 单号', 'Shopify order'))"><span>{{ order.shopifyOrderNumber }}</span><Check v-if="copiedValue === `shopify:${order.id}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>{{ order.shopifyOrderNumber || '—' }}</span><small v-if="completed" class="source-shipment-status">{{ businessStatusLabel(order.businessStatus?.sourceShipment, 'source', !zh) }}</small></td>
                <td class="money amount-cell" :data-label="text('订单金额', 'Order amount')"><OrderAmountBreakdown v-if="queue === 'unpaid' || queue === 'review' || order.dataQuality?.mode === 'collected'" :amount="order.amount" :currency="order.currency" :breakdown="order.amountBreakdown" /><template v-else>{{ formatMoney(order.amount, order.currency) }}</template></td>
                <td class="country-cell" data-label="Customer"><span v-if="order.documentKind === 'stock_order'">---</span><div v-else class="order-recipient"><ShippingCountryBadge :code="order.shippingCountryCode" /><button v-if="order.shippingRecipient" type="button" class="recipient-name" :title="order.shippingRecipient.name || undefined" :aria-label="`${text('查看收件人信息', 'View recipient details')} · ${order.shippingRecipient.name || order.orderNumber}`" @click="recipientOrderId = order.id">{{ order.shippingRecipient.name || text('查看收件人', 'View recipient') }}</button><span v-else class="recipient-empty">—</span></div></td>
                <td v-if="queue === 'review'" class="logistics-channel-cell" :data-label="text('物流信息', 'Logistics information')"><OrderLogisticsChannels :custom-channel="order.customLogisticsChannelName" :channels="order.logisticsChannels" :groups="order.logisticsInfo" :show-tracking="completed" :missing-tracking-text="order.dataQuality?.readOnly ? '—' : undefined" /></td>
                <td v-if="queue === 'review'" :class="{ 'review-warehouse-name': !completed }" :data-label="text('发货仓库', 'Shipping warehouse')">{{ warehouseName(order.warehouse) }}</td>
                <td class="workbench-date-cell" v-if="queue !== 'unpaid'" :data-label="text('收款日期', 'Payment date')">{{ formatDate(order.paidAt) }}</td>
                <td v-if="queue === 'allocation_review' && completed" class="dispatch-numbers mono" :data-label="text('配货单号', 'Allocation document number')"><div v-for="document in (order.allocationDocuments ?? (order.allocationDocument ? [order.allocationDocument] : []))" :key="document.id"><button v-if="document.number?.trim()" type="button" class="copy-value" :title="document.number" :aria-label="`${text('复制配货单号', 'Copy allocation number')} ${document.number}`" @click="copyValue(document.number, `allocation:${order.id}:${document.id}`, text('配货单号', 'Allocation number'))"><span>{{ document.number }}</span><Check v-if="copiedValue === `allocation:${order.id}:${document.id}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>—</span></div><span v-if="!(order.allocationDocuments ?? (order.allocationDocument ? [order.allocationDocument] : [])).length">—</span></td>
                <td v-if="showDispatchNumbers" class="dispatch-numbers mono" :data-label="text('发运单编号', 'Dispatch document number')"><div v-for="document in order.dispatchDocuments" :key="document.id"><button v-if="document.number?.trim()" type="button" class="copy-value" :title="document.number" :aria-label="`${text('复制发运单编号', 'Copy dispatch number')} ${document.number}`" @click="copyValue(document.number, `dispatch:${order.id}:${document.id}`, text('发运单编号', 'Dispatch number'))"><span>{{ document.number }}</span><Check v-if="copiedValue === `dispatch:${order.id}:${document.id}`" :size="12" /><Copy v-else :size="12" /></button><span v-else>—</span></div><span v-if="!order.dispatchDocuments?.length">—</span></td>
                <td v-if="queue === 'procurement' && order.sourcePurchaseStatus !== undefined" :data-label="statusHeading">
                  <WorkbenchStatusBadge v-if="completed || (order.businessStatus ? order.businessStatus.purchase !== 'unpurchased' : order.sourcePurchaseStatus !== '0')" :tone="order.businessStatus ? (['received','shipped','purchased'].includes(order.businessStatus.purchase) ? 'success' : order.businessStatus.purchase.startsWith('partial_') ? 'warning' : 'neutral') : ['3','4'].includes(order.sourcePurchaseStatus ?? '') ? 'success' : order.sourcePurchaseStatus === '1' ? 'warning' : 'neutral'">{{ order.businessStatus ? businessStatusLabel(order.businessStatus.purchase, 'purchase', !zh) : sourceStatusLabel(order.sourcePurchaseStatus, 'purchase', !zh) }}</WorkbenchStatusBadge>
                  <div v-if="!completed && queue === 'procurement'" class="native-status-detail"><ProcurementStatus :stage="getTaskStatus(order, 'procurement')" :paid-at="order.procurementPaidAt" :now="currentTime" :progress="order.procurementProgress" :shipment="order.fulfillmentProgress.supplierShipment" /></div>
                </td>
                <td v-else-if="!pendingOutbound && queue === 'shipping' && order.sourceOutboundStatus !== undefined" :data-label="statusHeading"><WorkbenchStatusBadge :tone="order.businessStatus ? (order.businessStatus.outbound === 'completed' ? 'success' : order.businessStatus.outbound === 'partial' ? 'warning' : 'neutral') : order.sourceOutboundStatus === '2' ? 'success' : order.sourceOutboundStatus === '1' ? 'warning' : 'info'">{{ order.businessStatus ? businessStatusLabel(order.businessStatus.outbound, 'outbound', !zh) : sourceStatusLabel(order.sourceOutboundStatus, 'outbound', !zh) }}</WorkbenchStatusBadge></td>
                <td v-else-if="completed && hasStatus && role === 'allocation'" :data-label="statusHeading"><div class="allocation-references"><WorkbenchStatusBadge v-for="document in (order.allocationDocuments ?? (order.allocationDocument ? [order.allocationDocument] : [])).filter(document => ['A', 'B', 'C'].includes(document.rawBillStatus ?? ''))" :key="document.id" :tone="document.rawBillStatus === 'C' ? 'success' : document.rawBillStatus === 'B' ? 'info' : 'warning'">{{ document.rawBillStatus === 'C' ? text('已审核', 'Approved') : document.rawBillStatus === 'B' ? text('已提交', 'Submitted') : document.rawBillStatus === 'A' ? text('暂存', 'Draft') : '' }}</WorkbenchStatusBadge></div></td>
                <td v-else-if="completed && hasStatus" :data-label="statusHeading"><WorkbenchStatusBadge tone="success">{{ role === 'warehouse' ? text('已出库', 'Outbound completed') : role === 'dispatch' ? (order.businessStatus?.order === 'partial_fulfilled' ? text('部分履约', 'Partially fulfilled') : text('已履约', 'Fulfilled')) : text('已完成', 'Completed') }}</WorkbenchStatusBadge></td>
                <td v-else-if="queue === 'procurement'" :data-label="statusHeading"><ProcurementStatus :stage="getTaskStatus(order, 'procurement')" :paid-at="order.procurementPaidAt" :now="currentTime" :progress="order.procurementProgress" :shipment="order.fulfillmentProgress.supplierShipment" /></td>
                <td v-else-if="queue === 'dispatch' || isAllocation" :data-label="statusHeading"><DispatchStatus :queue="queue ?? undefined" :stage="queue === 'dispatch' ? getTaskStatus(order, 'dispatch') as FopOrder['dispatchTaskStatus'] : order.dispatchTaskStatus" :documents="order.dispatchDocuments" :shopify-sync="order.fulfillmentProgress.shopifySync" /></td>
                <td v-else-if="queue === 'procurement_shipping'" :data-label="statusHeading"><SupplierShipmentStatus class="status-pill" :paid-at="order.procurementPaidAt" :now="currentTime" :shipment="order.fulfillmentProgress.supplierShipment === 'partial' ? 'partial' : 'pending'" /></td>
                <td v-else-if="hasStatus && !pendingOutbound" :data-label="statusHeading"><WorkbenchStatusBadge class="status-pill pending" tone="info">{{ statusLabel(order) }}</WorkbenchStatusBadge></td>
                <td v-if="showOrderRemark" :data-label="text('订单备注', 'Order remark')"><span class="order-remark-text" v-picking-name-tooltip.quick="order.orderRemark || ''">{{ order.orderRemark }}</span></td>
                <td v-if="!pendingOutbound" :data-label="text('客户名称', 'Customer name')"><button type="button" class="copy-customer" :aria-label="`${text('复制客户名称', 'Copy customer name')} ${order.customerName}`" :title="order.customerName || undefined" @click="copyOrderValue(order, 'customerName')"><span>{{ order.customerName }}</span><Check v-if="copiedValue === `customerName:${order.id}`" :size="14" /><Copy v-else :size="14" /></button></td>
                <td :data-label="text('店铺', 'Store')">{{ order.storeName }}</td>
                <td v-if="queue === 'exceptions'" class="exception-reason" :title="exceptionReason(order)" :data-label="text('异常原因', 'Exception reason')">{{ exceptionReason(order) }}</td><td v-if="queue === 'exceptions'" :data-label="text('异常时长', 'Exception age')">{{ order.exception?.hours == null ? '—' : `${order.exception.hours}h` }}</td>
                <td v-if="queue !== 'review'" :data-label="text('发货仓库', 'Shipping warehouse')">{{ warehouseName(order.warehouse) }}</td>
                <td v-if="queue === 'unpaid'" class="logistics-channel-cell" :data-label="text('自定义物流渠道', 'Custom logistics channel')"><LogisticsChannelName :name="order.customLogisticsChannelName" /></td>
                <td v-if="queue === 'dispatch'" class="logistics-info-cell" :data-label="text('物流渠道 / 跟踪号', 'Channel / Tracking number')"><OrderLogisticsInfo show-all-tracking :groups="order.logisticsInfo" /></td>
                <td v-if="queue === 'shipping'" class="tracking-cell" :data-label="text('物流渠道 / 跟踪号', 'Channel / Tracking number')"><OrderLogisticsInfo show-all-tracking :groups="order.logisticsInfo" /></td>
                <td class="salesperson-cell" :data-label="text('业务员', 'Salesperson')"><span class="salesperson-name" :title="order.owner?.name || order.salesperson">{{ order.owner?.name || order.salesperson || '—' }}</span><RouterLink v-if="order.department" class="salesperson-department" :title="order.department.name" :to="{ name: 'Organization', query: { node: order.department.id } }">{{ order.department.name }}</RouterLink><span v-else class="salesperson-department">—</span></td>
                <td class="workbench-date-cell" v-if="extraConsumerTime" :data-label="text('客户付款时间', 'Customer payment time')">{{ formatDate(order.paidAt ?? null) }}</td>
                <td class="workbench-date-cell" v-if="showEventTime" :data-label="createdTimeLabel" :title="createdTimeHint">{{ formatDate(orderTime(order)) }}</td>
                <td v-if="queue === 'procurement_shipping'" class="follow-up-cell" :data-label="text('操作', 'Action')"><button type="button" class="follow-up-order" :disabled="!online" :aria-label="`${text('催办', 'Follow up')} ${order.orderNumber}`" @click="followUpOrder = { id: order.id, orderNumber: order.orderNumber }"><MessageCircle :size="14" />{{ text('催办', 'Follow up') }}</button></td>
              </tr><WorkbenchTableState v-if="!data?.items?.length || error" :columns="columnCount" :loading="busy" :error="error" :message="unavailable ? text('清单所需的单据数据尚未齐全，暂时无法查询。', 'Required document data is incomplete.') : text('暂无符合条件的订单，请调整搜索条件或切换清单。', 'No matching orders. Adjust your search or select another queue.')"><button v-if="error" class="workbench-button" :disabled="busy" @click="load()">{{ text('重试', 'Retry') }}</button></WorkbenchTableState></tbody>
              <TableTotals>
                <th scope="row">{{ text('筛选合计', 'Filtered total') }} · {{ unavailable ? '—' : data?.totals?.orderCount.toLocaleString() ?? '—' }} {{ text('笔订单', 'orders') }}</th>
                <td class="quantity-total">{{ data?.totals?.itemQuantity?.toLocaleString() ?? '—' }} {{ text('件', 'units') }}</td><td class="total-spacer" />
                <td class="money amount-cell"><OrderAmountTotals :totals="data?.totals" /></td>
                <td :colspan="columnCount - 4" class="total-caption"><small>{{ text('全部筛选结果 · 金额按币种汇总', 'All filtered results · Amounts grouped by currency') }}</small></td>
              </TableTotals>
            </table>
          </div>

        </template>
      </section>
    <ProcurementSourceDetailsDialog v-if="sourceDetails" :source="sourceDetails.source" :order-number="sourceDetails.orderNumber" @close="sourceSelection = undefined" />
    <RecipientDetailsDialog v-if="recipientOrder?.shippingRecipient" :recipient="recipientOrder.shippingRecipient" :country-code="recipientOrder.shippingCountryCode" :order-number="recipientOrder.orderNumber" @close="recipientOrderId = undefined" />
    <OrderApprovalDialog v-if="approvalOrderIds && approvalQueue" :queue="approvalQueue" :order-ids="approvalOrderIds" @close="closeApproval" @completed="approvalCompleted" />
      <AllocationInventoryDialog v-if="inventoryOrderIds" :order-ids="inventoryOrderIds" :queue="queue === 'shipping' ? 'shipping' : 'allocation'" :warehouse-code="warehouseCode || undefined" @close="inventoryOrderIds = undefined" />
      <SupplierFollowUpDialog v-if="followUpOrder" :key="followUpOrder.id" :order-id="followUpOrder.id" :order-number="followUpOrder.orderNumber" @close="followUpOrder = undefined" />
  </div>
</template>

<style scoped>
.identity-outbound-sort{display:flex;align-items:center;gap:4px;margin:6px 0 0 24px;font-size:11px;color:var(--color-text-secondary);background:none;border:0;cursor:pointer}

.identity-bill-status { margin-top: 6px; }
.allocation-references { display: flex; flex-direction: column; align-items: flex-start; gap: 7px; margin-top: 6px; }
.allocation-reference { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.allocation-reference-number { font-size: 11px; line-height: 1.5; color: var(--text-muted, #71809a); white-space: nowrap; font-variant-numeric: tabular-nums; }

.native-status-detail{display:block;margin-top:5px}
.exception-reason { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.6; color: var(--color-text-secondary); }

.export-feedback{margin:0;padding:10px 20px;color:var(--color-text-secondary);font-size:12px;border-bottom:1px solid var(--color-border)}.export-error{color:var(--color-warning,#c69568)}.clear-selection{color:var(--color-chart-link)}input.order-checkbox{width:15px;height:15px;min-width:15px;margin-right:10px;padding:0;vertical-align:middle;accent-color:#8398c9}

.follow-up-cell{position:static;min-width:0;}
.follow-up-order{display:inline-flex;align-items:center;gap:5px;color:var(--color-chart-link);padding:6px 9px;border-radius:6px;background:color-mix(in srgb,var(--color-chart-link) 9%,transparent);white-space:nowrap}
.follow-up-order:hover{background:color-mix(in srgb,var(--color-chart-link) 16%,transparent)}
.follow-up-order:disabled{opacity:.45;cursor:not-allowed}

.carrier-tracking { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.carrier-tracking > * { max-width: 100%; }
.dispatch-numbers { min-width: 0; line-height: 1.9; }
.fulfillment-page { color: var(--color-text); }
.back-link { display: inline-flex; align-items: center; gap: 7px; color: #718096; font-size: 12px; margin-bottom: 22px; }
.back-link:hover { color:var(--color-link); }
.list-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px 24px; margin-bottom: 20px; }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .15em; color: #7a8ba2; margin-bottom: 8px; }
h2 { display: flex; gap: 12px; align-items: center; font-size: 21px; font-weight: 750; letter-spacing: -.03em; }
.description { margin-top: 8px; font-size: 12px; color: #8490a3; line-height: 1.7; }
.source-badge { border: 1px solid #f4d59a; color: #ae7616; background: #fff8e8; border-radius: 5px; padding: 3px 7px; font-size: 10px; letter-spacing: .06em; }

.queue-tabs { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 18px; }
.queue-tabs a { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 11px 17px; border: 1px solid transparent; border-radius: 6px; color: #8490a3; font-size: 13px; white-space: nowrap; }
.queue-tabs a.active { background: var(--color-surface); border-color: var(--color-border); color:var(--color-link); font-weight: 700; box-shadow: 0 2px 5px #23375805; }
.list-panel { container: order-list / inline-size; width: 100%; max-width: 100%; min-width: 0; border: 1px solid var(--color-border); border-radius: 9px; overflow: hidden; background: var(--color-surface); }

.result-count { white-space: nowrap; color: #8490a3; font-size: 12px; }
.exact-filter { padding: 12px 20px; min-height: 44px; box-sizing: border-box; display: flex; align-items: center; gap: 8px 16px; font-size: 12px; line-height: 20px; }
.exact-filter button, .error-message button { color:var(--color-link); text-decoration: underline; }
.table-scroll { overflow-x: auto; width: 100%; min-width: 0; max-width: 100%; border-top: 1px solid var(--color-border); }
table { table-layout: fixed; width: 100%; border-collapse: separate; border-spacing: 0; text-align: left; white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
th { position: sticky; top: 0; z-index: 2; background: var(--color-surface); padding: 14px 8px; border-bottom: 1px solid var(--color-border); }
td { border-bottom: 1px solid var(--color-border); padding: 12px 8px; min-width: 0; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: color-mix(in srgb, var(--color-surface) 94%, var(--color-primary)); }
.order-cell { position: static; background: var(--color-surface); z-index: 1; min-width: 0; padding-left: 16px; padding-right: 16px; text-align: center; white-space: nowrap; border-right: 1px solid var(--color-border); }
.order-identity { display:inline-flex; flex-direction:column; align-items:flex-start; vertical-align:middle; text-align:left; max-width:calc(100% - 25px); }
.order-cell .order-identity .copy-order { max-width:100%; }
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
.product-with-source { display: grid; grid-template-columns: 42px minmax(0, 1fr); gap: 4px 10px; }
.product-with-source > .procurement-source-summary { grid-column: 1 / -1; }
.product-details { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; flex: 1; }
.business-status-summary{display:flex;flex-direction:column;gap:4px;margin-top:6px;font-size:11px;color:var(--color-text-secondary)}
.product-purchase-status,.source-shipment-status{display:block;margin-top:5px;font-size:11px;color:var(--color-text-secondary)}
.product-name { display: block; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.5; }
.product-sku, .product-variant { font-size: 10px; color: var(--color-text-secondary); line-height: 1.5; white-space: normal; overflow-wrap: anywhere; }

.image-fallback { display: flex; align-items: center; justify-content: center; background: #e5eaf1; color: #8893a5; }
.money, .mono { font-variant-numeric: tabular-nums; }

.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--color-border); padding: 14px 20px; color: #8490a3; font-size: 11px; }
.pagination div, .pagination label { display: flex; align-items: center; gap: 12px; }.pagination button { padding: 5px; }.pagination select { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; padding: 4px; }
.state-message { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #8490a3; font-size: 13px; padding: 24px; text-align: center; }.error-message { color: #dc6767; }
.demo-note { margin-top: 14px; color: #8a96a8; font-size: 11px; }
button:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 700px) { .list-heading { align-items: flex-start; }h2 { font-size: 23px; }.pagination { flex-wrap: wrap; padding: 14px; }.queue-tabs a { padding: 9px 12px; }.order-cell { position: static; }.exact-filter { flex-wrap: wrap; } }

.dark .source-badge { color: #ebc781; background: #352e23; border-color: #5b4d31; }

.dark .image-fallback { background: #253347; color: #b5c4d9; }




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
@media (max-width: 700px) { .list-heading { flex-wrap: wrap; } }

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
@media (max-width: 767px) {
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
  .order-record .logistics-info-cell, .order-record .dispatch-numbers, .order-record .tracking-cell, .order-record .salesperson-cell { grid-column: span 2; }
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
  .order-record .logistics-info-cell, .order-record .dispatch-numbers, .order-record .tracking-cell, .order-record .salesperson-cell { grid-column: auto; }
  .order-record .amount-cell { padding-left: 0; }
  .query-controls .search-form { min-width: 0; flex-basis: 100%; }
  .department-filter { max-width: 100%; }
  .department-filter select { min-width:160px;max-width:280px; }
  .pagination > div { flex-wrap: wrap; }
}
}

.order-recipient{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0}.recipient-name{border:0;padding:0;background:none;color:var(--color-chart-link);font:inherit;text-align:left;line-height:1.5;white-space:normal;overflow-wrap:anywhere;max-width:100%;cursor:pointer;text-decoration:underline;text-decoration-color:transparent;text-underline-offset:3px}.recipient-name:hover,.recipient-name:focus-visible{text-decoration-color:currentColor}.recipient-empty{color:var(--color-text-secondary)}

.recipient-name,.copy-customer span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;min-width:0;max-width:100%}.copy-customer svg{flex-shrink:0}
</style>

<style scoped>
.native-status-detail{display:block;margin-top:5px}
.shipment-intercept-status { display: block; margin-top: 8px; }
@media(max-width:700px) { .order-cell .shipment-intercept-status { flex-basis: 100%; margin-top: 0; } }

.recipient-name,.copy-customer span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;overflow-wrap:normal;min-width:0;max-width:100%}.copy-customer svg{flex-shrink:0}
</style>

<style scoped>
.order-remark-text { display: block; min-width: 0; width: 100%; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }
.review-warehouse-name { color: var(--color-text); font-weight: 600; }
</style>

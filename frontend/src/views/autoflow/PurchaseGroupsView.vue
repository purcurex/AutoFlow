<script setup lang="ts">
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-vue-next'
import { purchaseStageLabels, isPurchaseStage, getPurchaseGroups, getPurchaseGroupDetails, exportPurchaseGroups, type PurchaseGroup, type PurchaseDetails, type PurchasePage, type PurchaseFilters, type PurchaseQuery } from '@/api/procurement-groups'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import SupplierShipmentStatus from '@/components/autoflow/SupplierShipmentStatus.vue'
import '@/styles/workbench-list.css'
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
const { defaultDepartmentLabel } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(d => [d.id, d.name]))))
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh')), t = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const completed = computed(() => route.query.queue === 'completed')
const filters = computed<PurchaseFilters>(() => ({ ...(completed.value ? { completed: true, timeRange: (route.query.timeRange === '1m' || route.query.timeRange === '3m' ? route.query.timeRange : '1w') as '1w' | '1m' | '3m' } : {}), purchaseStage: !completed.value && route.query.queue !== 'procurement_shipping' && isPurchaseStage(route.query.purchaseStage) ? route.query.purchaseStage : undefined, queue: route.query.queue === 'procurement_shipping' ? 'procurement_shipping' : 'procurement', search: scalar('search') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, warehouseCode: scalar('warehouseCode') || undefined, sortOrder: scalar('sortOrder') === 'desc' ? 'desc' : scalar('sortOrder') === 'asc' ? 'asc' : completed.value ? 'desc' : 'asc' }))
const query = computed<PurchaseQuery>(() => ({ ...filters.value, page: Math.max(1, Number(scalar('page')) || 1), pageSize: [20, 50, 100].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 50 }))
const search = ref(scalar('search')), result = ref<PurchasePage>(), loading = ref(false), error = ref(''), now = ref(Date.now())
const expanded = ref<string[]>([]), selected = ref<string[]>([]), details = ref<Record<string, PurchaseDetails>>({}), detailErrors = ref<Record<string, string>>({}), detailBusy = ref<Record<string, boolean>>({})
const followUp = ref<{ orderId: string; orderNumber: string; purchaseOrderId: string }>(), exporting = ref(false), exportError = ref('')
let generation = 0, disposed = false, sessionClosed = false, timer: ReturnType<typeof setInterval> | undefined, exportController: AbortController | undefined
const detailTickets = new Map<string, number>()
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize)))
const allExpanded = computed(() => !!result.value?.items.length && result.value.items.every(g => expanded.value.includes(g.id)))
const allSelected = computed(() => !!result.value?.items.length && result.value.items.every(g => selected.value.includes(g.id)))
const date = (v: string | null) => v ? new Date(v).toLocaleString(zh.value ? 'zh-CN' : 'en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const number = (v: number | null) => v === null ? '—' : v.toLocaleString(zh.value ? 'zh-CN' : 'en-US', { maximumFractionDigits: 8 })
const payments = { paid: ['已付款', 'Paid'], unpaid: ['待付款', 'Unpaid'], partial: ['部分付款', 'Partly paid'], refunded: ['已退款待处理', 'Refunded'], unknown: ['付款待确认', 'Payment unknown'] }
const shipments = { pending: ['供应商待发货', 'Awaiting shipment'], partial: ['供应商部分发货', 'Partly shipped'], shipped: ['供应商已发货', 'Shipped'], unknown: ['发货待确认', 'Shipment unknown'] }
function update(values: Record<string, string | number | undefined>) { return router.replace({ query: { ...route.query, page: undefined, ...values } }) }
function choose(event: Event, key: string) { void update({ [key]: (event.target as HTMLSelectElement).value || undefined, ...(key === 'departmentId' ? { ownerId: undefined } : {}) }) }
function submit() { void update({ search: search.value.trim() || undefined }) }
watch(search, v => { if (!v.trim() && filters.value.search) submit() })
async function loadDetails(id: string, page = 1) {
  if (disposed || sessionClosed) return
  const session = captureSession(), current = generation, ticket = (detailTickets.get(id) ?? 0) + 1
  detailTickets.set(id, ticket); detailBusy.value[id] = true; delete details.value[id]; delete detailErrors.value[id]
  try {
    const next = await getPurchaseGroupDetails(id, { ...filters.value, page, pageSize: 20 })
    if (disposed || current !== generation || detailTickets.get(id) !== ticket || !isCurrentSession(session)) return
    details.value[id] = next
    // Refresh the group header with the same snapshot as the expanded rows.
    if (result.value) result.value.items = result.value.items.map(g => g.id === id ? next.group : g)
  } catch (cause) { if (!disposed && current === generation && isCurrentSession(session) && detailTickets.get(id) === ticket) detailErrors.value[id] = fopAccessError(cause, zh.value) }
  finally { if (!disposed && current === generation && detailTickets.get(id) === ticket) detailBusy.value[id] = false }
}
function toggle(id: string) { if (expanded.value.includes(id)) expanded.value = expanded.value.filter(x => x !== id); else { expanded.value.push(id); void loadDetails(id) } }
// Bound parallel detail reads when a page has up to 100 groups.
async function loadExpanded(ids: string[], ticket = generation) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (!disposed && !sessionClosed && ticket === generation && cursor < ids.length) {
      const id = ids[cursor++]!
      if (expanded.value.includes(id)) await loadDetails(id)
    }
  }))
}
function toggleAll() {
  if (allExpanded.value) { expanded.value = []; return }
  const ids = result.value?.items.map(g => g.id) ?? []
  const newIds = ids.filter(id => !expanded.value.includes(id))
  expanded.value = ids
  void loadExpanded(newIds)
}
function followPurchase(group: PurchaseGroup) {
  if (group.purchase) followUp.value = { orderId: group.id, orderNumber: group.purchase.number, purchaseOrderId: group.purchase.id }
}
async function load() {
  if (disposed || sessionClosed) return
  const ticket = ++generation, session = captureSession(), prior = [...expanded.value]
  now.value = Date.now(); loading.value = true; error.value = ''; result.value = undefined; details.value = {}; detailErrors.value = {}; detailBusy.value = {}; followUp.value = undefined
  try {
    const next = await getPurchaseGroups(query.value)
    if (disposed || ticket !== generation || !isCurrentSession(session)) return
    const lastPage = Math.max(1, Math.ceil(next.total / query.value.pageSize))
    if (query.value.page > lastPage) { await update({ page: lastPage }); return }
    result.value = next; emit('filter-labels', next.departments)
    selected.value = selected.value.filter(id => next.items.some(g => g.id === id))
    expanded.value = prior.filter(id => next.items.some(g => g.id === id))
    void loadExpanded([...expanded.value], ticket)
  } catch (cause) { if (!disposed && ticket === generation && isCurrentSession(session)) { error.value = fopAccessError(cause, zh.value); selected.value = []; expanded.value = [] } }
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
function refreshVisible() { now.value = Date.now(); if (document.visibilityState === 'visible' && navigator.onLine && !loading.value && !exporting.value && !followUp.value) void load() }
const off = onSessionReset(() => { sessionClosed = true; generation++; result.value = undefined; details.value = {}; detailErrors.value = {}; detailBusy.value = {}; selected.value = []; expanded.value = []; followUp.value = undefined; exportController?.abort() })
onMounted(() => { timer = setInterval(refreshVisible, 30000); document.addEventListener('visibilitychange', refreshVisible); window.addEventListener('focus', refreshVisible); window.addEventListener('online', refreshVisible) })
onBeforeUnmount(() => { disposed = true; generation++; clearInterval(timer); exportController?.abort(); off(); document.removeEventListener('visibilitychange', refreshVisible); window.removeEventListener('focus', refreshVisible); window.removeEventListener('online', refreshVisible) })
</script>
<template>
  <section class="purchase-groups">
    <WorkbenchTaskHeading :title="completed ? t('采购完成清单', 'Completed purchases') : filters.queue === 'procurement_shipping' ? t('已采购待发货', 'Awaiting supplier shipment') : t('待采购清单', 'Pending procurement')" :description="completed ? undefined : t('展开查看关联履约明细，采购操作在 FOP 完成。', 'Expand linked fulfillment details. Process purchases in FOP.')">
      <div class="refresh-controls">
        <slot name="heading-actions" />
        <button class="workbench-button workbench-refresh" :disabled="loading || exporting" @click="load"><RefreshCw :size="15" />{{ t('刷新', 'Refresh') }}</button>
        <span class="refresh-status">{{ t('每 30 秒自动刷新', 'Refreshes every 30 seconds') }}<br />{{ t('最近刷新', 'Last refreshed') }} {{ result?.refreshedAt ? new Date(result.refreshedAt).toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', hour12: false }) : '—' }} · UTC+8</span>
      </div>
    </WorkbenchTaskHeading>
    <div class="group-panel">
      <form class="group-filters workbench-filter-toolbar" @submit.prevent="submit">
        <div class="workbench-filter-main">
          <div class="workbench-filter-search"><div class="workbench-search-field"><Search :size="16" /><input v-model="search" type="search" maxlength="200" :aria-label="t('搜索采购分组', 'Search purchase groups')" :placeholder="t('采购单 / 供应商 / 履约单 / 客户 / 业务员 / SKU', 'Purchase / supplier / fulfillment / customer / salesperson / SKU')" /></div><button class="workbench-button workbench-primary" :disabled="loading">{{ t('查询', 'Search') }}</button></div>
          <label>{{ t('业务部门', 'Department') }}<select class="workbench-filter-select" :value="filters.departmentId || ''" @change="choose($event, 'departmentId')"><option value="">{{ defaultDepartmentLabel }}</option><option v-for="d in result?.departments" :key="d.id" :value="d.id">{{ d.name }}</option></select></label>
          <label>{{ t('发货仓库', 'Warehouse') }}<select class="workbench-filter-select" :value="filters.warehouseCode || ''" @change="choose($event, 'warehouseCode')"><option value="">{{ t('全部', 'All') }}</option><option value="HZ">{{ t('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ t('深圳仓', 'Shenzhen') }}</option></select></label>
        </div>
        <div class="workbench-filter-secondary">
          <label v-if="completed">{{ t('完成时间', 'Completion time') }}<select class="workbench-filter-select" :value="filters.timeRange" :disabled="loading" :aria-label="t('完成时间范围', 'Completion time range')" @change="choose($event, 'timeRange')"><option value="1w">{{ t('近一周', 'Last week') }}</option><option value="1m">{{ t('近一月', 'Last month') }}</option><option value="3m">{{ t('近三月', 'Last three months') }}</option></select></label>
          <label v-if="!completed && filters.queue === 'procurement'">{{ t('采购进度', 'Purchase progress') }}<select class="workbench-filter-select" :value="filters.purchaseStage || ''" :disabled="loading" :aria-label="t('采购进度筛选', 'Purchase progress filter')" @change="choose($event, 'purchaseStage')"><option value="">{{ t('全部状态', 'All statuses') }}</option><option v-for="(label, value) in purchaseStageLabels" :key="value" :value="value">{{ label[zh ? 0 : 1] }}</option></select></label>
          <button class="workbench-button" type="button" @click="update({sortOrder:filters.sortOrder === 'asc' ? 'desc' : 'asc'})">{{ completed ? filters.sortOrder === 'asc' ? t('最早完成优先', 'Oldest completion first') : t('最新完成优先', 'Latest completion first') : filters.sortOrder === 'asc' ? t('最早收款优先', 'Oldest receipt first') : t('最新收款优先', 'Newest receipt first') }}</button>
          <button v-if="filters.ownerId" class="workbench-button" type="button" @click="update({ownerId:undefined})">{{ t('清除业务员筛选', 'Clear salesperson filter') }}</button>
          <span class="result-count" aria-live="polite" :title="result ? t(`关联履约单 ${result.totals.orderCount} 笔（去重）`, `${result.totals.orderCount} unique fulfillment orders`) : undefined">
            {{ result ? t(`共 ${result.totals.purchaseCount} 张采购单`, `${result.totals.purchaseCount} purchase orders`) : '—' }}<template v-if="result?.totals.uncreatedCount"> · {{ t(`待建 ${result.totals.uncreatedCount} 笔`, `${result.totals.uncreatedCount} awaiting creation`) }}</template>
          </span>
        </div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []">
        <button type="button" class="workbench-button expand-all" :disabled="loading || !result?.items.length" @click="toggleAll">{{ allExpanded ? t('全部收起（本页）', 'Collapse all on page') : t('全部展开（本页）', 'Expand all on page') }}</button>
        <input type="checkbox" :checked="allSelected" :disabled="loading" :aria-label="t('选择本页采购组', 'Select purchase groups on this page')" @change="selectAll" />
        <template #export><WorkbenchExportButton :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="download" /></template>
      </WorkbenchListActions>
      <p v-if="error || exportError" class="group-error" role="alert">{{ error || exportError }}</p>
      <article v-for="group in result?.items" :key="group.id" class="purchase-group" :data-group="group.id">
        <header class="group-head">
          <div class="group-select">
            <input v-model="selected" type="checkbox" :value="group.id" :aria-label="t('选择采购组 ', 'Select group ') + (group.purchase?.number || group.id)" />
            <button class="group-expand" :aria-expanded="expanded.includes(group.id)" :aria-label="t('展开采购组 ', 'Expand group ') + (group.purchase?.number || group.id)" @click="toggle(group.id)"><ChevronDown v-if="expanded.includes(group.id)" :size="16" /><ChevronRight v-else :size="16" /></button>
          </div>
          <div class="group-identity">
            <div class="purchase-number"><StockCopy v-if="group.purchase" :value="group.purchase.number" /><strong v-else>{{ t('待创建采购单', 'Purchase not created') }}</strong></div>
            <small v-if="!group.purchase">{{ t('履约订单采购需求汇总', 'Fulfillment purchase demand') }}</small>
            <div v-if="group.purchase" class="supplier-line"><span class="supplier-name" :title="group.purchase.supplier.name">{{ group.purchase.supplier.name }}</span><span class="purchase-channel">{{ group.purchase.purchaseType === 'offline' ? t('线下采购', 'Offline') : group.purchase.platform === '1688' ? t('线上 · 1688', 'Online · 1688') : t('线上 · 其他平台', 'Online · Other') }}</span></div>
            <div v-if="group.purchase?.platformOrderNumber" class="platform-number"><span class="platform-label">{{ group.purchase.platform === '1688' ? '1688' : t('平台订单', 'Platform order') }}</span><StockCopy :value="group.purchase.platformOrderNumber" /></div>
          </div>
          <div v-if="group.purchase" class="group-status">
            <div class="group-badges" :aria-label="t('采购进度，圆点标记当前待处理节点', 'Purchase progress; dot marks the current action')">
              <WorkbenchStatusBadge :current="purchaseCurrentStage(group) === 'payment'" :tone="group.purchase.payment === 'paid' ? 'success' : group.purchase.payment === 'refunded' ? 'danger' : group.purchase.payment === 'unknown' ? 'neutral' : purchaseCurrentStage(group) === 'payment' ? 'warning' : 'neutral'">{{ payments[group.purchase.payment][zh ? 0 : 1] }}</WorkbenchStatusBadge>
              <WorkbenchStatusBadge v-if="group.purchase.placement !== 'placed'" :current="purchaseCurrentStage(group) === 'placement'" :tone="purchaseCurrentStage(group) === 'placement' ? group.purchase.placement === 'unknown' ? 'neutral' : 'warning' : 'neutral'">{{ group.purchase.placement === 'pending' ? group.purchase.platform === '1688' ? t('待推1688采购', '1688 placement pending') : t('待下单', 'Placement pending') : t('下单待确认', 'Placement unknown') }}</WorkbenchStatusBadge>
              <template v-if="filters.queue === 'procurement_shipping'">
                <SupplierShipmentStatus v-if="group.purchase.payment === 'paid' && (group.shipment === 'pending' || group.shipment === 'partial')" :paid-at="group.purchase.paidAt" :now="now" :shipment="group.shipment" :current="purchaseCurrentStage(group) === 'shipment'" />
                <WorkbenchStatusBadge v-else :current="purchaseCurrentStage(group) === 'shipment'" :tone="group.shipment === 'shipped' ? 'success' : 'neutral'">{{ shipments[group.shipment][zh ? 0 : 1] }}</WorkbenchStatusBadge>
              </template>
            </div>
            <small>{{ completed ? t('采购完成', 'Purchase completed') : t('采购付款', 'Supplier payment') }} {{ date(completed ? group.completedAt ?? null : group.purchase.paidAt) }}</small>
          </div>
          <div class="group-counts">
            <div class="group-counts-heading">
              <span class="group-source-count">{{ group.orderCount }} {{ t('笔履约', 'orders') }} <span class="count-divider">/</span> {{ group.skuCount }} SKU</span>
              <button v-if="group.purchase?.purchaseType === 'online' && group.purchase.platform === '1688' && filters.queue === 'procurement_shipping'" type="button" class="group-follow-up" :aria-label="t('采购催办 ', 'Follow up purchase ') + group.purchase.number" @click="followPurchase(group)">{{ t('采购催办', 'Follow up') }}</button>
              <span v-else-if="group.purchase && filters.queue === 'procurement_shipping'" class="group-fop-follow-up">{{ t('请在 FOP 催办', 'Follow up in FOP') }}</span>
            </div>
            <span v-if="!group.purchase">{{ t('待采购数量', 'Quantity to purchase') }} <strong>{{ number(group.quantity) }}</strong></span>
            <span v-else>{{ t('采购数量', 'Purchase quantity') }} {{ number(group.quantity) }} <span class="count-divider">·</span> {{ t('已发', 'Shipped') }} {{ number(group.shippedQuantity) }} <span class="count-divider">·</span> {{ t('待发', 'Pending') }} <strong>{{ number(group.pendingQuantity) }}</strong></span>
            <small>{{ t('最早收款', 'Earliest receipt') }} {{ date(group.earliestReceiptAt) }}</small>
          </div>
        </header>
        <div v-if="expanded.includes(group.id)" class="group-body">
          <p v-if="detailBusy[group.id]" class="group-message">{{ t('正在加载履约明细…', 'Loading fulfillment details…') }}</p>
          <div v-else-if="detailErrors[group.id]" class="group-error" role="alert">{{ detailErrors[group.id] }} <button class="workbench-button" @click="loadDetails(group.id)">{{ t('重试', 'Retry') }}</button></div>
          <template v-else-if="details[group.id]"><div class="group-table-wrap"><table><thead><tr><th>{{ t('履约订单', 'Fulfillment order') }}</th><th>{{ t('关联商品 / SKU', 'Linked products / SKU') }}</th><th>{{ t('客户 / 店铺', 'Customer / store') }}</th><th>{{ t('业务员 / 部门', 'Salesperson / department') }}</th><th>{{ completed ? t('发货仓库 / 采购完成时间', 'Warehouse / purchase completion') : t('发货仓库 / 收款时间', 'Warehouse / receipt time') }}</th></tr></thead><tbody><tr v-for="row in details[group.id]!.items" :key="row.orderId"><td class="fulfillment-cell"><StockCopy :value="row.orderNumber" /><small><StockCopy :value="row.shopifyOrderNumber" /></small></td><td><div v-for="line in row.lines" :key="line.fulfillmentLineId + ':' + line.purchaseLineId" class="linked-product"><OrderProductImage :src="line.imageUrl" :name="line.name" /><div><p :title="line.name">{{ line.name }}</p><StockCopy :value="line.sku" /><small>{{ line.variant }}</small><small v-if="!group.purchase">{{ t('待采购数量', 'Quantity to purchase') }} {{ number(line.quantity) }}</small><small v-else>{{ t('采购', 'Purchased') }} {{ number(line.quantity) }} · {{ t('已发', 'Shipped') }} {{ number(line.shippedQuantity) }} · {{ t('未发', 'Unshipped') }} {{ number(Number((line.quantity-line.shippedQuantity).toFixed(8))) }}</small></div></div></td><td>{{ row.customerName }}<small>{{ row.storeName }}</small></td><td>{{ row.ownerName }}<small>{{ row.departmentName }}</small></td><td>{{ row.warehouse }}<small>{{ date(completed ? row.completedAt ?? null : row.paidAt) }}</small></td></tr></tbody></table></div><div v-if="details[group.id]!.total > 20" class="detail-pagination"><span>{{ t('履约明细', 'Fulfillment details') }} {{ details[group.id]!.page }} / {{ Math.ceil(details[group.id]!.total / 20) }}</span><button class="workbench-button" :disabled="details[group.id]!.page <= 1" @click="loadDetails(group.id, details[group.id]!.page-1)">{{ t('上一页', 'Previous') }}</button><button class="workbench-button" :disabled="details[group.id]!.page * 20 >= details[group.id]!.total" @click="loadDetails(group.id, details[group.id]!.page+1)">{{ t('下一页', 'Next') }}</button></div></template>
        </div>
      </article>
      <p v-if="!result?.items.length" class="group-message">{{ loading ? t('正在查询…', 'Loading…') : error ? t('请刷新重试', 'Refresh to retry') : t('暂无符合条件的采购待办', 'No matching purchase tasks') }}</p>
      <footer class="group-pagination"><label>{{ t('每页采购组', 'Groups per page') }}<select class="workbench-filter-select" :value="query.pageSize" @change="choose($event, 'pageSize')"><option v-for="size in [20,50,100]" :key="size" :value="size">{{ size }}</option></select></label><span>{{ query.page }} / {{ pages }}</span><button class="workbench-button" :disabled="loading || query.page <= 1" @click="update({page:query.page-1})">{{ t('上一页', 'Previous') }}</button><button class="workbench-button" :disabled="loading || query.page >= pages" @click="update({page:query.page+1})">{{ t('下一页', 'Next') }}</button></footer>
    </div>
    <SupplierFollowUpDialog v-if="followUp" :order-id="followUp.orderId" :order-number="followUp.orderNumber" :purchase-order-id="followUp.purchaseOrderId" :group-filters="filters" @close="followUp = undefined" />
  </section>
</template>
<style scoped>
.purchase-groups { color: var(--color-text); min-width: 0; }
.group-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; overflow: hidden; }
.refresh-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.refresh-status { color: var(--color-text-secondary); font-size: 11px; line-height: 1.8; }
small { color: var(--color-text-secondary); font-size: 11px; }
.group-pagination, .detail-pagination { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 14px 20px; border-bottom: 1px solid var(--color-border); font-size: 12px; }
.group-pagination label { display: flex; gap: 8px; align-items: center; }
.group-head { display: grid; grid-template-columns: 42px minmax(215px, 1.1fr) minmax(175px, 1fr) minmax(220px, 1fr); align-items: center; gap: 16px; padding: 17px 20px; background: color-mix(in srgb, var(--color-chart-link) 3%, var(--color-surface)); }
.purchase-group + .purchase-group { border-top: 1px solid var(--color-border); }
.group-select { display: flex; align-items: center; gap: 7px; }
.group-expand { padding: 5px 2px; color: var(--color-text-secondary); }
.group-expand:hover { color: var(--color-chart-link); }
.group-expand:focus-visible, .group-follow-up:focus-visible { outline: 2px solid var(--color-chart-link); outline-offset: 3px; }
.group-identity { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; }
.purchase-number { color: var(--color-chart-link); font-size: 13px; font-weight: 600; line-height: 1.5; font-variant-numeric: tabular-nums; }
.purchase-number strong { font-weight: 600; }
.supplier-name { color: var(--color-text-secondary); font-size: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.supplier-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.purchase-channel { flex-shrink: 0; font-size: 10px; color: var(--color-text-secondary); border-left: 1px solid var(--color-border); padding-left: 8px; }
.platform-number { display: flex; align-items: center; gap: 7px; color: var(--color-text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; min-width: 0; max-width: 100%; }
.platform-label { font-size: 10px; line-height: 15px; padding: 0 3px; border: 1px solid var(--color-border); border-radius: 3px; }
.group-identity :deep(.stock-copy > span) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.group-status { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.group-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.group-counts { grid-column: 4; display: flex; flex-direction: column; gap: 6px; text-align: right; font-size: 11px; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.group-source-count { font-size: 12px; color: var(--color-text); }
.group-counts strong { color: var(--color-text); font-weight: 600; }
.count-divider { padding: 0 4px; color: var(--color-text-secondary); opacity: .6; }
.group-body { background: var(--color-surface); padding: 0 20px 0 62px; }
.group-table-wrap { min-width: 0; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
th, td { text-align: left; padding: 15px 12px; vertical-align: top; border-bottom: 1px solid var(--color-border); overflow-wrap: anywhere; }
th { padding-top: 12px; padding-bottom: 12px; font-size: 11px; font-weight: 500; color: var(--color-text-secondary); }
th:first-child, td:first-child { padding-left: 16px; }
th:nth-child(1) { width: 20%; } th:nth-child(2) { width: 32%; } th:nth-child(3) { width: 17%; } th:nth-child(4) { width: 15%; } th:nth-child(5) { width: 16%; }
tbody tr:last-child td { border-bottom: 0; }
td small { display: block; margin: 6px 0; }
.fulfillment-cell > :deep(.stock-copy) { color: var(--color-chart-link); font-variant-numeric: tabular-nums; }
.group-counts-heading { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.group-fop-follow-up { flex-shrink: 0; padding-left: 12px; border-left: 1px solid var(--color-border); font-size: 11px; }
.group-follow-up { flex-shrink: 0; display: inline-flex; padding: 0 0 0 12px; border-left: 1px solid var(--color-border); color: var(--color-chart-link); font-size: 11px; line-height: 18px; }
.group-follow-up:hover { text-decoration: underline; }
.linked-product { display: flex; gap: 10px; margin-bottom: 14px; }.linked-product:last-child { margin-bottom: 0; }
.linked-product > div { min-width: 0; }.linked-product p { margin: 0 0 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-message { padding: 28px; text-align: center; font-size: 13px; color: var(--color-text-secondary); }
.group-error { padding: 14px 20px; color: #dc6b6b; font-size: 13px; }
.group-pagination, .detail-pagination { justify-content: flex-end; border: 0; }
input[type=checkbox] { accent-color: var(--color-chart-link); }
@media (max-width: 1150px) {
  .group-head { grid-template-columns: 32px minmax(205px, 1fr) minmax(180px, 1fr); gap: 12px; }
  .group-status { grid-column: 2; grid-row: 2; }.group-counts { grid-column: 3; grid-row: 1 / 3; }
  .group-body { padding-left: 48px; }
}
@media (max-width: 700px) {
  .refresh-controls { justify-content: flex-start; gap: 10px; }.refresh-status { font-size: 10px; }
  .group-head { grid-template-columns: 28px minmax(0, 1fr); padding: 15px 14px; gap: 10px; }
  .group-status, .group-counts { grid-column: 2; grid-row: auto; }.group-counts { text-align: left; }
  .group-counts-heading { justify-content: flex-start; }
  .group-body { padding: 0 14px 0 28px; } thead { display: none; }
  tr { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--color-border); } tr:last-child { border: 0; }
  td { min-width: 0; padding: 10px 8px; border: 0; } td:first-child { padding-left: 8px; } td:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
  .group-filters .input { min-width: 180px; }.group-filters { padding: 12px 14px; }
}
</style>

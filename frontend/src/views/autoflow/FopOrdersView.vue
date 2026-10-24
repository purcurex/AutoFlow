<script setup lang="ts">
import { formatCurrency } from '@/utils/currency'
import TableTotals from '@/components/ui/TableTotals.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Check, Copy, ChevronLeft, ChevronRight, PackageSearch, RefreshCw, Search } from 'lucide-vue-next'
import { copyText } from '@/utils/copyText'
import { getFopOrders, isFopOrderQueue, matchesFopQueue, type FopOrder, type FopQueuePage } from '@/api/fop-orders'
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
const labels = computed(() => ({ procurement: text('待采购', 'Pending purchase'), review: text('待审核', 'Pending review'), allocation: text('待配货', 'Pending allocation'), dispatch: text('待履约', 'Pending fulfillment'), shipping: text('待出库', 'Pending outbound'), exceptions: text('异常订单', 'Order exceptions') }))
const columns = computed(() => ({ procurement: text('供应商发货状态', 'Supplier shipment status'), review: text('审核状态', 'Review status'), allocation: text('配货状态', 'Allocation status'), dispatch: text('Shopify 履约状态', 'Shopify fulfillment status'), shipping: text('出库状态', 'Outbound status'), exceptions: text('异常原因', 'Exception reason') }))
const descriptions = computed(() => ({
  procurement: text('已审核履约订单中，供应商尚未全部发货的订单。', 'Approved fulfillment orders with outstanding supplier shipments.'),
  review: text('已付款、等待审核的履约订单。', 'Paid fulfillment orders awaiting review.'),
  allocation: text('库存未齐套，或已齐套但配货尚未审核的履约订单。', 'Orders with incomplete stock, or complete stock awaiting allocation approval.'),
  dispatch: text('已审核、等待同步 Shopify 发货的履约订单。', 'Approved fulfillment orders awaiting Shopify fulfillment synchronization.'),
  shipping: text('配货已齐套并审核、尚未全部出库的履约订单。', 'Orders with complete, approved allocation awaiting warehouse outbound completion.'),
  exceptions: text('仅显示已支付、尚未发货且存在异常的履约订单。', 'Paid, unshipped fulfillment orders with an active exception.'),
}))
function queueStatus(order: FopOrder) {
  const progress = order.fulfillmentProgress
  switch (queue.value) {
    case 'review': return text('待审核', 'Pending review')
    case 'dispatch': return progress.shopifySync === 'partial' ? text('部分同步 · 待完成', 'Partially synced · pending') : text('待同步 Shopify 发货', 'Shopify sync pending')
    case 'procurement': return progress.supplierShipment === 'partial' ? text('供应商部分发货', 'Supplier partially shipped') : text('供应商未发货', 'Supplier shipment pending')
    case 'allocation': return progress.stockReadiness === 'incomplete' ? text('库存未齐套', 'Stock incomplete') : text('已齐套 · 待审核', 'Stock ready · approval pending')
    case 'shipping': return progress.outbound === 'partial' ? text('部分出库 · 待完成', 'Partially outbound · pending') : text('配货已完成 · 待出库', 'Allocation approved · outbound pending')
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
const busy = ref(false)
const error = ref('')
const online = ref(navigator.onLine)
const visible = ref(document.visibilityState === 'visible')
const copiedOrder = ref('')
const copyMessage = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined
let recoveringPage = false
const failedImages = ref(new Set<string>())
const page = computed(() => Number(route.query.page || 1))
const pageSize = computed(() => Number(route.query.pageSize || 10))
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize.value)))
const columnsAfterAmount = computed(() => queue.value === 'exceptions' ? 5 : queue.value === 'dispatch' || queue.value === 'shipping' ? 6 : 4)
let requestId = 0

async function load(reset = false) {
  // The access guard temporarily unmounts this child before committing navigation.
  // Do not fetch/recover the old page again if it remounts in that interval.
  if (props.searchRecovery?.from === route.fullPath) { busy.value = true; return }
  if (!reset && busy.value) return
  const currentRequest = ++requestId
  if (reset) {
    data.value = undefined
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
  if (!Number.isInteger(page.value) || page.value < 1 || ![10, 20, 50].includes(pageSize.value)) {
    busy.value = false
    error.value = text('分页参数无效，请重新选择清单。', 'Invalid pagination. Select the queue again.')
    return
  }
  if (route.query.departmentId !== undefined && (typeof route.query.departmentId !== 'string' || departmentId.value.length > 128)) {
    busy.value = false
    error.value = text('部门筛选无效，请重新选择。', 'Invalid department filter. Please select a department again.')
    return
  }
  busy.value = true
  const selectedQueue = queue.value
  try {
    const result = await getFopOrders({ queue: selectedQueue, departmentId: departmentId.value || undefined, search: typeof route.query.search === 'string' ? route.query.search : '', orderNumber: typeof route.query.orderNumber === 'string' ? route.query.orderNumber : undefined, page: page.value, pageSize: pageSize.value })
    if (currentRequest !== requestId) return
    if (!result.items.every(order => matchesFopQueue(order, selectedQueue))) throw new Error('Unexpected queue data')
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
  if (online.value && visible.value && queue.value) void load()
}
watch(() => route.fullPath, () => load(true), { immediate: true })
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
  requestId++
  clearInterval(refreshTimer)
  clearTimeout(copyTimer)
  document.removeEventListener('visibilitychange', refreshIfActive)
  window.removeEventListener('focus', refreshIfActive)
  window.removeEventListener('online', refreshIfActive)
  window.removeEventListener('offline', refreshIfActive)
})
async function copyOrderNumber(order: FopOrder) {
  try {
    await copyText(order.orderNumber)
    copiedOrder.value = order.id
    copyMessage.value = text('订单编号已复制', 'Order number copied')
  } catch {
    copiedOrder.value = ''
    copyMessage.value = text('复制失败，请选中订单编号手动复制', 'Copy failed. Select the order number and copy it manually.')
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copiedOrder.value = ''; copyMessage.value = '' }, 2400)
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
        <div><h2>{{ queue ? labels[queue] : text('履约订单', 'Fulfillment orders') }}{{ queue && queue !== 'exceptions' ? text('清单', ' orders') : '' }} <span v-if="data?.source === 'mock'" class="source-badge">MOCK</span></h2><p class="description">{{ queue ? descriptions[queue] : '' }}</p></div>
        <div class="refresh-controls"><button class="action-button refresh-orders" :disabled="busy || !queue || !online" @click="load()"><RefreshCw :size="15" :class="{ 'animate-spin': busy }" />{{ busy ? text('刷新中…', 'Refreshing…') : text('刷新', 'Refresh') }}</button><span class="refresh-status" :class="{ 'sync-paused': !online }">{{ !online ? text('网络已断开 · 自动刷新暂停', 'Offline · Auto-refresh paused') : !visible ? text('页面未激活 · 自动刷新暂停', 'Page inactive · Auto-refresh paused') : text('每 30 秒自动刷新', 'Refreshes every 30 seconds') }}<template v-if="refreshedTime"><br />{{ text('最近刷新', 'Last refreshed') }} {{ refreshedTime }} · UTC+8</template></span></div>
      </header>
      <p class="read-only-note">{{ text('仅查看履约进度，业务处理请在 FOP 完成。', 'View fulfillment progress here. Complete business actions in FOP.') }}</p>
      <p v-if="copyMessage" class="copy-feedback" role="status">{{ copyMessage }}</p>
      <section class="list-panel">
        <div class="list-toolbar">
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
              <thead><tr><th class="order-cell">{{ text('订单编号', 'Order number') }}</th><th class="product-cell">{{ text('商品图片 / 商品信息', 'Product image / details') }}</th><th>{{ text('Shopify 单号', 'Shopify order') }}</th><th>{{ text('客户名称', 'Customer') }}</th><th aria-sort="ascending" :title="text('按收款时间从早到晚（UTC+8）', 'Oldest payment first (UTC+8)')">{{ text('收款日期', 'Payment date') }} <span aria-hidden="true">↑</span></th><th>{{ text('支付状态', 'Payment status') }}</th><th>{{ columns[queue] }}</th><th>{{ text('店铺', 'Store') }}</th><th>{{ text('本地 SKU / 规格', 'Local SKU / variant') }}</th><th>{{ text('数量', 'Quantity') }}</th><th>{{ text('订单金额', 'Order amount') }}</th><th v-if="queue === 'exceptions'">{{ text('异常时长', 'Exception age') }}</th><th>{{ text('发货仓库', 'Warehouse') }}</th><th v-if="queue === 'dispatch' || queue === 'shipping'">{{ text('物流商', 'Carrier') }}</th><th v-if="queue === 'dispatch' || queue === 'shipping'">{{ text('跟踪号', 'Tracking number') }}</th><th>{{ text('业务员', 'Salesperson') }}</th><th>{{ text('所属部门', 'Department') }}</th><th>{{ text('创建时间', 'Created at') }}</th></tr></thead>
              <tbody><tr v-for="order in data.items" :key="order.id">
                <td class="order-cell"><button type="button" class="copy-order" :aria-label="`${text('复制订单编号', 'Copy order number')} ${order.orderNumber}`" :title="text('复制订单编号', 'Copy order number')" @click="copyOrderNumber(order)"><strong>{{ order.orderNumber }}</strong><Check v-if="copiedOrder === order.id" :size="14" /><Copy v-else :size="14" /></button><span v-if="order.items.length > 1" class="multi-item-badge">{{ text(`${order.items.length} 款商品 · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} 件`, `${order.items.length} products · ${order.items.reduce((sum, item) => sum + item.quantity, 0)} units`) }}</span></td><td class="product-cell"><div v-for="(item, index) in order.items" :key="index" class="product"><img v-if="item.imageUrl && !failedImages.has(item.imageUrl)" :src="item.imageUrl" :alt="item.name" loading="lazy" @error="failedImages.add(item.imageUrl!)" /><span v-else class="image-fallback"><PackageSearch :size="20" /></span><span :title="item.name">{{ item.name }}</span></div></td><td class="mono">{{ order.shopifyOrderNumber }}</td><td>{{ order.customerName }}</td><td>{{ formatDate(order.paidAt) }}</td>

                <td><span class="status-pill" :class="order.paymentStatus">{{ payments[order.paymentStatus] }}</span></td>
                <td><span class="status-pill pending">{{ queueStatus(order) }}</span></td><td>{{ order.storeName }}</td>
                <td><div v-for="(item, index) in order.items" :key="index" class="sku-item"><strong>{{ item.sku }}</strong><small>{{ item.variant }}</small></div></td>
                <td><div v-for="(item, index) in order.items" :key="index" class="quantity-item">{{ item.quantity }}</div></td><td class="money">{{ formatMoney(order.amount, order.currency) }}</td>

                <td v-if="queue === 'exceptions'">{{ order.exception?.hours }}h</td><td>{{ order.warehouse }}</td><td v-if="queue === 'dispatch' || queue === 'shipping'">{{ order.carrier || '—' }}</td><td v-if="queue === 'dispatch' || queue === 'shipping'" class="mono">{{ order.trackingNumber || '—' }}</td><td>{{ order.owner?.name || order.salesperson }}</td><td><RouterLink v-if="order.department" :to="{ name: 'Organization', query: { node: order.department.id } }" class="text-indigo-600">{{ order.department.name }}</RouterLink><span v-else>—</span></td><td>{{ formatDate(order.createdAt) }}</td>
              </tr><tr v-if="!data.items.length"><td :colspan="11 + columnsAfterAmount"><div class="state-message" role="status"><PackageSearch :size="36" /><strong>{{ text('暂无符合条件的订单', 'No matching orders') }}</strong><span>{{ text('请调整搜索条件，或切换上方清单。', 'Adjust your search or select another queue.') }}</span></div></td></tr></tbody>
              <TableTotals>
                <th scope="row">{{ text('筛选合计', 'Filtered total') }} · {{ data.totals?.orderCount.toLocaleString() ?? '—' }} {{ text('笔订单', 'orders') }}</th>
                <td colspan="8" />
                <td class="quantity-total">{{ data.totals?.itemQuantity.toLocaleString() ?? '—' }}</td>
                <td class="money"><OrderAmountTotals :totals="data.totals" /></td>
                <td :colspan="columnsAfterAmount"><small>{{ text('全部筛选结果 · 金额按币种汇总', 'All filtered results · Amounts grouped by currency') }}</small></td>
              </TableTotals>
            </table>
          </div>
          <footer class="pagination"><span>{{ text('按订单分页，多商品在同一订单中展示', 'Paginated by order; items stay grouped') }}</span><div><label>{{ text('每页', 'Per page') }}<select :value="pageSize" :aria-label="text('每页条数', 'Page size')" @change="navigate({ pageSize: ($event.target as HTMLSelectElement).value, page: 1 })"><option v-for="size in [10, 20, 50]" :key="size" :value="size">{{ size }}</option></select></label><button :disabled="page <= 1" :aria-label="text('上一页', 'Previous page')" @click="navigate({ page: page - 1 })"><ChevronLeft :size="16" /></button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" :aria-label="text('下一页', 'Next page')" @click="navigate({ page: page + 1 })"><ChevronRight :size="16" /></button></div></footer>
        </template>
      </section>
      <p v-if="data?.source === 'mock'" class="demo-note">{{ text('当前为演示订单，非真实履约业务数据。', 'Demo orders only; these are not live fulfillment records.') }}</p>
  </div>
</template>

<style scoped>
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
.department-filter select { min-width: 160px; max-width: 280px; padding: 9px 28px 9px 12px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-surface); color: var(--color-text); font-size: 12px; }
.search-form { display: flex; gap: 8px; flex: 1; max-width: 640px; }
.search-field { display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 6px; color: #8a96a8; flex: 1; min-width: 0; }
input { width: 100%; min-width: 0; background: transparent; color: var(--color-text); border: 0; padding: 10px 0; font-size: 12px; }
.result-count { white-space: nowrap; color: #8490a3; font-size: 12px; }
.exact-filter { padding: 0 20px 16px; display: flex; gap: 16px; font-size: 12px; }
.exact-filter button, .error-message button { color: #5873d4; text-decoration: underline; }
.table-scroll { overflow: auto; max-height: 65vh; border-top: 1px solid var(--color-border); }
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
.copy-order { display: inline-flex; align-items: center; gap: 8px; text-align: left; user-select: text; }
.copy-order svg { color: var(--color-text-secondary); flex-shrink: 0; }
.copy-order:hover svg { color: #91a9e9; }
.multi-item-badge { display: block; width: fit-content; margin-top: 8px; color: var(--color-text-secondary); background: var(--color-surface-muted); border-radius: 4px; padding: 3px 6px; font-size: 10px; }
.copy-feedback { position: fixed; top: 82px; right: 24px; z-index: 70; padding: 10px 16px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 7px; box-shadow: 0 5px 20px #0002; font-size: 12px; }
.sku-item { box-sizing: border-box; overflow: hidden; }
.sku-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
@media (max-width: 700px) { .list-heading { flex-wrap: wrap; }.refresh-controls { justify-content: flex-start; } }
</style>

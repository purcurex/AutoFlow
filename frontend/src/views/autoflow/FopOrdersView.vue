<script setup lang="ts">
import { formatCurrency } from '@/utils/currency'
import TableTotals from '@/components/ui/TableTotals.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, PackageSearch, RefreshCw, Search } from 'lucide-vue-next'
import { getFopOrders, isFopOrderQueue, matchesFopQueue, type FopOrderPage } from '@/api/fop-orders'
import { fopAccessError } from '@/api/fop-access'

import { defaultWorkbenchQueue, isWorkbenchRole, workbenchOrderLocation, workbenchQueues } from '@/utils/workbench'

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
const labels = computed(() => ({ procurement: text('待采购', 'Pending purchase'), review: text('待审核', 'Pending review'), allocation: text('待配货', 'Pending allocation'), dispatch: text('待发运', 'Pending shipment'), shipping: text('待发货', 'Pending dispatch'), exceptions: text('异常订单', 'Order exceptions') }))
const columns = computed(() => ({ procurement: text('采购状态', 'Purchase status'), review: text('审核状态', 'Review status'), allocation: text('配货状态', 'Allocation status'), dispatch: text('发运状态', 'Shipment status'), shipping: text('发货状态', 'Dispatch status'), exceptions: text('异常原因', 'Exception reason') }))
const descriptions = computed(() => ({
  procurement: text('仅显示已审核、已支付且等待采购的履约订单。', 'Approved, paid fulfillment orders awaiting procurement.'),
  review: text('仅显示等待审核的有效履约订单。', 'Active fulfillment orders awaiting review.'),
  allocation: text('仅显示已审核、已支付且等待配货的履约订单。', 'Approved, paid fulfillment orders awaiting allocation.'),
  dispatch: text('仅显示已支付、已配货且等待发运的履约订单。', 'Paid, allocated fulfillment orders awaiting shipment.'),
  shipping: text('仅显示已支付、已发运且等待仓库发货的履约订单。', 'Paid orders handed over for shipment and awaiting warehouse dispatch.'),
  exceptions: text('仅显示已支付、尚未发货且存在异常的履约订单。', 'Paid, unshipped fulfillment orders with an active exception.'),
}))
const reasons = computed(() => ({ stock: text('库存不足', 'Insufficient stock'), address: text('地址待核验', 'Address verification'), tracking: text('物流单号异常', 'Tracking issue') }))
const payments = computed(() => ({ paid: text('已支付', 'Paid'), unpaid: text('未支付', 'Unpaid'), refunded: text('已退款', 'Refunded') }))
const search = ref('')
const data = ref<FopOrderPage>()
const busy = ref(false)
const error = ref('')
const failedImages = ref(new Set<string>())
const page = computed(() => Number(route.query.page || 1))
const pageSize = computed(() => Number(route.query.pageSize || 10))
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total || 0) / pageSize.value)))
const columnsAfterAmount = computed(() => queue.value === 'exceptions' ? 5 : queue.value === 'dispatch' || queue.value === 'shipping' ? 6 : 4)
let requestId = 0

async function load() {
  const currentRequest = ++requestId
  data.value = undefined
  error.value = ''
  search.value = typeof route.query.search === 'string' ? route.query.search : ''
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
  busy.value = true
  const selectedQueue = queue.value
  try {
    const result = await getFopOrders({ queue: selectedQueue, search: search.value, orderNumber: typeof route.query.orderNumber === 'string' ? route.query.orderNumber : undefined, page: page.value, pageSize: pageSize.value })
    if (currentRequest !== requestId) return
    if (!result.items.every(order => matchesFopQueue(order, selectedQueue))) throw new Error('Unexpected queue data')
    data.value = result
  } catch (cause) {
    if (currentRequest === requestId) error.value = fopAccessError(cause, zh.value)
  } finally {
    if (currentRequest === requestId) busy.value = false
  }
}
watch(() => route.fullPath, load, { immediate: true })
onBeforeUnmount(() => { requestId++ })
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
        <button class="action-button" :disabled="busy || !queue" @click="load"><RefreshCw :size="15" :class="{ 'animate-spin': busy }" />{{ text('刷新', 'Refresh') }}</button>
      </header>
      <section class="list-panel">
        <div class="list-toolbar">
          <form class="search-form" @submit.prevent="submitSearch"><label class="search-field"><Search :size="16" /><input v-model="search" type="search" :aria-label="text('搜索履约订单', 'Search fulfillment orders')" :placeholder="text('订单编号 / Shopify 单号 / 客户 / 店铺 / SKU', 'Order / Shopify order / customer / store / SKU')" /></label><button class="action-button primary" :disabled="busy || !queue">{{ text('查询', 'Search') }}</button></form>
          <span class="result-count" aria-live="polite">{{ data ? text(`共 ${data.total} 笔订单`, `${data.total} orders`) : '—' }}</span>
        </div>
        <div v-if="route.query.orderNumber" class="exact-filter"><span>{{ text('指定订单', 'Selected order') }}：{{ route.query.orderNumber }}</span><button @click="navigate({ orderNumber: undefined, page: 1 })">{{ text('查看该类全部订单', 'View all orders in this queue') }}</button></div>
        <p v-if="error" class="state-message error-message" role="alert">{{ error }} <button v-if="queue" @click="load">{{ text('重试', 'Retry') }}</button></p>
        <div v-else-if="busy" class="state-message" role="status"><RefreshCw class="animate-spin" :size="22" />{{ text('正在加载订单…', 'Loading orders…') }}</div>
        <template v-else-if="data && queue">
          <div class="table-scroll" tabindex="0" :aria-label="text('履约订单明细表，可横向滚动', 'Fulfillment orders, scroll horizontally for more fields')">
            <table>
              <thead><tr><th class="order-cell">{{ text('订单编号', 'Order number') }}</th><th>{{ text('Shopify 单号', 'Shopify order') }}</th><th>{{ text('客户名称', 'Customer') }}</th><th class="product-cell">{{ text('商品图片 / 商品信息', 'Product image / details') }}</th><th>{{ text('支付状态', 'Payment status') }}</th><th>{{ columns[queue] }}</th><th>{{ text('组织', 'Organization') }}</th><th>{{ text('所属部门', 'Department') }}</th><th>{{ text('店铺', 'Store') }}</th><th>{{ text('本地 SKU / 规格', 'Local SKU / variant') }}</th><th>{{ text('数量', 'Quantity') }}</th><th>{{ text('订单金额', 'Order amount') }}</th><th v-if="queue === 'exceptions'">{{ text('异常时长', 'Exception age') }}</th><th>{{ text('发货仓库', 'Warehouse') }}</th><th v-if="queue === 'dispatch' || queue === 'shipping'">{{ text('物流商', 'Carrier') }}</th><th v-if="queue === 'dispatch' || queue === 'shipping'">{{ text('跟踪号', 'Tracking number') }}</th><th>{{ text('业务员', 'Salesperson') }}</th><th>{{ text('收款日期', 'Payment date') }}</th><th>{{ text('创建时间', 'Created at') }}</th></tr></thead>
              <tbody><tr v-for="order in data.items" :key="order.id">
                <td class="order-cell"><strong>{{ order.orderNumber }}</strong></td><td class="mono">{{ order.shopifyOrderNumber }}</td><td>{{ order.customerName }}</td>
                <td class="product-cell"><div v-for="(item, index) in order.items" :key="index" class="product"><img v-if="item.imageUrl && !failedImages.has(item.imageUrl)" :src="item.imageUrl" :alt="item.name" loading="lazy" @error="failedImages.add(item.imageUrl!)" /><span v-else class="image-fallback"><PackageSearch :size="20" /></span><span>{{ item.name }}</span></div></td>
                <td><span class="status-pill" :class="order.paymentStatus">{{ payments[order.paymentStatus] }}</span></td>
                <td><span class="status-pill pending">{{ queue === 'exceptions' ? (order.exception ? reasons[order.exception.reason] : '—') : labels[queue] }}</span></td><td>{{ order.organization?.name || '—' }}</td><td><RouterLink v-if="order.department" :to="{ name: 'Organization', query: { node: order.department.id } }" class="text-indigo-600">{{ order.department.name }}</RouterLink><span v-else>—</span></td><td>{{ order.storeName }}</td>
                <td><div v-for="(item, index) in order.items" :key="index" class="sku-item"><strong>{{ item.sku }}</strong><small>{{ item.variant }}</small></div></td>
                <td><div v-for="(item, index) in order.items" :key="index" class="quantity-item">{{ item.quantity }}</div></td><td class="money">{{ formatMoney(order.amount, order.currency) }}</td>

                <td v-if="queue === 'exceptions'">{{ order.exception?.hours }}h</td><td>{{ order.warehouse }}</td><td v-if="queue === 'dispatch' || queue === 'shipping'">{{ order.carrier || '—' }}</td><td v-if="queue === 'dispatch' || queue === 'shipping'" class="mono">{{ order.trackingNumber || '—' }}</td><td>{{ order.owner?.name || order.salesperson }}</td><td>{{ formatDate(order.paidAt) }}</td><td>{{ formatDate(order.createdAt) }}</td>
              </tr><tr v-if="!data.items.length"><td :colspan="12 + columnsAfterAmount"><div class="state-message" role="status"><PackageSearch :size="36" /><strong>{{ text('暂无符合条件的订单', 'No matching orders') }}</strong><span>{{ text('请调整搜索条件，或切换上方清单。', 'Adjust your search or select another queue.') }}</span></div></td></tr></tbody>
              <TableTotals>
                <th scope="row">{{ text('筛选合计', 'Filtered total') }} · {{ data.totals?.orderCount.toLocaleString() ?? '—' }} {{ text('笔订单', 'orders') }}</th>
                <td colspan="9" />
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
.list-toolbar { padding: 18px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
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
.order-cell strong { color: #5873d4; font-size: 12px; font-weight: 600; }
.product-cell { min-width: 220px; max-width: 290px; }
.product { display: flex; align-items: center; gap: 10px; min-height: 46px; }
.product > span:last-child { max-width: 200px; white-space: normal; line-height: 1.5; }
.product img, .image-fallback { width: 42px; height: 42px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.image-fallback { display: flex; align-items: center; justify-content: center; background: #e5eaf1; color: #8893a5; }
.sku-item { min-height: 46px; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
.sku-item strong { font-weight: 500; font-size: 11px; }.sku-item small { color: #8490a3; font-size: 10px; }
.quantity-item { min-height: 46px; display: flex; align-items: center; }.money, .mono { font-variant-numeric: tabular-nums; }
.status-pill { display: inline-flex; border-radius: 4px; padding: 4px 7px; font-size: 11px; white-space: nowrap; }
.paid { color: #0f9874; background: #14b8a612; }.unpaid, .refunded { color: #b57b20; background: #f59e0b12; }.pending { color: #5873d4; background: #5873d412; }
.pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--color-border); padding: 14px 20px; color: #8490a3; font-size: 11px; }
.pagination div, .pagination label { display: flex; align-items: center; gap: 12px; }.pagination button { padding: 5px; }.pagination select { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; padding: 4px; }
.state-message { min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #8490a3; font-size: 13px; padding: 24px; text-align: center; }.error-message { color: #dc6767; }
.demo-note { margin-top: 14px; color: #8a96a8; font-size: 11px; }
button:disabled { opacity: .4; cursor: not-allowed; }
@media (max-width: 700px) { .list-heading { align-items: flex-start; }h2 { font-size: 23px; }.list-toolbar { flex-wrap: wrap; padding: 14px; }.search-form { flex-basis: 100%; }.pagination { flex-wrap: wrap; padding: 14px; }.queue-tabs a { padding: 9px 12px; }.order-cell { position: static; }.exact-filter { flex-wrap: wrap; } }
</style>

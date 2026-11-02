<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PackageSearch, RefreshCw, Search } from 'lucide-vue-next'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import StockCopy from './StockCopy.vue'
import { getAllocationInventory, type AllocationInventoryPage } from '@/api/allocation-inventory'
import { fopAccessError } from '@/api/fop-access'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
const props = withDefaults(defineProps<{ orderIds: string[]; warehouseCode?: string; queue?: 'allocation' | 'shipping' }>(), { queue: 'allocation' })
const emit = defineEmits<{ close: [] }>()
const { locale } = useI18n(), zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const selectedMode = computed(() => props.orderIds.length > 0)
const search = ref(''), applied = ref(''), warehouse = ref(props.warehouseCode ?? '')
const page = ref(1), result = ref<AllocationInventoryPage>(), loading = ref(false), error = ref('')
let request = 0, closed = false
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / 50)))
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value))
async function load() {
  if (closed) return
  const ticket = ++request, session = captureSession()
  result.value = undefined; error.value = ''; loading.value = false
  if (!selectedMode.value && !applied.value) return
  loading.value = true
  try {
    const next = await getAllocationInventory({ ...(selectedMode.value ? { mode: 'selected' as const, orderIds: [...props.orderIds] } : { mode: 'search' as const, search: applied.value }), queue: props.queue, warehouseCode: warehouse.value || undefined, page: page.value, pageSize: 50 })
    if (closed || ticket !== request || !isCurrentSession(session)) return
    if (next.total > 0 && page.value > Math.ceil(next.total / 50)) { page.value = Math.ceil(next.total / 50); void load(); return }
    result.value = next
  } catch (cause) {
    if (closed || ticket !== request || !isCurrentSession(session)) return
    const code = (cause as { response?: { data?: { code?: string } }; code?: string })?.response?.data?.code ?? (cause as { code?: string })?.code
    error.value = code === 'inventory_orders_changed' ? text('订单进度已变化，请关闭弹窗、刷新清单后重新选择。', 'Orders have changed. Close, refresh the list and select again.') : fopAccessError(cause, zh.value)
  } finally { if (ticket === request && isCurrentSession(session)) loading.value = false }
}
function submit() { applied.value = search.value.trim(); page.value = 1; void load() }
watch(search, value => { if (!value.trim() && applied.value) { applied.value = ''; page.value = 1; void load() } })
watch(warehouse, () => { page.value = 1; void load() })
function changePage(next: number) { page.value = next; void load() }
const off = onSessionReset(() => { closed = true; request++; result.value = undefined; loading.value = false; emit('close') })
onMounted(load)
onBeforeUnmount(() => { closed = true; request++; off() })
</script>
<template>
  <OrganizationModal :title="text('即时库存', 'Current inventory')" @close="emit('close')">
    <div class="inventory-context"><PackageSearch :size="18" /><div><strong>{{ selectedMode ? text(`已选 ${orderIds.length} 笔订单`, `${orderIds.length} selected orders`) : text('按 SKU 查询', 'Search by SKU') }}</strong><p>{{ selectedMode ? text('仅展示所选订单的 SKU · 公共库存与对应客户专属库存', 'Selected order SKUs only · Public and corresponding customer inventory') : text('输入 SKU 模糊查询，分别展示公共库存与客户专属库存', 'Search SKU text to view public and customer inventory separately') }}</p></div></div>
    <form class="inventory-toolbar" @submit.prevent="submit">
      <label v-if="!selectedMode" class="inventory-search"><Search :size="16" /><input v-model="search" type="search" :aria-label="text('搜索库存 SKU', 'Search inventory SKU')" :placeholder="text('输入 SKU，支持模糊查询', 'Enter SKU text')" /></label>
      <button v-if="!selectedMode" class="btn workbench-primary" :disabled="loading || !search.trim()">{{ text('查询', 'Search') }}</button>
      <label class="inventory-warehouse">{{ text('仓库', 'Warehouse') }}<select v-model="warehouse" class="input" :aria-label="text('库存仓库', 'Inventory warehouse')"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ text('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ text('深圳仓', 'Shenzhen') }}</option></select></label>
      <button type="button" class="btn btn-secondary workbench-refresh" :disabled="loading || !selectedMode && !applied" @click="load"><RefreshCw :size="14" :class="{ 'animate-spin': loading }" />{{ text('刷新', 'Refresh') }}</button>
    </form>
    <div class="inventory-results" :aria-busy="loading">
      <p v-if="error" class="inventory-error" role="alert">{{ error }}</p>
      <table v-else-if="result?.items.length"><colgroup><col style="width:28%" /><col style="width:12%" /><col style="width:24%" /><col style="width:12%" /><col style="width:12%" /><col style="width:12%" /></colgroup><thead><tr><th>{{ text('商品 / SKU', 'Product / SKU') }}</th><th>{{ text('仓库', 'Warehouse') }}</th><th>{{ text('库存归属', 'Inventory owner') }}</th><th>{{ text('在库数量', 'On hand') }}</th><th>{{ text('配货占用', 'Allocated') }}</th><th>{{ text('实物余量', 'Physical balance') }}</th></tr></thead>
        <tbody><tr v-for="row in result.items" :key="row.id"><td><p class="product-name" :title="row.name">{{ row.name }}</p><StockCopy :value="row.sku" /></td><td>{{ row.warehouse }}</td><td><span class="pool-tag" :class="{ dedicated: row.customer }">{{ row.customer ? text('客户专属', 'Customer stock') : text('公共库存', 'Public inventory') }}</span><p v-if="row.customer" class="customer-name">{{ row.customer.name }}</p></td><td class="quantity">{{ row.onHand.toLocaleString() }}</td><td class="quantity muted">{{ row.occupied.toLocaleString() }}</td><td class="quantity balance" :class="{ zero: row.free === 0 }">{{ row.free.toLocaleString() }}</td></tr></tbody>
      </table>
      <div v-else class="inventory-empty"><PackageSearch :size="30" /><p>{{ loading ? text('正在查询库存…', 'Loading inventory…') : result ? text('没有符合条件的库存项目', 'No matching inventory scopes') : text('输入 SKU 后查询库存', 'Enter a SKU to query inventory') }}</p></div>
    </div>
    <p class="inventory-guidance">{{ text('实物余量 = 在库数量 − 配货占用；实际可配量还受全款备货权益保护，以 FOP 配货结果为准。公共库存按 SKU、仓库去重，未为所选订单预留。', 'Physical balance = on hand − allocated. Full-payment protections also affect allocatable stock; FOP determines the result. Public stock is listed once per SKU and warehouse and is not reserved for these orders.') }}</p>
    <div class="inventory-bottom"><small>{{ result ? `${text('数据时间', 'As of')} ${date(result.asOf)} · UTC+8` : '' }}</small><template v-if="result"><span>{{ text(`共 ${result.total} 项`, `${result.total} pools`) }}</span><button class="btn btn-secondary" :disabled="loading || page <= 1" @click="changePage(page - 1)">‹</button><span>{{ page }} / {{ pages }}</span><button class="btn btn-secondary" :disabled="loading || page >= pages" @click="changePage(page + 1)">›</button></template></div>
    <template #footer><button class="btn btn-secondary" @click="emit('close')">{{ text('关闭', 'Close') }}</button></template>
  </OrganizationModal>
</template>
<style scoped>
.inventory-guidance { margin: 12px 0 0; color: var(--color-text-secondary); font-size: 11px; line-height: 1.7; word-break: normal; }
.inventory-context{display:flex;align-items:center;gap:12px;padding:14px 16px;background:var(--color-background);border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary)}.inventory-context>div{flex:1;min-width:0}.inventory-context strong{font-size:13px;color:var(--color-text);font-weight:500}.inventory-context p{font-size:11px;line-height:1.6;margin-top:5px}.inventory-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:20px 0}.inventory-search{display:flex;align-items:center;gap:8px;width:250px;max-width:100%;height:36px;padding:8px 10px;border:1px solid var(--color-border);border-radius:6px;color:var(--color-text-secondary)}.inventory-search input{background:none;border:0;outline:none!important;box-shadow:none!important;min-width:0;width:100%;font-size:12px;color:var(--color-text)}.inventory-warehouse{display:flex;align-items:center;gap:8px;margin-left:auto;color:var(--color-text-secondary);font-size:12px}.inventory-warehouse select{width:110px!important;padding:8px;font-size:12px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:12px;min-height:36px}.inventory-results{min-height:230px}.inventory-results table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.inventory-results th,.inventory-results td{padding:14px 9px;text-align:left;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere}.inventory-results th{background:var(--color-background);font-size:11px;color:var(--color-text-secondary);font-weight:500}.product-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin:0 0 6px}.inventory-results :deep(.stock-copy){font-size:10px;color:var(--color-text-secondary)}.pool-tag{display:inline-block;padding:3px 7px;border-radius:4px;background:#6d92bd18;color:#7897bf;font-size:10px}.pool-tag.dedicated{background:#6daca118;color:#73a79d}.customer-name{font-size:11px;line-height:1.5;margin:6px 0 0}.quantity{font-variant-numeric:tabular-nums;font-weight:500}.quantity.balance{color:#73a79d;font-size:16px}.quantity.zero,.muted{color:var(--color-text-secondary)}.inventory-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:230px;gap:12px;color:var(--color-text-secondary);font-size:12px}.inventory-error{padding:20px 0;color:#bd7f86;font-size:13px}.inventory-bottom{height:48px;display:flex;align-items:center;gap:10px;font-size:11px;color:var(--color-text-secondary)}.inventory-bottom small{margin-right:auto;font-size:10px}@media(max-width:600px){.inventory-warehouse{margin-left:0}.inventory-results th,.inventory-results td{padding:10px 4px;font-size:10px}.inventory-bottom{flex-wrap:wrap;height:auto;min-height:48px}.inventory-bottom small{flex-basis:100%}}
</style>

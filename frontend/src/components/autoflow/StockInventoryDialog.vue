<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, Search } from 'lucide-vue-next'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import OrderProductImage from './OrderProductImage.vue'
import StockCopy from './StockCopy.vue'
import { getStockInventory, type StockInventoryPage } from '@/api/fop-stock'
import { fopAccessError } from '@/api/fop-access'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'

const props = defineProps<{ departmentId?: string; ownerId?: string; warehouseCode?: string }>()
const emit = defineEmits<{ close: [] }>()
const { locale } = useI18n(), zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const customerSearch = ref(''), appliedCustomer = ref(''), sku = ref(''), appliedSku = ref('')
const warehouse = ref(props.warehouseCode ?? ''), page = ref(1), pageSize = ref(50), result = ref<StockInventoryPage>(), loading = ref(false), error = ref('')
let inventoryRequest = 0, disposed = false, sessionClosed = false
const scope = computed(() => ({ departmentId: props.departmentId, ownerId: props.ownerId }))
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / pageSize.value)))
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value))
async function load() {
  if (disposed || sessionClosed) return
  const ticket = ++inventoryRequest, session = captureSession()
  error.value = ''; result.value = undefined; loading.value = true
  try {
    const next = await getStockInventory({ ...scope.value, customerSearch: appliedCustomer.value || undefined, search: appliedSku.value || undefined, warehouseCode: warehouse.value || undefined, page: page.value, pageSize: pageSize.value })
    if (disposed || ticket !== inventoryRequest || !isCurrentSession(session)) return
    if (next.total > 0 && (page.value - 1) * pageSize.value >= next.total) { page.value = Math.ceil(next.total / pageSize.value); void load(); return }
    result.value = next
  } catch (cause) { if (!disposed && ticket === inventoryRequest && isCurrentSession(session)) error.value = fopAccessError(cause, zh.value) }
  finally { if (ticket === inventoryRequest && isCurrentSession(session)) loading.value = false }
}
function search() { appliedCustomer.value = customerSearch.value.trim(); appliedSku.value = sku.value.trim(); page.value = 1; void load() }
watch(sku, value => { if (!value.trim() && appliedSku.value) { appliedSku.value = ''; page.value = 1; void load() } })
watch(customerSearch, value => { if (!value.trim() && appliedCustomer.value) { appliedCustomer.value = ''; page.value = 1; void load() } })
watch([warehouse, pageSize, scope], () => { page.value = 1; void load() })
function changePage(next: number) { page.value = next; void load() }
const off = onSessionReset(() => { sessionClosed = true; inventoryRequest++; result.value = undefined; loading.value = false; emit('close') })
onMounted(load)
onBeforeUnmount(() => { disposed = true; inventoryRequest++; off() })
</script>
<template>
  <OrganizationModal :title="text('查询备货库存', 'Stock inventory')" @close="emit('close')">
    <form class="inventory-filters" @submit.prevent="search">
      <label class="inventory-field"><span>{{ text('客户', 'Customer') }}</span><span class="inventory-search"><Search :size="15" /><input v-model="customerSearch" type="search" maxlength="200" :placeholder="text('客户名称 / 编码', 'Customer name / code')" :aria-label="text('搜索客户', 'Search customers')" /></span></label>
      <label class="inventory-field"><span>{{ text('商品', 'Product') }}</span><span class="inventory-search"><Search :size="15" /><input v-model="sku" type="search" maxlength="200" :aria-label="text('搜索库存 SKU', 'Search inventory SKU')" :placeholder="text('SKU / 商品名称', 'SKU / product name')" /></span></label>
      <button class="btn workbench-primary" :disabled="loading">{{ text('查询', 'Search') }}</button>
      <label class="inventory-warehouse">{{ text('收货仓库', 'Warehouse') }}<select v-model="warehouse" class="input" :aria-label="text('收货仓库', 'Warehouse')"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ text('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ text('深圳仓', 'Shenzhen') }}</option></select></label>
      <button class="btn btn-secondary workbench-refresh" type="button" :disabled="loading" :aria-label="text('刷新', 'Refresh')" @click="load"><RefreshCw :size="14" /></button>
    </form>
    <div class="inventory-caption"><strong>{{ text('客户备货库存', 'Customer stock inventory') }}</strong><small v-if="result">{{ text(`共 ${result.total} 条`, `${result.total} records`) }}</small></div>
    <p v-if="error" class="inventory-error" role="alert">{{ error }}</p>
    <table v-if="result?.items.length" class="inventory-table"><colgroup><col style="width:18%" /><col style="width:27%" /><col style="width:10%" /><col style="width:17%" /><col style="width:17%" /><col style="width:11%" /></colgroup><thead><tr><th>{{ text('客户', 'Customer') }}</th><th>{{ text('商品 / SKU', 'Product / SKU') }}</th><th>{{ text('仓库', 'Warehouse') }}</th><th>{{ text('全款备货', 'Full payment') }}</th><th>{{ text('押金备货', 'Deposit') }}</th><th>{{ text('即时在库合计', 'Total on hand') }}</th></tr></thead><tbody><tr v-for="row in result.items" :key="row.id"><td :data-label="text('客户', 'Customer')" class="inventory-customer"><strong>{{ row.customerName }}</strong><small>{{ row.customerCode }}</small></td><td :data-label="text('商品 / SKU', 'Product / SKU')"><div class="inventory-product"><OrderProductImage :src="row.imageUrl" :name="row.name" /><div><p :title="row.name">{{ row.name }}</p><StockCopy :value="row.sku" /></div></div></td><td :data-label="text('仓库', 'Warehouse')">{{ row.warehouse }}</td><td v-for="(balance, index) in [row.fullPayment, row.deposit]" :key="index" :data-label="index ? text('押金备货', 'Deposit') : text('全款备货', 'Full payment')" class="inventory-balance" :class="{ deposit: index }"><div>{{ text('可用', 'Available') }} <strong>{{ balance.available }}</strong></div><small>{{ text('锁定', 'Reserved') }} {{ balance.locked }} <span>·</span> {{ text('在库', 'On hand') }} {{ balance.onHand }}</small></td><td :data-label="text('即时在库合计', 'Total on hand')" class="inventory-total">{{ row.onHand }}</td></tr></tbody></table>
    <div v-else class="inventory-empty">{{ loading ? text('正在查询库存…', 'Loading inventory…') : error ? text('请刷新重试', 'Refresh to retry') : text('暂无符合条件的库存记录', 'No matching inventory records') }}</div>
    <div v-if="result" class="inventory-bottom"><small>{{ text('更新时间', 'Updated') }} {{ date(result.refreshedAt) }} · UTC+8<br />{{ text(`共 ${result.total} 项客户 / SKU / 仓库记录`, `${result.total} customer / SKU / warehouse records`) }}</small><label>{{ text('每页', 'Per page') }}<select v-model.number="pageSize" class="input"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option></select></label><button class="btn btn-secondary" :disabled="page <= 1 || loading" @click="changePage(page - 1)">‹</button><span>{{ page }} / {{ pages }}</span><button class="btn btn-secondary" :disabled="page >= pages || loading" @click="changePage(page + 1)">›</button></div>
    <template #footer><button class="btn btn-secondary" @click="emit('close')">{{ text('关闭', 'Close') }}</button></template>
  </OrganizationModal>
</template>

<style scoped>
.inventory-customers,.inventory-filters,.inventory-caption,.inventory-bottom{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.inventory-customers{padding-bottom:18px;border-bottom:1px solid var(--color-border)}.inventory-customers label,.inventory-filters label,.inventory-bottom label{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-secondary)}.inventory-search{display:flex;align-items:center;gap:8px;min-width:0;width:240px;max-width:100%;padding:9px 10px;border:1px solid var(--color-border);border-radius:5px;color:var(--color-text-secondary)}.inventory-search input{width:100%;min-width:0;border:0;outline:0!important;box-shadow:none!important;background:none;font-size:12px;color:var(--color-text)}.customer-choice{flex:1;min-width:200px!important}.input{width:auto!important;font-size:12px;padding:8px}.btn{font-size:12px;display:inline-flex;align-items:center;gap:6px}.inventory-filters{padding:0 0 20px;border-bottom:1px solid var(--color-border);align-items:flex-end}.inventory-filters .inventory-field{display:grid;gap:7px}.inventory-filters .inventory-warehouse{display:grid;gap:7px;margin-left:auto}.inventory-search{width:220px;height:36px}.inventory-filters .btn{height:36px}.inventory-filters .input{height:36px}.inventory-customer strong,.inventory-customer small{display:block}.inventory-customer strong{font-size:12px;font-weight:500}.inventory-customer small,.inventory-caption small{font-size:10px;color:var(--color-text-secondary);margin-top:6px}.inventory-caption small{margin-left:auto}.inventory-balance small{line-height:1.6}.inventory-caption{padding:14px 0;font-size:13px}.inventory-caption>span{font-size:9px;letter-spacing:.1em;padding:2px 5px;border-radius:3px;background:#6fada01c;color:#74a396}.inventory-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.inventory-table th,.inventory-table td{padding:16px 8px;text-align:left;border-bottom:1px solid var(--color-border);overflow-wrap:anywhere}.inventory-table th{color:var(--color-text-secondary);font-size:11px;font-weight:500;background:var(--color-background)}.inventory-product{display:flex;align-items:center;gap:9px}.inventory-product>div{min-width:0}.inventory-product p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:5px}.inventory-product :deep(.stock-copy){font-size:10px;color:var(--color-text-secondary)}.inventory-balance{font-variant-numeric:tabular-nums}.inventory-balance strong{font-size:18px;font-weight:600;color:#7497c2;margin-left:5px}.inventory-balance.deposit strong{color:#b99e73}.inventory-balance small{display:block;font-size:10px;color:var(--color-text-secondary);margin-top:7px}.inventory-balance small span{margin:0 3px}.inventory-total{font-size:19px;font-weight:600;font-variant-numeric:tabular-nums}.inventory-bottom{padding-top:20px;font-size:12px}.inventory-bottom small{margin-right:auto;font-size:10px;color:var(--color-text-secondary);line-height:1.8}.inventory-bottom select{min-width:60px}.inventory-empty{padding:60px 15px;text-align:center;color:var(--color-text-secondary);font-size:13px}.inventory-error{color:#c67f83;font-size:12px;margin-top:12px}.inventory-hint{font-size:11px;color:var(--color-text-secondary);margin-top:10px}@media(max-width:650px){.inventory-table colgroup,.inventory-table thead{display:none}.inventory-table tbody,.inventory-table tr{display:block}.inventory-table tr{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--color-border);padding:10px 0}.inventory-table td{display:block;border:0;padding:10px;min-width:0}.inventory-table td:nth-child(2){grid-column:1 / -1}.inventory-table td:before{content:attr(data-label);display:block;font-size:10px;color:var(--color-text-secondary);margin-bottom:8px}.inventory-search{width:220px}.inventory-filters .inventory-warehouse{margin-left:0}}
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Search, RefreshCw, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { getPurchaseReturns, exportPurchaseReturns, purchaseReturnLabels, type PurchaseReturnStatus, type PurchaseReturnPage, type PurchaseReturnQuery } from '@/api/purchase-returns'
import { fopAccessError } from '@/api/fop-access'
import { fopExportError } from '@/api/fop-order-export'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { downloadBlob } from '@/utils/export'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import PurchaseReturnOrdersTable from '@/components/autoflow/PurchaseReturnOrdersTable.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh')), text = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const result = ref<PurchaseReturnPage>(), loading = ref(false), error = ref(''), exporting = ref(false), exportError = ref(''), copyStatus = ref(''), selected = ref<string[]>([]), search = ref(scalar('search'))
const query = computed<PurchaseReturnQuery>(() => ({ paidAtOrder: scalar('paidAtOrder') === 'desc' ? 'desc' : 'asc', workbenchRole: route.params.role === 'warehouse' ? 'warehouse' : 'procurement', search: scalar('search') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, warehouseCode: ['HZ', 'SZ'].includes(scalar('warehouseCode')) ? scalar('warehouseCode') as 'HZ' | 'SZ' : undefined, status: Object.hasOwn(purchaseReturnLabels, scalar('returnStatus')) ? scalar('returnStatus') as PurchaseReturnStatus : undefined, page: Math.max(1, Math.floor(Number(scalar('page')) || 1)), pageSize: [20, 50, 100].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 50 }))
const { defaultDepartmentLabel } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(row => [row.id, row.name]))))
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize))), allSelected = computed(() => !!result.value?.items.length && result.value.items.every(row => selected.value.includes(row.id)))
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'
let ticket = 0, exportTicket = 0, disposed = false, timer: ReturnType<typeof setInterval> | undefined, controller: AbortController | undefined, exportController: AbortController | undefined
async function navigate(changes: Record<string, string | number | undefined>) { await router.replace({ query: { ...route.query, ...changes } }) }
async function load() {
  if (exporting.value) return
  controller?.abort(); controller = new AbortController()
  const id = ++ticket, session = captureSession(); loading.value = true; error.value = ''
  try {
    const page = await getPurchaseReturns(query.value, controller.signal)
    if (disposed || id !== ticket || !isCurrentSession(session)) return
    if (query.value.page > Math.max(1, Math.ceil(page.total / query.value.pageSize))) { await navigate({ page: 1 }); return }
    result.value = page; selected.value = selected.value.filter(id => page.items.some(row => row.id === id)); emit('filter-labels', page.departments)
  } catch (cause) { if (!disposed && id === ticket && isCurrentSession(session)) { result.value = undefined; selected.value = []; error.value = fopAccessError(cause, zh.value) } }
  finally { if (!disposed && id === ticket) loading.value = false }
}
async function exportRows(mode: 'selected' | 'filtered') {
  if (loading.value || exporting.value) return
  exporting.value = true; exportError.value = ''; exportController = new AbortController()
  const id = ++exportTicket, session = captureSession(), fingerprint = JSON.stringify(query.value)
  try {
    const blob = await exportPurchaseReturns(query.value, mode, [...selected.value], exportController.signal)
    if (!disposed && id === exportTicket && isCurrentSession(session) && fingerprint === JSON.stringify(query.value)) downloadBlob(blob, 'purchase-returns.xlsx')
  } catch (cause) { if (!disposed && id === exportTicket && isCurrentSession(session) && fingerprint === JSON.stringify(query.value)) exportError.value = fopExportError(cause, zh.value) }
  finally { if (!disposed && id === exportTicket) exporting.value = false }
}
async function copy(value: string) { try { await navigator.clipboard.writeText(value); copyStatus.value = text('已复制', 'Copied') } catch { copyStatus.value = text('复制失败，请手动复制', 'Copy failed; copy manually') } }
function selectAll(event: Event) { selected.value = (event.target as HTMLInputElement).checked ? result.value?.items.map(row => row.id) ?? [] : [] }
watch(() => JSON.stringify(query.value), () => { ++exportTicket; controller?.abort(); exportController?.abort(); exporting.value = false; search.value = scalar('search'); result.value = undefined; selected.value = []; exportError.value = ''; copyStatus.value = ''; void load() }, { immediate: true })
const unregister = onSessionReset(() => { ++ticket; ++exportTicket; controller?.abort(); exportController?.abort(); result.value = undefined; selected.value = []; search.value = ''; error.value = ''; exportError.value = ''; exporting.value = false; loading.value = false; copyStatus.value = '' })
onMounted(() => { timer = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine && !loading.value && !exporting.value) void load() }, 30000) })
onBeforeUnmount(() => { disposed = true; ++ticket; clearInterval(timer); controller?.abort(); exportController?.abort(); unregister() })
</script>

<template>
  <section class="purchase-returns">
    <WorkbenchTaskHeading :title="text('采购退货清单', 'Purchase returns')" :description="text('按履约订单跟进采购退货，关联退货单及物流信息，相关操作在 FOP 完成。', 'Track purchase returns by fulfillment order; process returns in FOP.')">
      <div class="return-refresh"><button class="workbench-button" :disabled="loading || exporting" @click="load"><RefreshCw :size="14" />{{ text('刷新', 'Refresh') }}</button><small>{{ text('每 30 秒自动刷新', 'Refreshes every 30s') }}<br>{{ result ? date(result.refreshedAt) + ' · UTC+8' : '—' }}</small></div>
    </WorkbenchTaskHeading>
    <div class="return-panel">
      <form class="workbench-filter-toolbar" @submit.prevent="navigate({ search: search.trim() || undefined, page: 1 })">
        <div class="workbench-filter-main">
          <div class="workbench-filter-search"><label class="workbench-search-field"><Search :size="15" /><input v-model="search" :aria-label="text('搜索采购退货', 'Search purchase returns')" :placeholder="text('退货单 / 采购单 / 供应商 / 关联订单 / SKU', 'Return / purchase / supplier / order / SKU')" @input="!search && navigate({ search: undefined, page: 1 })"></label><button type="submit" class="workbench-button workbench-primary" :disabled="exporting">{{ text('查询', 'Search') }}</button></div>
          <label>{{ text('业务部门', 'Department') }}<select class="workbench-filter-select" :value="query.departmentId || ''" :disabled="exporting" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, ownerId: undefined, page: 1 })"><option value="">{{ defaultDepartmentLabel }}</option><option v-for="department in result?.departments" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          <label>{{ text('出库仓库', 'Outbound warehouse') }}<select class="workbench-filter-select" :value="query.warehouseCode || ''" :disabled="exporting" @change="navigate({ warehouseCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ text('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ text('深圳仓', 'Shenzhen') }}</option></select></label>
        </div>
        <div class="workbench-filter-secondary"><label>{{ text('退货进度', 'Return progress') }}<select class="workbench-filter-select" :aria-label="text('退货进度筛选', 'Filter return progress')" :value="query.status || ''" :disabled="exporting" @change="navigate({ returnStatus: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option v-for="(label, status) in purchaseReturnLabels" :key="status" :value="status">{{ label[zh ? 0 : 1] }}</option></select></label><button type="button" class="workbench-button" :disabled="loading || exporting" @click="navigate({ paidAtOrder: query.paidAtOrder === 'desc' ? 'asc' : 'desc', page: 1 })">{{ query.paidAtOrder === 'desc' ? text('最新收款优先', 'Newest payment first') : text('最早收款优先', 'Oldest payment first') }}<component :is="query.paidAtOrder === 'desc' ? ArrowDown : ArrowUp" :size="13" /></button><span class="result-count">{{ text(`共 ${result?.total ?? 0} 笔订单 · ${result?.totals.returnCount ?? 0} 张退货单`, `${result?.total ?? 0} orders · ${result?.totals.returnCount ?? 0} return bills`) }}</span></div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []"><label class="select-current"><input type="checkbox" :checked="allSelected" :disabled="loading || exporting || !result?.items.length" :aria-label="text('全选本页订单', 'Select orders on this page')" @change="selectAll">{{ text('全选本页', 'Select page') }}</label><template #export><WorkbenchExportButton :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="exportRows" /></template></WorkbenchListActions>
      <p v-if="error || exportError" role="alert" class="return-message">{{ error || exportError }}</p><p v-if="copyStatus" role="status" class="return-message">{{ copyStatus }}</p>
      <PurchaseReturnOrdersTable v-if="result?.items.length" v-model:selected="selected" :rows="result.items" :disabled="loading || exporting" :paid-at-order="query.paidAtOrder || 'asc'" @copy="copy" @sort="navigate({ paidAtOrder: query.paidAtOrder === 'desc' ? 'asc' : 'desc', page: 1 })" />
      <p v-else-if="!error" class="return-empty">{{ loading ? text('正在查询…', 'Loading…') : text('暂无符合条件的采购退货订单', 'No matching fulfillment orders with purchase returns') }}</p>
      <footer v-if="result" class="return-footer"><span>{{ text(`退货 ${result.totals.quantity} 件 · 已退 ${result.totals.returnedQuantity} 件`, `${result.totals.quantity} return units · ${result.totals.returnedQuantity} sent`) }}</span><OrderAmountTotals :totals="result.totals" /><div><select class="workbench-filter-select" :aria-label="text('每页条数', 'Page size')" :value="query.pageSize" :disabled="loading || exporting" @change="navigate({ pageSize: ($event.target as HTMLSelectElement).value, page: 1 })"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }} / {{ text('页', 'page') }}</option></select><button class="workbench-button" :disabled="query.page === 1 || loading || exporting" :aria-label="text('上一页', 'Previous page')" @click="navigate({ page: query.page - 1 })"><ChevronLeft :size="14" /></button><span>{{ query.page }} / {{ pages }}</span><button class="workbench-button" :disabled="query.page >= pages || loading || exporting" :aria-label="text('下一页', 'Next page')" @click="navigate({ page: query.page + 1 })"><ChevronRight :size="14" /></button></div></footer>
    </div>
  </section>
</template>
<style scoped>
.purchase-returns{color:var(--color-text)}.return-panel{container:order-list/inline-size;background:var(--color-surface);border:1px solid var(--color-border);border-radius:9px;overflow:hidden;min-width:0;max-width:100%}.return-refresh{display:flex;align-items:center;gap:12px}.return-refresh small{font-size:11px;line-height:1.7;color:var(--color-text-secondary)}.return-message{padding:12px 20px;color:var(--color-text-secondary);font-size:12px}.select-current{display:flex;align-items:center;gap:8px}.return-empty{padding:65px 20px;text-align:center;color:var(--color-text-secondary);font-size:13px}.return-footer{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;padding:16px 20px;font-size:12px;color:var(--color-text-secondary)}.return-footer>div{display:flex;align-items:center;gap:10px}
</style>

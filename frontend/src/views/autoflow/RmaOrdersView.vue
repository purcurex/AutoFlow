<script setup lang="ts">
import { isUncollectedPage } from '@/utils/workbench-data'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { getRmaOrders, exportRmaOrders, hasRmaTypeConflict, rmaTypeLabels, type RmaQuery, type RmaType, type RmaPage } from '@/api/rma-orders'
import { fopAccessError } from '@/api/fop-access'
import { fopExportError } from '@/api/fop-order-export'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { downloadBlob } from '@/utils/export'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import WorkbenchTaskHeading from '@/components/autoflow/WorkbenchTaskHeading.vue'
import WorkbenchListActions from '@/components/autoflow/WorkbenchListActions.vue'
import WorkbenchExportButton from '@/components/autoflow/WorkbenchExportButton.vue'
import RmaOrdersTable from '@/components/autoflow/RmaOrdersTable.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh')), text = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const result = ref<RmaPage>(), loading = ref(false), error = ref(''), exporting = ref(false), exportError = ref(''), copyStatus = ref(''), selected = ref<string[]>([]), search = ref(scalar('search'))
const unavailable = computed(() => isUncollectedPage(result.value))
const query = computed<RmaQuery>(() => ({ type: Object.hasOwn(rmaTypeLabels, scalar('rmaType')) ? scalar('rmaType') as RmaType : undefined, flowStatus: scalar('flowStatus') === 'closed' || scalar('flowStatus') === 'all' ? scalar('flowStatus') as 'closed' | 'all' : 'active', search: scalar('search') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, warehouseCode: ['HZ', 'SZ'].includes(scalar('warehouseCode')) ? scalar('warehouseCode') as 'HZ' | 'SZ' : undefined, page: Math.max(1, Math.floor(Number(scalar('page')) || 1)), pageSize: [20, 50, 100].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 50 }))
const { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(row => [row.id, row.name]))))
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize))), allSelected = computed(() => !!result.value?.items.length && result.value.items.every(row => selected.value.includes(row.id)))
const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—'
let ticket = 0, exportTicket = 0, disposed = false, controller: AbortController | undefined, exportController: AbortController | undefined
async function navigate(changes: Record<string, string | number | undefined>) { await router.replace({ query: { ...route.query, ...changes } }) }
function reloadReplica() { ++exportTicket; exportController?.abort(); exporting.value = false; selected.value = []; exportError.value = ''; copyStatus.value = ''; void load() }
async function load() {
  if (exporting.value) return
  if (['interception', 'cancellation', 'interception_release'].includes(scalar('rmaType'))) { await navigate({ rmaType: undefined, page: 1 }); if (disposed) return }
  controller?.abort(); controller = new AbortController()
  const id = ++ticket, session = captureSession(); loading.value = true; error.value = ''
  try {
    const page = await getRmaOrders(query.value, controller.signal)
    if (disposed || id !== ticket || !isCurrentSession(session)) return
    if (page.items.some(row => hasRmaTypeConflict(row.rmaCases))) throw { code: 'rma_type_conflict' }
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
    const blob = await exportRmaOrders(query.value, mode, [...selected.value], exportController.signal)
    if (!disposed && id === exportTicket && isCurrentSession(session) && fingerprint === JSON.stringify(query.value)) downloadBlob(blob, 'rma-orders.xlsx')
  } catch (cause) { if (!disposed && id === exportTicket && isCurrentSession(session) && fingerprint === JSON.stringify(query.value)) exportError.value = fopExportError(cause, zh.value) }
  finally { if (!disposed && id === exportTicket) exporting.value = false }
}
async function copy(value: string) { const session = captureSession(); try { await navigator.clipboard.writeText(value); if (!disposed && isCurrentSession(session)) copyStatus.value = text('已复制', 'Copied') } catch { if (!disposed && isCurrentSession(session)) copyStatus.value = text('复制失败，请手动复制', 'Copy failed; copy manually') } }
function selectAll(event: Event) { selected.value = (event.target as HTMLInputElement).checked ? result.value?.items.map(row => row.id) ?? [] : [] }
watch(() => JSON.stringify(query.value), () => { ++exportTicket; controller?.abort(); exportController?.abort(); exporting.value = false; search.value = scalar('search'); result.value = undefined; selected.value = []; exportError.value = ''; copyStatus.value = ''; void load() }, { immediate: true })
const unregister = onSessionReset(() => { ++ticket; ++exportTicket; controller?.abort(); exportController?.abort(); result.value = undefined; selected.value = []; search.value = ''; error.value = ''; exportError.value = ''; exporting.value = false; loading.value = false; copyStatus.value = '' })
onBeforeUnmount(() => { disposed = true; ++ticket; ++exportTicket; controller?.abort(); exportController?.abort(); unregister() })
</script>
<template>
  <section class="rma-orders">
    <WorkbenchTaskHeading :data-availability="result?.dataAvailability" :replica="result?.replica" :sync-disabled="loading || exporting" @replica-synced="reloadReplica" :title="text('RMA售后清单', 'RMA after-sales')" :description="text('按售后单展示仅退款、退货退款及补发货，相关操作在 FOP 完成。', 'Track refund-only, return-refund and reshipment cases; process in FOP.')"><div class="rma-refresh"><button class="workbench-button" :disabled="loading || exporting" @click="load"><RefreshCw :size="14" />{{ text('刷新', 'Refresh') }}</button><small>{{ text('手动刷新', 'Manual refresh') }}<br>{{ text('最近查询', 'Last queried') }} {{ result ? date(result.refreshedAt) + ' · UTC+8' : '—' }}</small></div></WorkbenchTaskHeading>
    <div class="rma-panel">
      <form class="workbench-filter-toolbar" @submit.prevent="navigate({ search: search.trim() || undefined, page: 1 })"><div class="workbench-filter-main">
        <div class="workbench-filter-search"><label class="workbench-search-field"><Search :size="15" /><input v-model="search" :aria-label="text('搜索RMA售后', 'Search RMA')" :placeholder="text('订单 / 售后单 / 客户 / 业务员 / SKU / 原因', 'Order / RMA / customer / salesperson / SKU / reason')" @input="!search && navigate({ search: undefined, page: 1 })"></label><button type="submit" class="workbench-button workbench-primary" :disabled="exporting">{{ text('查询', 'Search') }}</button></div>
        <label>{{ text('业务部门', 'Department') }}<select class="workbench-filter-select" :value="query.departmentId || ''" :disabled="exporting" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, ownerId: undefined, page: 1 })"><option :value="defaultDepartmentValue(result?.departments, query.departmentId)">{{ defaultDepartmentLabel }}</option><option v-for="row in departmentOptions(result?.departments)" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
        <label>{{ text('发货仓库', 'Shipping warehouse') }}<select class="workbench-filter-select" :value="query.warehouseCode || ''" :disabled="exporting" @change="navigate({ warehouseCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ text('杭州仓', 'Hangzhou') }}</option><option value="SZ">{{ text('深圳仓', 'Shenzhen') }}</option></select></label></div>
        <div class="workbench-filter-secondary"><label>{{ text('售后类型', 'RMA type') }}<select class="workbench-filter-select" :aria-label="text('售后类型筛选', 'Filter RMA type')" :value="query.type || ''" :disabled="exporting" @change="navigate({ rmaType: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option v-for="(label, type) in rmaTypeLabels" :key="type" :value="type">{{ label[zh ? 0 : 1] }}</option></select></label>
        <label>{{ text('流程状态', 'Flow status') }}<select class="workbench-filter-select" :aria-label="text('售后流程状态筛选', 'Filter RMA flow status')" :value="query.flowStatus" :disabled="exporting" @change="navigate({ flowStatus: ($event.target as HTMLSelectElement).value, page: 1 })"><option value="active">{{ text('进行中', 'Active') }}</option><option value="closed">{{ text('已结束', 'Closed') }}</option><option value="all">{{ text('全部', 'All') }}</option></select></label><span v-if="result" class="result-count">{{ unavailable ? text('— · 待接入', '— · Not connected') : text(`共 ${result?.total ?? 0} 张售后单`, `${result?.total ?? 0} RMA cases`) }}</span></div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []"><label class="rma-select-current"><input type="checkbox" :checked="allSelected" :disabled="loading || exporting || !result?.items.length" :aria-label="text('全选本页售后单', 'Select RMA cases on this page')" @change="selectAll">{{ text('全选本页', 'Select page') }}</label><template #export><WorkbenchExportButton record-kind="rma" :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="exportRows" /></template></WorkbenchListActions>
      <p v-if="error || exportError" role="alert" class="rma-message">{{ error || exportError }}</p><p v-if="copyStatus" role="status" class="rma-message">{{ copyStatus }}</p>
      <RmaOrdersTable v-if="result?.items.length" v-model:selected="selected" :rows="result.items" :disabled="loading || exporting" @copy="copy" />
      <p v-else-if="!error" class="rma-empty">{{ loading ? text('正在查询…', 'Loading…') : unavailable ? text('售后数据尚未接入', 'After-sales data is not connected') : text('暂无符合条件的售后订单', 'No matching after-sales orders') }}</p>
      <footer v-if="result" class="rma-footer"><div>{{ text('订单金额', 'Order amount') }} <span v-if="result.total && !result.totals.amountsByCurrency.length">{{ text('币种未提供', 'Currency unavailable') }}</span><OrderAmountTotals v-else :totals="result.totals" /></div><div><select class="workbench-filter-select" :aria-label="text('每页条数', 'Page size')" :value="query.pageSize" :disabled="loading || exporting" @change="navigate({ pageSize: ($event.target as HTMLSelectElement).value, page: 1 })"><option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }} / {{ text('页', 'page') }}</option></select><button class="workbench-button" :disabled="query.page === 1 || loading || exporting" :aria-label="text('上一页', 'Previous page')" @click="navigate({ page: query.page - 1 })"><ChevronLeft :size="14" /></button><span>{{ query.page }} / {{ pages }}</span><button class="workbench-button" :disabled="query.page >= pages || loading || exporting" :aria-label="text('下一页', 'Next page')" @click="navigate({ page: query.page + 1 })"><ChevronRight :size="14" /></button></div></footer>
    </div>
  </section>
</template>
<style scoped>
.rma-orders{color:var(--color-text)}.rma-panel{container:rma-list/inline-size;min-width:0;max-width:100%;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;overflow:hidden}.rma-refresh{display:flex;align-items:center;gap:12px}.rma-refresh small{font-size:11px;line-height:1.7;color:var(--color-text-secondary)}.rma-message{padding:12px 20px;color:var(--color-text-secondary);font-size:12px}.rma-select-current{display:flex;align-items:center;gap:8px}.rma-empty{padding:65px 20px;text-align:center;color:var(--color-text-secondary);font-size:13px}.rma-footer{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;padding:16px 20px;font-size:12px;color:var(--color-text-secondary)}.rma-footer>div{display:flex;align-items:center;gap:10px}
</style>

<script setup lang="ts">
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import { useProductExpansion } from '@/composables/useProductExpansion'
import ProductExpansionButton from '@/components/autoflow/ProductExpansionButton.vue'
import { isUncollectedPage } from '@/utils/workbench-data'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Search, } from 'lucide-vue-next'
import { getRmaOrders, exportRmaOrders, hasRmaTypeConflict, rmaTypeLabels, type RmaQuery, type RmaType, type RmaPage } from '@/api/rma-orders'
import { fopAccessError } from '@/api/fop-access'
import { fopExportError } from '@/api/fop-order-export'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { downloadBlob } from '@/utils/export'
import { useWorkbenchDepartment } from '@/composables/useWorkbenchDepartment'
import WorkbenchRefreshControl from '@/components/autoflow/WorkbenchRefreshControl.vue'
import WorkbenchTableState from '@/components/autoflow/WorkbenchTableState.vue'
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
const query = computed<RmaQuery>(() => ({ type: Object.hasOwn(rmaTypeLabels, scalar('rmaType')) ? scalar('rmaType') as RmaType : undefined, flowStatus: scalar('flowStatus') === 'closed' || scalar('flowStatus') === 'all' ? scalar('flowStatus') as 'closed' | 'all' : 'active', search: scalar('search') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, warehouseCode: ['HZ', 'SZ'].includes(scalar('warehouseCode')) ? scalar('warehouseCode') as 'HZ' | 'SZ' : undefined, page: Math.max(1, Math.floor(Number(scalar('page')) || 1)), pageSize: [20, 50, 100, 200, 500, 1000].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 100 }))
const { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(row => [row.id, row.name]))))
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize)))
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
watch(() => JSON.stringify(query.value), () => { ++exportTicket; controller?.abort(); exportController?.abort(); exporting.value = false; search.value = scalar('search'); selected.value = []; exportError.value = ''; copyStatus.value = ''; void load() }, { immediate: true })
const unregister = onSessionReset(() => { ++ticket; ++exportTicket; controller?.abort(); exportController?.abort(); result.value = undefined; selected.value = []; search.value = ''; error.value = ''; exportError.value = ''; exporting.value = false; loading.value = false; copyStatus.value = '' })
onBeforeUnmount(() => { disposed = true; ++ticket; ++exportTicket; controller?.abort(); exportController?.abort(); unregister() })
const { expandedProductIds, hasExpandableProducts, allProductsExpanded, setProductExpanded, toggleAllProducts } = useProductExpansion(() => result.value?.items ?? [], row => row.items)
</script>
<template>
  <section class="rma-orders">
    <WorkbenchTaskHeading :data-availability="result?.dataAvailability" :replica="result?.replica" :sync-disabled="loading || exporting" @replica-synced="reloadReplica" :title="text('RMA售后清单', 'RMA after-sales')" :description="text('按售后单展示仅退款、退货退款及补发货，相关操作在 FOP 完成。', 'Track refund-only, return-refund and reshipment cases; process in FOP.')"></WorkbenchTaskHeading>
    <div class="rma-panel">
      <form class="workbench-filter-toolbar" @submit.prevent="navigate({ search: search.trim() || undefined, page: 1 })">
          <div class="workbench-inline-actions"><WorkbenchRefreshControl :busy="loading" :disabled="loading || exporting" :refreshed-at="result?.refreshedAt" @refresh="load" /></div><div class="workbench-filter-main">
        <div class="workbench-filter-search"><label class="workbench-search-field"><Search :size="15" /><input v-model="search" :aria-label="text('搜索RMA售后', 'Search RMA')" :placeholder="text('订单 / 售后单 / 客户 / 业务员 / SKU / 原因', 'Order / RMA / customer / salesperson / SKU / reason')" @input="!search && navigate({ search: undefined, page: 1 })"></label><button type="submit" class="workbench-button workbench-primary" :disabled="exporting">{{ text('查询', 'Search') }}</button></div>

          <label>{{ text('售后类型', 'RMA type') }}<select class="workbench-filter-select" :aria-label="text('售后类型筛选', 'Filter RMA type')" :value="query.type || ''" :disabled="exporting" @change="navigate({ rmaType: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option v-for="(label, type) in rmaTypeLabels" :key="type" :value="type">{{ label[zh ? 0 : 1] }}</option></select></label>
          <label>{{ text('流程状态', 'Flow status') }}<select class="workbench-filter-select" :aria-label="text('售后流程状态筛选', 'Filter RMA flow status')" :value="query.flowStatus" :disabled="exporting" @change="navigate({ flowStatus: ($event.target as HTMLSelectElement).value, page: 1 })"><option value="active">{{ text('进行中', 'Active') }}</option><option value="closed">{{ text('已结束', 'Closed') }}</option><option value="all">{{ text('全部', 'All') }}</option></select></label>
          <label>{{ text('业务部门', 'Department') }}<select class="workbench-filter-select" :value="query.departmentId || ''" :disabled="exporting" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, ownerId: undefined, page: 1 })"><option :value="defaultDepartmentValue(result?.departments, query.departmentId)">{{ defaultDepartmentLabel }}</option><option v-for="row in departmentOptions(result?.departments)" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
          <label>{{ text('发货仓库', 'Shipping warehouse') }}<select class="workbench-filter-select" :value="query.warehouseCode || ''" :disabled="exporting" @change="navigate({ warehouseCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ 'HangZhou' }}</option><option value="SZ">{{ 'ShenZhen' }}</option></select></label>
        <div class="workbench-filter-export"><WorkbenchExportButton record-kind="rma" :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="exportRows" /></div></div>
        <div class="workbench-filter-secondary">
        <span class="result-count">{{ !result || unavailable ? '—' : text(`共 ${result?.total ?? 0} 张售后单`, `${result?.total ?? 0} RMA cases`) }}</span></div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []"><ProductExpansionButton :expanded="allProductsExpanded" :disabled="loading || exporting || !hasExpandableProducts" @toggle="toggleAllProducts" /><template #pagination><WorkbenchPagination :page="query.page" :page-size="query.pageSize" :pages="pages" :disabled="loading || exporting || !result" @page="navigate({ page: $event })" @page-size="navigate({ pageSize: $event, page: 1 })" /></template></WorkbenchListActions>
      <p v-if="exportError" role="alert" class="rma-message workbench-feedback">{{ exportError }}</p><p v-if="copyStatus" role="status" class="rma-message workbench-feedback">{{ copyStatus }}</p>
      <RmaOrdersTable :expanded-product-ids="expandedProductIds" @product-expanded="setProductExpanded" v-model:selected="selected" :rows="error ? [] : result?.items ?? []" :disabled="loading || exporting" @copy="copy">
        <template #empty><WorkbenchTableState v-if="error || !result?.items.length" :columns="11" :loading="loading" :error="error" :message="unavailable ? '' : text('暂无符合条件的售后订单', 'No matching after-sales orders')" /></template>
      </RmaOrdersTable>
      <footer v-if="result" class="rma-footer"><div><small v-if="result.dataAvailability?.coverage === 'partial_customer_scan'">{{ text('当前已采集', 'Captured records') }}</small>{{ text('订单金额', 'Order amount') }} <span v-if="result.total && !result.totals.amountsByCurrency.length">{{ '—' }}</span><OrderAmountTotals v-else :totals="result.totals" /><span>{{ text(`售后商品 ${result.totals.itemQuantity ?? '—'} 件`, `RMA products: ${result.totals.itemQuantity ?? '—'} units`) }}</span></div></footer>
    </div>
  </section>
</template>
<style scoped>
.rma-orders{color:var(--color-text)}.rma-panel{container:rma-list/inline-size;min-width:0;max-width:100%;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;overflow:hidden}.rma-message{padding:12px 20px;color:var(--color-text-secondary);font-size:12px}.rma-footer{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;padding:16px 20px;font-size:12px;color:var(--color-text-secondary)}.rma-footer>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.rma-footer small{color:var(--color-text-secondary)}
</style>

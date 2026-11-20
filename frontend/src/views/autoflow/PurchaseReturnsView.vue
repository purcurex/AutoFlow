<script setup lang="ts">
import WorkbenchPagination from '@/components/autoflow/WorkbenchPagination.vue'
import { useProductExpansion } from '@/composables/useProductExpansion'
import ProductExpansionButton from '@/components/autoflow/ProductExpansionButton.vue'
import { isUncollectedPage } from '@/utils/workbench-data'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Search, ArrowUp, ArrowDown } from 'lucide-vue-next'
import { getPurchaseReturns, exportPurchaseReturns, purchaseReturnLabels, type PurchaseReturnStatus, type PurchaseReturnPage, type PurchaseReturnQuery, type PurchaseReturnOrder } from '@/api/purchase-returns'
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
import SupplierFollowUpDialog from '@/components/autoflow/SupplierFollowUpDialog.vue'
import PurchaseReturnOrdersTable from '@/components/autoflow/PurchaseReturnOrdersTable.vue'
import OrderAmountTotals from '@/components/ui/OrderAmountTotals.vue'
const emit = defineEmits<{ 'filter-labels': [rows: { id: string; name: string }[]] }>()
const route = useRoute(), router = useRouter(), { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh')), text = (cn: string, en: string) => zh.value ? cn : en
const scalar = (key: string) => typeof route.query[key] === 'string' ? route.query[key] as string : ''
const contact = ref<{ orderId: string; orderNumber: string; returnId: string; purchaseOrderId: string }>()
function contactSupplier(order: PurchaseReturnOrder, returnId: string, purchaseOrderId: string) { contact.value = { orderId: order.id, orderNumber: order.orderNumber, returnId, purchaseOrderId } }
const result = ref<PurchaseReturnPage>(), loading = ref(false), error = ref(''), exporting = ref(false), exportError = ref(''), copyStatus = ref(''), selected = ref<string[]>([]), search = ref(scalar('search'))
const unavailable = computed(() => isUncollectedPage(result.value))
const query = computed<PurchaseReturnQuery>(() => ({ paidAtOrder: scalar('paidAtOrder') === 'asc' ? 'asc' : 'desc', workbenchRole: route.params.role === 'warehouse' ? 'warehouse' : 'procurement', search: scalar('search') || undefined, departmentId: scalar('departmentId') || undefined, ownerId: scalar('ownerId') || undefined, warehouseCode: ['HZ', 'SZ'].includes(scalar('warehouseCode')) ? scalar('warehouseCode') as 'HZ' | 'SZ' : undefined, status: Object.hasOwn(purchaseReturnLabels, scalar('returnStatus')) ? scalar('returnStatus') as PurchaseReturnStatus : undefined, page: Math.max(1, Math.floor(Number(scalar('page')) || 1)), pageSize: [20, 50, 100, 200, 500, 1000].includes(Number(scalar('pageSize'))) ? Number(scalar('pageSize')) : 100 }))
const { defaultDepartmentLabel, departmentOptions, defaultDepartmentValue } = useWorkbenchDepartment(computed(() => Object.fromEntries((result.value?.departments ?? []).map(row => [row.id, row.name]))))
const pages = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / query.value.pageSize)))
let ticket = 0, exportTicket = 0, disposed = false, controller: AbortController | undefined, exportController: AbortController | undefined
async function navigate(changes: Record<string, string | number | undefined>) { await router.replace({ query: { ...route.query, ...changes } }) }
function reloadReplica() { ++exportTicket; exportController?.abort(); exporting.value = false; selected.value = []; exportError.value = ''; copyStatus.value = ''; void load() }
async function load() {
  if (exporting.value) return
  contact.value = undefined
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
watch(() => JSON.stringify(query.value), () => { contact.value = undefined; ++exportTicket; controller?.abort(); exportController?.abort(); exporting.value = false; search.value = scalar('search'); selected.value = []; exportError.value = ''; copyStatus.value = ''; void load() }, { immediate: true })
const unregister = onSessionReset(() => { contact.value = undefined; ++ticket; ++exportTicket; controller?.abort(); exportController?.abort(); result.value = undefined; selected.value = []; search.value = ''; error.value = ''; exportError.value = ''; exporting.value = false; loading.value = false; copyStatus.value = '' })
onBeforeUnmount(() => { disposed = true; ++ticket; controller?.abort(); exportController?.abort(); unregister() })
const { expandedProductIds, hasExpandableProducts, allProductsExpanded, setProductExpanded, toggleAllProducts } = useProductExpansion(() => result.value?.items ?? [], row => row.items)
</script>

<template>
  <section class="purchase-returns">
    <WorkbenchTaskHeading :data-availability="result?.dataAvailability" :replica="result?.replica" :sync-disabled="loading || exporting" @replica-synced="reloadReplica" :title="text('采购退货清单', 'Purchase returns')" :description="text('按履约订单跟进采购退货，关联退货单及物流信息，相关操作在 FOP 完成。', 'Track purchase returns by fulfillment order; process returns in FOP.')"></WorkbenchTaskHeading>
    <div class="return-panel">
      <form class="workbench-filter-toolbar" @submit.prevent="navigate({ search: search.trim() || undefined, page: 1 })">
          <div class="workbench-inline-actions"><WorkbenchRefreshControl :busy="loading" :disabled="loading || exporting" :refreshed-at="result?.refreshedAt" @refresh="load" /></div>
        <div class="workbench-filter-main">
          <div class="workbench-filter-search"><label class="workbench-search-field"><Search :size="15" /><input v-model="search" :aria-label="text('搜索采购退货', 'Search purchase returns')" :placeholder="text('退货单 / 采购单 / 供应商 / 关联订单 / SKU', 'Return / purchase / supplier / order / SKU')" @input="!search && navigate({ search: undefined, page: 1 })"></label><button type="submit" class="workbench-button workbench-primary" :disabled="exporting">{{ text('查询', 'Search') }}</button></div>

          <label>{{ text('退货进度', 'Return progress') }}<select class="workbench-filter-select" :aria-label="text('退货进度筛选', 'Filter return progress')" :value="query.status || ''" :disabled="exporting" @change="navigate({ returnStatus: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option v-for="(label, status) in purchaseReturnLabels" :key="status" :value="status">{{ label[zh ? 0 : 1] }}</option></select></label>
          <label>{{ text('业务部门', 'Department') }}<select class="workbench-filter-select" :value="query.departmentId || ''" :disabled="exporting" @change="navigate({ departmentId: ($event.target as HTMLSelectElement).value || undefined, ownerId: undefined, page: 1 })"><option :value="defaultDepartmentValue(result?.departments, query.departmentId)">{{ defaultDepartmentLabel }}</option><option v-for="department in departmentOptions(result?.departments)" :key="department.id" :value="department.id">{{ department.name }}</option></select></label>
          <label>{{ text('出库仓库', 'Outbound warehouse') }}<select class="workbench-filter-select" :value="query.warehouseCode || ''" :disabled="exporting" @change="navigate({ warehouseCode: ($event.target as HTMLSelectElement).value || undefined, page: 1 })"><option value="">{{ text('全部', 'All') }}</option><option value="HZ">{{ 'HangZhou' }}</option><option value="SZ">{{ 'ShenZhen' }}</option></select></label>
        <div class="workbench-filter-export"><WorkbenchExportButton :selected-count="selected.length" :total="result?.total ?? 0" :disabled="loading" :busy="exporting" @export="exportRows" /></div></div>
        <div class="workbench-filter-secondary"><button type="button" class="workbench-button" :disabled="loading || exporting" @click="navigate({ paidAtOrder: query.paidAtOrder === 'desc' ? 'asc' : 'desc', page: 1 })">{{ query.paidAtOrder === 'desc' ? text('最新客户付款优先', 'Newest customer payment first') : text('最早客户付款优先', 'Oldest customer payment first') }}<component :is="query.paidAtOrder === 'desc' ? ArrowDown : ArrowUp" :size="13" /></button><span class="result-count">{{ !result || unavailable ? '—' : text(`共 ${result?.total ?? 0} 笔订单 · ${result?.totals.returnCount ?? 0} 张退货单`, `${result?.total ?? 0} orders · ${result?.totals.returnCount ?? 0} return bills`) }}</span></div>
      </form>
      <WorkbenchListActions :selected-count="selected.length" @clear="selected = []"><ProductExpansionButton :expanded="allProductsExpanded" :disabled="loading || exporting || !hasExpandableProducts" @toggle="toggleAllProducts" /><template #pagination><WorkbenchPagination :page="query.page" :page-size="query.pageSize" :pages="pages" :disabled="loading || exporting || !result" @page="navigate({ page: $event })" @page-size="navigate({ pageSize: $event, page: 1 })" /></template></WorkbenchListActions>
      <p v-if="exportError" role="alert" class="return-message workbench-feedback">{{ exportError }}</p><p v-if="copyStatus" role="status" class="return-message workbench-feedback">{{ copyStatus }}</p>
      <PurchaseReturnOrdersTable :expanded-product-ids="expandedProductIds" @product-expanded="setProductExpanded" v-model:selected="selected" :rows="error ? [] : result?.items ?? []" @contact="contactSupplier" :disabled="loading || exporting" :paid-at-order="query.paidAtOrder || 'desc'" @copy="copy" @sort="navigate({ paidAtOrder: query.paidAtOrder === 'desc' ? 'asc' : 'desc', page: 1 })">
        <template #empty><WorkbenchTableState v-if="error || !result?.items.length" :columns="12" :loading="loading" :error="error" :message="unavailable ? '' : text('暂无符合条件的采购退货订单', 'No matching fulfillment orders with purchase returns')" /></template>
      </PurchaseReturnOrdersTable>
      <footer v-if="result" class="return-footer"><span>{{ text(`退货 ${unavailable ? '—' : result.totals.quantity ?? '—'} 件 · 已退 ${unavailable ? '—' : result.totals.returnedQuantity ?? '—'} 件`, `${unavailable ? '—' : result.totals.quantity ?? '—'} return units · ${unavailable ? '—' : result.totals.returnedQuantity ?? '—'} sent`) }}</span><OrderAmountTotals :totals="result.totals" /></footer>
    </div>
    <SupplierFollowUpDialog v-if="contact" :key="`${contact.orderId}:${contact.returnId}`" :order-id="contact.orderId" :order-number="contact.orderNumber" :purchase-order-id="contact.purchaseOrderId" :return-context="{ returnId: contact.returnId, workbenchRole: query.workbenchRole }" @close="contact = undefined" />
  </section>
</template>
<style scoped>
.purchase-returns{color:var(--color-text)}.return-panel{container:order-list/inline-size;background:var(--color-surface);border:1px solid var(--color-border);border-radius:9px;overflow:hidden;min-width:0;max-width:100%}.return-message{padding:12px 20px;color:var(--color-text-secondary);font-size:12px}.return-footer{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;padding:16px 20px;font-size:12px;color:var(--color-text-secondary)}.return-footer>div{display:flex;align-items:center;gap:10px}
</style>

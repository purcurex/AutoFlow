<script setup lang="ts">
import WorkbenchAnalytics from '@/components/charts/WorkbenchAnalytics.vue'
import { completedNames } from '@/utils/completed-orders'
import { computed, provide, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { BriefcaseBusiness, Boxes, PackageCheck, Send, Warehouse } from 'lucide-vue-next'
import { AppLayout } from '@/components/layout'
import FopOrdersView from './FopOrdersView.vue'
import OrderProgressView from './OrderProgressView.vue'
import StockOrdersView from './StockOrdersView.vue'
import ReceiptNoticesView from './ReceiptNoticesView.vue'
import PurchaseReturnsView from './PurchaseReturnsView.vue'
import RmaOrdersView from './RmaOrdersView.vue'
import ProcurementOrdersView from './ProcurementOrdersView.vue'
import { provideWorkbenchReplica } from '@/composables/workbenchReplicaContext'
import { workbenchRefreshTarget } from '@/composables/workbenchRefreshTarget'
import { useWorkbenchListScroll, workbenchListScrollKey } from '@/composables/useWorkbenchListScroll'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { sessionEpoch } from '@/utils/session'
import { defaultWorkbenchQueue, isWorkbenchRole, queueNames, workbenchNames, workbenchQueues, type WorkbenchRole } from '@/utils/workbench'

provideWorkbenchReplica()
const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const { roles, isAdmin, access: workbenchAccess } = useWorkbenchAccess()
// Older backends omit the display hint; all data endpoints still enforce access.
const chartVisible = (id: import('@/api/fop-chart-access').ChartId) => isAdmin.value && (workbenchAccess?.value?.chartVisibility === undefined || workbenchAccess.value.chartVisibility[id] === true)
const analyticsAllowed = computed(() => {
  const page = choice.value
  if (page === 'performance') return chartVisible('sales_performance')
  if (page === 'receipts') return chartVisible('salesperson_receipts')
  return true
})
const listRoot = ref<HTMLElement | null>(null)
const refreshTarget = ref<HTMLElement | null>(null)
provide(workbenchRefreshTarget, refreshTarget)
provide(workbenchListScrollKey, useWorkbenchListScroll(listRoot))
const dataRevision = ref(0)

// User input only; survives the guard's child unmount without retaining business records.
const searchRecovery = ref<{ token: symbol; from: string; to: string; search: string }>()
function clearSearchRecovery(token: symbol) { if (searchRecovery.value?.token === token) searchRecovery.value = undefined }
async function recoverOrderPage(recovery: NonNullable<typeof searchRecovery.value>) {
  searchRecovery.value = recovery
  try {
    const failure = await router.replace(recovery.to)
    if (failure) clearSearchRecovery(recovery.token)
  } catch (cause) {
    clearSearchRecovery(recovery.token)
    throw cause
  }
}
watch(sessionEpoch, () => { searchRecovery.value = undefined })
watch(() => route.fullPath, path => {
  if (searchRecovery.value && path !== searchRecovery.value.from && path !== searchRecovery.value.to) searchRecovery.value = undefined
})
const role = computed(() => route.name === 'Dashboard' ? 'sales' : isWorkbenchRole(route.params.role) ? route.params.role : undefined)
const allowed = computed(() => role.value && roles.value.includes(role.value))
const choice = computed(() => route.name === 'RoleWorkbenchReceipts' ? 'receipts' : route.query.queue ?? (role.value ? defaultWorkbenchQueue(role.value) : undefined))
const validChoice = computed(() => role.value && (choice.value === 'completed' || choice.value === 'rma' && role.value === 'sales' || choice.value === 'purchase_returns' && ['procurement', 'warehouse'].includes(role.value) || workbenchQueues[role.value].some(queue => queue === choice.value)))
const icons = { sales: BriefcaseBusiness, procurement: Boxes, allocation: PackageCheck, dispatch: Send, warehouse: Warehouse }
const departmentQuery = computed(() => typeof route.query.departmentId === 'string' && route.query.departmentId ? { departmentId: route.query.departmentId } : {})
const todoScopeQuery = computed(() => ({ ...departmentQuery.value, ...(typeof route.query.ownerId === 'string' && route.query.ownerId ? { ownerId: route.query.ownerId } : {}) }))
function roleLink(value: WorkbenchRole) { return { name: 'RoleWorkbench', params: { role: value }, query: todoScopeQuery.value } }
function queueLink(value: string) { return { name: 'RoleWorkbench', params: { role: role.value }, query: { ...(role.value === 'procurement' && ['fulfillment', 'purchase'].includes(String(route.query.view)) ? { view: route.query.view } : {}), ...(['stock', 'stock_procurement', 'completed', 'purchase_returns', 'rma', 'receipt_notices'].includes(value) || role.value && workbenchQueues[role.value].some(queue => queue === value) ? todoScopeQuery.value : departmentQuery.value), queue: value, ...(['completed', 'unpaid', 'stock'].includes(value) ? { timeRange: '3m' } : {}) } } }
</script>

<template>
  <AppLayout compact-navigation>
    <div ref="listRoot" class="app-page role-workbench">
      <div class="workbench-navigation"><nav class="role-tabs" :aria-label="text('岗位工作台', 'Role workbenches')"><RouterLink v-for="item in roles" :key="item" :to="roleLink(item)" :class="{ active: role === item }" :aria-current="role === item ? 'page' : undefined"><component :is="icons[item]" :size="19" /><span>{{ workbenchNames[item][zh ? 0 : 1] }}</span></RouterLink></nav></div>
      <template v-if="allowed && role">
        <div class="workbench-queue-row"><nav class="workbench-queues" :aria-label="text('工作台功能', 'Workbench functions')">
          <RouterLink v-if="role === 'warehouse'" :to="queueLink('receipt_notices')" :class="{ active: choice === 'receipt_notices' }">{{ text('待入库清单', 'Pending inbound') }}</RouterLink>
          <template v-for="item in workbenchQueues[role]" :key="item">
            <RouterLink v-if="role === 'sales' && item === 'exceptions'" :to="queueLink('rma')" :class="{ active: choice === 'rma' }">{{ text('RMA售后清单', 'RMA after-sales') }}</RouterLink>
            <RouterLink :to="queueLink(item)" :class="{ active: choice === item }">{{ queueNames[item][zh ? 0 : 1] }}{{ ['procurement_shipping', 'allocation_review'].includes(item) ? '' : text('清单', item === 'exceptions' ? '' : ' orders') }}</RouterLink>
            <RouterLink v-if="role === 'sales' && item === 'review'" :to="queueLink('completed')" :class="{ active: choice === 'completed' }">{{ completedNames[role][zh ? 0 : 1] }}</RouterLink>
            <RouterLink v-if="role === 'sales' && item === 'review'" :to="queueLink('stock')" :class="{ active: choice === 'stock' }">{{ text('备货清单', 'Stock orders') }}</RouterLink>
            <RouterLink v-if="role === 'procurement' && item === 'procurement_shipping'" :to="queueLink('stock_procurement')" :class="{ active: choice === 'stock_procurement' }">{{ text('备货待采购清单', 'Stock procurement') }}</RouterLink>
          </template>
          <RouterLink v-if="role === 'procurement' || role === 'warehouse'" :to="queueLink('purchase_returns')" :class="{ active: choice === 'purchase_returns' }">{{ text('采购退货清单', 'Purchase returns') }}</RouterLink>
          <RouterLink v-if="role !== 'sales'" :to="queueLink('completed')" :class="{ active: choice === 'completed' }">{{ completedNames[role][zh ? 0 : 1] }}</RouterLink>
          <!-- Analytics implementation and its permission checks remain available; navigation is hidden for all accounts. -->
          <RouterLink v-if="role === 'sales'" :to="queueLink('progress')" :class="{ active: choice === 'progress' }">{{ text('履约进度查询', 'Order progress') }}</RouterLink>
        </nav><div ref="refreshTarget" class="workbench-queue-refresh" /></div>
        <div v-if="!analyticsAllowed" class="access-message" role="alert">{{ text('暂无此功能权限，请选择其他工作台功能。', 'This feature is not available for your account.') }}</div>
        <WorkbenchAnalytics v-else-if="['performance','receipts'].includes(String(choice))" :key="String(choice)" :page="String(choice)" />
        <OrderProgressView v-else-if="choice === 'progress' && role === 'sales'" />
        <StockOrdersView v-else-if="choice === 'stock' && role === 'sales' || choice === 'stock_procurement' && role === 'procurement'" :key="`${dataRevision}-${choice}`" :procurement="role === 'procurement'" />
        <RmaOrdersView v-else-if="choice === 'rma' && role === 'sales'" :key="dataRevision" />
        <ReceiptNoticesView v-else-if="choice === 'receipt_notices' && role === 'warehouse'" :key="dataRevision" />
        <PurchaseReturnsView v-else-if="choice === 'purchase_returns' && (role === 'procurement' || role === 'warehouse')" :key="`${role}-${dataRevision}`" />
        <ProcurementOrdersView :key="dataRevision" :search-recovery="searchRecovery" :recover-page="recoverOrderPage" @clear-search-recovery="clearSearchRecovery" v-else-if="validChoice && role === 'procurement' && (choice === 'procurement' || choice === 'procurement_shipping' || choice === 'completed')" />
        <FopOrdersView v-else-if="validChoice" :key="dataRevision" :search-recovery="searchRecovery" :recover-page="recoverOrderPage" @clear-search-recovery="clearSearchRecovery" />
        <div v-else class="access-message" role="alert">{{ text('该清单不属于当前工作台，请选择上方功能。', 'This list does not belong to the selected workbench. Choose a function above.') }}</div>
      </template>
      <div v-else class="access-message" role="alert">{{ text('暂时无法访问此工作台，请联系管理员分配岗位。', 'You do not have access to this workbench. Contact an administrator.') }}</div>
    </div>
  </AppLayout>
</template>

<style scoped>
.role-workbench { color: var(--color-text); }.workbench-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .16em; color: #8490a3; margin-bottom: 7px; }.workbench-heading h1 { font-size: 28px; font-weight: 750; letter-spacing: -.03em; }.workbench-heading p:last-child { margin-top: 7px; font-size: 12px; line-height: 1.7; color: #8490a3; }.dashboard-link { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 9px 13px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; }
.workbench-heading-actions { display:flex; align-items:center; justify-content:flex-end; gap:16px; flex-wrap:wrap; min-width:0; }.workbench-heading-actions .dashboard-link { flex-shrink:0; }
.workbench-navigation { display:flex; align-items:center; gap:24px; margin-bottom:22px; }.workbench-navigation .role-tabs { flex:1; min-width:0; margin-bottom:0; }
.role-tabs { display: flex; gap: 10px; margin-bottom: 22px; overflow-x: auto; padding-bottom: 2px; }.role-tabs a { display: flex; flex: 1; min-width: 130px; max-width: 230px; align-items: center; gap: 11px; padding: 17px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: #8490a3; font-size: 13px; font-weight: 600; }.role-tabs a.active { color:var(--color-on-primary); background: var(--color-primary-strong); border-color: var(--color-primary-strong); box-shadow: 0 5px 15px #4f67bf20; }.workbench-filter-summary + .workbench-queues { margin-top: 24px; }.workbench-queues { display: flex; gap: 24px; border-bottom: 1px solid var(--color-border); margin-bottom: 22px; overflow-x: auto; }.workbench-queues a { white-space: nowrap; color: #8490a3; font-size: 13px; padding: 0 2px 12px; border-bottom: 2px solid transparent; }.workbench-queues a.active { color: var(--color-link); font-weight: 700; border-color: var(--color-primary); }.access-message { padding: 70px 20px; text-align: center; color: #8490a3; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; }@media (max-width: 700px) { .workbench-heading { align-items: flex-start; flex-wrap:wrap; }.workbench-heading-actions { justify-content:flex-start; width:100%; }.workbench-navigation { flex-wrap:wrap; gap:12px; }.workbench-navigation .role-tabs { flex-basis:100%; }.workbench-navigation :deep(.workbench-replica-controls) { margin-left:auto; }.workbench-heading h1 { font-size: 24px; }.role-tabs a { min-width: 140px; padding: 14px; } }

.dark .role-tabs a { color: #afbdd2; background: var(--color-surface); }
.dark .role-tabs a.active { color:var(--color-on-primary);background:var(--color-primary);border-color:var(--color-primary) }
.dark .workbench-queues a { color: #a3b1c5; }
.dark .workbench-queues a.active { color:var(--color-link);border-color:var(--color-primary) }
@media (min-width: 768px) and (max-width: 1600px) { .role-workbench { padding-inline: 16px; } }
</style>

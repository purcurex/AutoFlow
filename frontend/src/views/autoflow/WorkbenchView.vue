<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, BriefcaseBusiness, Boxes, PackageCheck, Send, Warehouse } from 'lucide-vue-next'
import { AppLayout } from '@/components/layout'
import SalesOverview from './DashboardView.vue'
import OrderVolumeOrdersView from './OrderVolumeOrdersView.vue'
import OrderVolumeAnalysis from '@/components/order-volume/OrderVolumeAnalysis.vue'
import FopReceiptsView from './FopReceiptsView.vue'
import FopFreightView from './FopFreightView.vue'
import SalesPerformanceView from './SalesPerformanceView.vue'
import FopOrdersView from './FopOrdersView.vue'
import StockOrdersView from './StockOrdersView.vue'
import WorkbenchFilterSummary from '@/components/WorkbenchFilterSummary.vue'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { sessionEpoch } from '@/utils/session'
import { defaultWorkbenchQueue, isWorkbenchRole, queueNames, workbenchNames, workbenchQueues, type WorkbenchRole } from '@/utils/workbench'

const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const { roles, access: workbenchAccess } = useWorkbenchAccess()
// Older backends omit the display hint; all data endpoints still enforce access.
const chartVisible = (id: import('@/api/fop-chart-access').ChartId) => workbenchAccess?.value?.chartVisibility === undefined || workbenchAccess.value.chartVisibility[id] === true
const analyticsAllowed = computed(() => {
  const page = choice.value
  if (page === 'performance' || page === 'overview') return chartVisible('sales_performance')
  if (page === 'freight') return chartVisible('freight')
  if (page === 'receipts') return chartVisible('salesperson_receipts')
  if (page === 'order-volume') return chartVisible('order_volume')
  if (page === 'order-analysis') return chartVisible('order_volume') || chartVisible('customer_orders')
  return true
})
const dataRevision = ref(0)
const filterLabels = ref<Record<string, string>>({})
function updateFilterLabels(rows: { id: string; name: string }[]) { for (const row of rows) filterLabels.value[row.id] = row.name }
watch(sessionEpoch, () => { filterLabels.value = {} })
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
const choice = computed(() => route.name === 'RoleWorkbenchFreight' ? 'freight' : route.name === 'RoleWorkbenchReceipts' ? 'receipts' : route.query.queue ?? (role.value ? defaultWorkbenchQueue(role.value) : undefined))
const validChoice = computed(() => role.value && (role.value === 'sales' && choice.value === 'overview' || workbenchQueues[role.value].some(queue => queue === choice.value)))
const icons = { sales: BriefcaseBusiness, procurement: Boxes, allocation: PackageCheck, dispatch: Send, warehouse: Warehouse }
const departmentQuery = computed(() => typeof route.query.departmentId === 'string' && route.query.departmentId ? { departmentId: route.query.departmentId } : {})
const todoScopeQuery = computed(() => ({ ...departmentQuery.value, ...(typeof route.query.ownerId === 'string' && route.query.ownerId ? { ownerId: route.query.ownerId } : {}) }))
function roleLink(value: WorkbenchRole) { return { name: 'RoleWorkbench', params: { role: value }, query: todoScopeQuery.value } }
function queueLink(value: string) { return { name: 'RoleWorkbench', params: { role: role.value }, query: { ...(['stock', 'stock_procurement'].includes(value) || role.value && workbenchQueues[role.value].some(queue => queue === value) ? todoScopeQuery.value : departmentQuery.value), queue: value } } }
</script>

<template>
  <AppLayout>
    <div class="app-page role-workbench">
      <header class="workbench-heading"><div><p class="eyebrow">HYPERZONE · {{ text('智能办公平台', 'INTELLIGENT WORKPLACE') }}</p><h1>{{ route.name === 'Dashboard' ? text('我的工作台', 'My Workbench') : role ? workbenchNames[role][zh ? 0 : 1] : text('岗位工作台', 'Role Workbench') }}</h1></div><RouterLink to="/dashboard" class="dashboard-link">{{ text('Dashboard', 'Dashboard') }}<ArrowUpRight :size="16" /></RouterLink></header>
      <nav class="role-tabs" :aria-label="text('岗位工作台', 'Role workbenches')"><RouterLink v-for="item in roles" :key="item" :to="roleLink(item)" :class="{ active: role === item }" :aria-current="role === item ? 'page' : undefined"><component :is="icons[item]" :size="19" /><span>{{ workbenchNames[item][zh ? 0 : 1] }}</span></RouterLink></nav>
      <template v-if="allowed && role">
        <WorkbenchFilterSummary :queue="String(choice)" :labels="filterLabels" />
        <nav class="workbench-queues" :aria-label="text('工作台功能', 'Workbench functions')">
          <template v-for="item in workbenchQueues[role]" :key="item">
            <RouterLink :to="queueLink(item)" :class="{ active: choice === item }">{{ queueNames[item][zh ? 0 : 1] }}{{ ['procurement_shipping', 'allocation_review'].includes(item) ? '' : text('清单', item === 'exceptions' ? '' : ' orders') }}</RouterLink>
            <RouterLink v-if="role === 'sales' && item === 'review'" :to="queueLink('stock')" :class="{ active: choice === 'stock' }">{{ text('备货清单', 'Stock orders') }}</RouterLink>
            <RouterLink v-if="role === 'procurement' && item === 'procurement_shipping'" :to="queueLink('stock_procurement')" :class="{ active: choice === 'stock_procurement' }">{{ text('备货待采购清单', 'Stock procurement') }}</RouterLink>
          </template>
          <RouterLink v-if="role === 'sales' && chartVisible('sales_performance')" :to="queueLink('performance')" :class="{ active: choice === 'performance' }">{{ text('个人收款与毛利', 'Personal receipts and profit') }}</RouterLink>
          <RouterLink v-if="chartVisible('order_volume') || chartVisible('customer_orders')" :to="queueLink('order-analysis')" :class="{ active: choice === 'order-analysis' || choice === 'order-volume' || choice === 'receipts' }">{{ text('订单分析', 'Order analysis') }}</RouterLink>
          <RouterLink v-if="chartVisible('freight')" :to="queueLink('freight')" :class="{ active: choice === 'freight' }">{{ text('物流运费', 'Actual freight') }}</RouterLink>
          <RouterLink v-if="role === 'sales' && chartVisible('sales_performance')" :to="queueLink('overview')" :class="{ active: choice === 'overview' }">{{ text('客户开发概览', 'Prospecting overview') }}</RouterLink>
        </nav>
        <div v-if="!analyticsAllowed" class="access-message" role="alert">{{ text('暂无此功能权限，请选择其他工作台功能。', 'This feature is not available for your account.') }}</div>
        <SalesOverview v-else-if="choice === 'overview' && role === 'sales'" />
        <SalesPerformanceView v-else-if="choice === 'performance' && role === 'sales'" :key="dataRevision" />
        <StockOrdersView v-else-if="choice === 'stock' && role === 'sales' || choice === 'stock_procurement' && role === 'procurement'" :key="`${dataRevision}-${choice}`" :procurement="role === 'procurement'" @filter-labels="updateFilterLabels" />
        <FopFreightView v-else-if="choice === 'freight'" :key="dataRevision" />
        <FopReceiptsView v-else-if="choice === 'receipts'" :key="dataRevision" />
        <OrderVolumeOrdersView v-else-if="choice === 'order-volume'" :key="dataRevision" />
        <div v-else-if="choice === 'order-analysis'"><OrderVolumeAnalysis v-if="chartVisible('order_volume')" :revision="dataRevision" /><OrderVolumeAnalysis v-if="chartVisible('customer_orders')" customer :revision="dataRevision" /></div>
        <FopOrdersView @filter-labels="updateFilterLabels" v-else-if="validChoice" :key="dataRevision" :search-recovery="searchRecovery" :recover-page="recoverOrderPage" @clear-search-recovery="clearSearchRecovery" />
        <div v-else class="access-message" role="alert">{{ text('该清单不属于当前工作台，请选择上方功能。', 'This list does not belong to the selected workbench. Choose a function above.') }}</div>
      </template>
      <div v-else class="access-message" role="alert">{{ text('暂时无法访问此工作台，请联系管理员分配岗位。', 'You do not have access to this workbench. Contact an administrator.') }}</div>
    </div>
  </AppLayout>
</template>

<style scoped>
.role-workbench { color: var(--color-text); }.workbench-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .16em; color: #8490a3; margin-bottom: 7px; }.workbench-heading h1 { font-size: 28px; font-weight: 750; letter-spacing: -.03em; }.workbench-heading p:last-child { margin-top: 7px; font-size: 12px; line-height: 1.7; color: #8490a3; }.dashboard-link { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 9px 13px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; }
.role-tabs { display: flex; gap: 10px; margin-bottom: 22px; overflow-x: auto; padding-bottom: 2px; }.role-tabs a { display: flex; flex: 1; min-width: 150px; max-width: 230px; align-items: center; gap: 11px; padding: 17px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: #8490a3; font-size: 13px; font-weight: 600; }.role-tabs a.active { color: #fff; background: #4f67bf; border-color: #4f67bf; box-shadow: 0 5px 15px #4f67bf20; }.workbench-filter-summary + .workbench-queues { margin-top: 24px; }.workbench-queues { display: flex; gap: 24px; border-bottom: 1px solid var(--color-border); margin-bottom: 22px; overflow-x: auto; }.workbench-queues a { white-space: nowrap; color: #8490a3; font-size: 13px; padding: 0 2px 12px; border-bottom: 2px solid transparent; }.workbench-queues a.active { color: #5873d4; font-weight: 700; border-color: #5873d4; }.access-message { padding: 70px 20px; text-align: center; color: #8490a3; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; }@media (max-width: 700px) { .workbench-heading { align-items: flex-start; }.workbench-heading h1 { font-size: 24px; }.role-tabs a { min-width: 140px; padding: 14px; } }

.dark .role-tabs a { color: #afbdd2; background: var(--color-surface); }
.dark .role-tabs a.active { color: #e9efff; background: #344d84; border-color: #627db7; box-shadow: 0 5px 16px #0000001a; }
.dark .workbench-queues a { color: #a3b1c5; }
.dark .workbench-queues a.active { color: #b7c9ff; border-color: #91a9e9; }
</style>

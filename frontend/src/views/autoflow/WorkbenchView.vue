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
import FopDataAccessNotice from '@/components/FopDataAccessNotice.vue'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { sessionEpoch } from '@/utils/session'
import { defaultWorkbenchQueue, isWorkbenchRole, queueNames, workbenchNames, workbenchQueues, type WorkbenchRole } from '@/utils/workbench'

const route = useRoute()
const router = useRouter()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const { roles } = useWorkbenchAccess()
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
const choice = computed(() => route.name === 'RoleWorkbenchFreight' ? 'freight' : route.name === 'RoleWorkbenchReceipts' ? 'receipts' : route.query.queue ?? (role.value ? defaultWorkbenchQueue(role.value) : undefined))
const validChoice = computed(() => role.value && (role.value === 'sales' && choice.value === 'overview' || workbenchQueues[role.value].some(queue => queue === choice.value)))
const icons = { sales: BriefcaseBusiness, procurement: Boxes, allocation: PackageCheck, dispatch: Send, warehouse: Warehouse }
const descriptions = computed(() => ({
  sales: text('统筹客户开发、订单审核与异常跟进，衔接业务成交与履约。', 'Coordinate prospecting, order review and exception follow-up from customer work to fulfillment.'),
  procurement: text('查看采购需求与订单明细，跟进商品采购和供应进度。', 'Review procurement needs and order details, and follow up on purchasing and supply progress.'),
  allocation: text('核对待配货订单与商品需求，协调库存分配和后续发运。', 'Check order and product requirements, and coordinate stock allocation before shipment.'),
  dispatch: text('跟进已审核履约订单，同步 Shopify 发货信息。', 'Follow up approved fulfillment orders and synchronize Shopify fulfillment.'),
  warehouse: text('查看仓库待出库清单，核对商品、仓库与物流信息。', 'Review warehouse dispatch queues and check product, warehouse and tracking details.'),
}))
const departmentQuery = computed(() => typeof route.query.departmentId === 'string' && route.query.departmentId ? { departmentId: route.query.departmentId } : {})
function roleLink(value: WorkbenchRole) { return { name: 'RoleWorkbench', params: { role: value }, query: departmentQuery.value } }
function queueLink(value: string) { return { name: 'RoleWorkbench', params: { role: role.value }, query: { ...departmentQuery.value, queue: value } } }
</script>

<template>
  <AppLayout>
    <div class="app-page role-workbench">
      <header class="workbench-heading"><div><p class="eyebrow">HYPERZONE · {{ text('智能办公平台', 'INTELLIGENT WORKPLACE') }}</p><h1>{{ route.name === 'Dashboard' ? text('我的工作台', 'My Workbench') : role ? workbenchNames[role][zh ? 0 : 1] : text('岗位工作台', 'Role Workbench') }}</h1><p>{{ route.name === 'Dashboard' ? text('从岗位待办开始，协同推进客户、采购、订单与仓储发运工作。', 'Start with your role-based tasks and coordinate customer work, purchasing, orders and fulfillment.') : role ? descriptions[role] : '' }}</p></div><RouterLink to="/dashboard" class="dashboard-link">{{ text('Dashboard', 'Dashboard') }}<ArrowUpRight :size="16" /></RouterLink></header>
      <nav class="role-tabs" :aria-label="text('岗位工作台', 'Role workbenches')"><RouterLink v-for="item in roles" :key="item" :to="roleLink(item)" :class="{ active: role === item }" :aria-current="role === item ? 'page' : undefined"><component :is="icons[item]" :size="19" /><span>{{ workbenchNames[item][zh ? 0 : 1] }}</span></RouterLink></nav>
      <template v-if="allowed && role">
        <FopDataAccessNotice @recheck="dataRevision++" />
        <nav class="workbench-queues" :aria-label="text('工作台功能', 'Workbench functions')">
          <RouterLink v-for="item in workbenchQueues[role]" :key="item" :to="queueLink(item)" :class="{ active: choice === item }">{{ queueNames[item][zh ? 0 : 1] }}{{ ['procurement_shipping', 'allocation_review'].includes(item) ? '' : text('清单', item === 'exceptions' ? '' : ' orders') }}</RouterLink>
          <RouterLink v-if="role === 'sales'" :to="queueLink('performance')" :class="{ active: choice === 'performance' }">{{ text('个人收款与毛利', 'Personal receipts and profit') }}</RouterLink>
          <RouterLink :to="queueLink('order-analysis')" :class="{ active: choice === 'order-analysis' || choice === 'order-volume' || choice === 'receipts' }">{{ text('订单分析', 'Order analysis') }}</RouterLink>
          <RouterLink :to="queueLink('freight')" :class="{ active: choice === 'freight' }">{{ text('物流运费', 'Actual freight') }}</RouterLink>
          <RouterLink v-if="role === 'sales'" :to="queueLink('overview')" :class="{ active: choice === 'overview' }">{{ text('客户开发概览', 'Prospecting overview') }}</RouterLink>
        </nav>
        <SalesOverview v-if="choice === 'overview' && role === 'sales'" />
        <SalesPerformanceView v-else-if="choice === 'performance' && role === 'sales'" :key="dataRevision" />
        <FopFreightView v-else-if="choice === 'freight'" :key="dataRevision" />
        <FopReceiptsView v-else-if="choice === 'receipts'" :key="dataRevision" />
        <OrderVolumeOrdersView v-else-if="choice === 'order-volume'" :key="dataRevision" />
        <div v-else-if="choice === 'order-analysis'"><OrderVolumeAnalysis :revision="dataRevision" /><OrderVolumeAnalysis customer :revision="dataRevision" /></div>
        <FopOrdersView v-else-if="validChoice" :key="dataRevision" :search-recovery="searchRecovery" :recover-page="recoverOrderPage" @clear-search-recovery="clearSearchRecovery" />
        <div v-else class="access-message" role="alert">{{ text('该清单不属于当前工作台，请选择上方功能。', 'This list does not belong to the selected workbench. Choose a function above.') }}</div>
      </template>
      <div v-else class="access-message" role="alert">{{ text('暂时无法访问此工作台，请联系管理员分配岗位。', 'You do not have access to this workbench. Contact an administrator.') }}</div>
    </div>
  </AppLayout>
</template>

<style scoped>
.role-workbench { color: var(--color-text); }.workbench-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 24px; }.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .16em; color: #8490a3; margin-bottom: 7px; }.workbench-heading h1 { font-size: 28px; font-weight: 750; letter-spacing: -.03em; }.workbench-heading p:last-child { margin-top: 7px; font-size: 12px; line-height: 1.7; color: #8490a3; }.dashboard-link { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 9px 13px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; }
.role-tabs { display: flex; gap: 10px; margin-bottom: 22px; overflow-x: auto; padding-bottom: 2px; }.role-tabs a { display: flex; flex: 1; min-width: 150px; max-width: 230px; align-items: center; gap: 11px; padding: 17px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: #8490a3; font-size: 13px; font-weight: 600; }.role-tabs a.active { color: #fff; background: #4f67bf; border-color: #4f67bf; box-shadow: 0 5px 15px #4f67bf20; }.workbench-queues { display: flex; gap: 24px; border-bottom: 1px solid var(--color-border); margin-bottom: 22px; overflow-x: auto; }.workbench-queues a { white-space: nowrap; color: #8490a3; font-size: 13px; padding: 0 2px 12px; border-bottom: 2px solid transparent; }.workbench-queues a.active { color: #5873d4; font-weight: 700; border-color: #5873d4; }.access-message { padding: 70px 20px; text-align: center; color: #8490a3; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; }@media (max-width: 700px) { .workbench-heading { align-items: flex-start; }.workbench-heading h1 { font-size: 24px; }.role-tabs a { min-width: 140px; padding: 14px; } }

.dark .role-tabs a { color: #afbdd2; background: var(--color-surface); }
.dark .role-tabs a.active { color: #e9efff; background: #344d84; border-color: #627db7; box-shadow: 0 5px 16px #0000001a; }
.dark .workbench-queues a { color: #a3b1c5; }
.dark .workbench-queues a.active { color: #b7c9ff; border-color: #91a9e9; }
</style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, Search, SlidersHorizontal, Users } from 'lucide-vue-next'
import { AppLayout } from '@/components/layout'
import AccountAccessDialog from '@/components/admin/AccountAccessDialog.vue'
import ChartPermissionsDialog from '@/components/admin/ChartPermissionsDialog.vue'
import InfoTip from '@/components/ui/InfoTip.vue'
import { accountRoles, getWorkbenchAccounts, type AccountRole, type WorkbenchAccount } from '@/api/workbench-access'
import { accountRoleNames, accountRoleDescriptions, employeeDisplayName, getAccountRole, scopeName } from '@/utils/account-role'
import { englishDisplayName } from '@/utils/user-display'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { useUserStore } from '@/stores/user'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'

const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const userStore = useUserStore()
const accounts = ref<WorkbenchAccount[]>([]), editing = ref<WorkbenchAccount>(), chartAccount = ref<WorkbenchAccount>()
const search = ref(new URLSearchParams(window.location.search).get('search') ?? '')
const roleFilter = ref<AccountRole | ''>(''), page = ref(1), total = ref(0), busy = ref(false), error = ref(''), success = ref('')
const pages = computed(() => Math.max(1, Math.ceil(total.value / 20)))
let requestId = 0
const off = onSessionReset(() => { requestId++; accounts.value = []; editing.value = undefined; chartAccount.value = undefined; error.value = ''; success.value = '' })
async function load(reset = false) {
  if (reset) page.value = 1
  const request = ++requestId
  busy.value = true; error.value = ''; success.value = ''
  try {
    const result = await getWorkbenchAccounts({ page: page.value, pageSize: 20, search: search.value.trim() || undefined, accountRole: roleFilter.value || undefined })
    if (request !== requestId) return
    accounts.value = result.items; total.value = result.total
  } catch {
    if (request === requestId) { accounts.value = []; total.value = 0; error.value = text('账号加载失败，请重试。', 'Could not load accounts. Please retry.') }
  } finally { if (request === requestId) busy.value = false }
}
function filterRole(value: AccountRole | '') { roleFilter.value = value; void load(true) }
async function saved(account: WorkbenchAccount) {
  const session = captureSession()
  editing.value = undefined; chartAccount.value = undefined
  await load()
  if (!isCurrentSession(session)) return
  success.value = text(`${englishDisplayName(account)} 的权限已保存。`, `Permissions saved for ${englishDisplayName(account)}.`)
  if (userStore.user?.id === account.id) {
    try { await userStore.fetchUser(); await refreshWorkbenchAccess() }
    catch { error.value = text('权限已保存，请刷新页面。', 'Changes saved. Please refresh the page.') }
  }
}
function editCharts() { chartAccount.value = editing.value; editing.value = undefined }
function benchCount(account: WorkbenchAccount) {
  return account.businessScope?.role === 'none' ? 0 : account.businessScope?.role === 'admin' ? 5 : account.workbenchRoles.length
}
onMounted(() => load())
onBeforeUnmount(() => { requestId++; off() })
</script>
<template>
  <AppLayout><div class="app-page accounts-page">
    <header class="accounts-heading"><div><p class="page-eyebrow">HYPERZONE · ACCESS</p><h1 class="page-title">{{ text('账号与权限', 'Accounts & access') }}</h1></div><RouterLink to="/organization" class="btn btn-secondary"><Users :size="15" />{{ text('组织与成员', 'Organization') }}</RouterLink></header>
    <p v-if="error" role="alert" class="account-notice error">{{ error }}</p>
    <p v-if="success" role="status" class="account-notice success">{{ success }}</p>
    <section class="panel accounts-panel" :aria-busy="busy">
      <div class="accounts-toolbar"><form @submit.prevent="load(true)"><div class="account-search"><Search :size="16" /><input v-model="search" type="search" :placeholder="text('搜索账号、邮箱或编号', 'Search account, email or ID')" :aria-label="text('搜索账号', 'Search accounts')" /></div><button class="btn workbench-primary" :disabled="busy">{{ text('查询', 'Search') }}</button></form><button class="btn btn-secondary refresh-accounts" :disabled="busy" @click="load()"><RefreshCw :size="15" :class="{ spinning: busy }" />{{ text('刷新', 'Refresh') }}</button></div>
      <div class="role-filter-row"><div class="role-filters" role="group" :aria-label="text('按角色筛选', 'Filter by role')"><button type="button" :aria-pressed="!roleFilter" :disabled="busy" @click="filterRole('')">{{ text('全部账号', 'All accounts') }}</button><button v-for="role in accountRoles" :key="role" type="button" :data-filter-role="role" :aria-pressed="roleFilter === role" :disabled="busy" @click="filterRole(role)">{{ text(...accountRoleNames[role]) }}</button></div><span class="account-total">{{ text(`共 ${total} 个`, `${total} accounts`) }}</span><InfoTip :label="text('角色权限说明', 'Role permissions')"><div class="role-reference"><p v-for="role in accountRoles" :key="role"><strong>{{ text(...accountRoleNames[role]) }}</strong> · {{ text(...accountRoleDescriptions[role]) }}</p></div></InfoTip></div>
      <div class="account-table-wrap"><table class="account-table"><thead><tr><th>{{ text('账号', 'Account') }}</th><th>{{ text('所属部门', 'Department') }}</th><th>{{ text('角色', 'Role') }}</th><th>{{ text('业务数据', 'Business data') }}</th><th>FOP</th><th class="account-actions">{{ text('操作', 'Actions') }}</th></tr></thead><tbody>
        <tr v-if="busy"><td colspan="6" class="account-empty">{{ text('正在加载…', 'Loading…') }}</td></tr>
        <template v-else><tr v-for="account in accounts" :key="account.id" :data-account-id="account.id">
          <td><div class="account-identity"><span class="account-avatar" :data-role="getAccountRole(account)">{{ englishDisplayName(account).slice(0, 1) }}</span><div><div class="account-name"><strong>{{ englishDisplayName(account) }}</strong><span v-if="account.id === userStore.user?.id" class="self-label">{{ text('本人', 'You') }}</span></div><p :title="`ID ${account.displayId}`">{{ account.email }}</p></div></div></td>
          <td><span class="department-name">{{ account.employee?.department.name || '—' }}</span><small v-if="employeeDisplayName(account)" class="employee-name">{{ employeeDisplayName(account) }}</small></td>
          <td><span class="account-role" :data-role="getAccountRole(account)">{{ text(...accountRoleNames[getAccountRole(account)]) }}</span></td>
          <td><span class="scope-name" :class="{ muted: account.businessScope?.role === 'none' }">{{ text(...scopeName(account)) }}</span><small class="bench-count">{{ text(`${benchCount(account)} 个工作台`, `${benchCount(account)} workbenches`) }}</small></td>
          <td><RouterLink :to="{ path: '/organization', query: { accountId: account.id } }" class="binding-state" :class="{ linked: account.fopBinding }" :title="text('编辑账号与 FOP 绑定', 'Edit account and FOP binding')"><span />{{ account.fopBinding ? text('已绑定', 'Linked') : text('未绑定', 'Unlinked') }}</RouterLink></td>
          <td class="account-actions"><button type="button" class="edit-access" data-edit-access :aria-label="`${englishDisplayName(account)} · ${text('编辑权限', 'Edit permissions')}`" @click="editing = account"><SlidersHorizontal :size="14" />{{ text('编辑权限', 'Edit access') }}</button></td>
        </tr><tr v-if="!accounts.length"><td colspan="6" class="account-empty">{{ text('暂无匹配账号', 'No matching accounts') }}</td></tr></template>
      </tbody></table></div>
      <footer class="account-pagination"><span>{{ text(`每页 20 个账号`, '20 accounts per page') }}</span><div><button class="btn btn-secondary" :disabled="busy || page <= 1" @click="page--; load()">{{ text('上一页', 'Previous') }}</button><span>{{ page }} / {{ pages }}</span><button class="btn btn-secondary" :disabled="busy || page >= pages" @click="page++; load()">{{ text('下一页', 'Next') }}</button></div></footer>
    </section>
    <AccountAccessDialog v-if="editing" :key="editing.id" :account="editing" :self="editing.id === userStore.user?.id" @close="editing = undefined" @saved="saved" @charts="editCharts" />
    <ChartPermissionsDialog v-if="chartAccount" :key="chartAccount.id" :account="chartAccount" @close="chartAccount = undefined" @saved="saved" />
  </div></AppLayout>
</template>
<style scoped>
.accounts-page{max-width:1560px}.accounts-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:26px}.accounts-heading .page-eyebrow{margin-bottom:9px}.accounts-panel{overflow:hidden}.accounts-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 22px 14px}.accounts-toolbar form{display:flex;gap:8px;flex:1;max-width:550px}.account-search{display:flex;align-items:center;gap:10px;border:1px solid var(--color-border);border-radius:6px;padding:0 12px;min-width:0;flex:1;color:var(--color-text-secondary)}.account-search input{border:0;outline:0;background:transparent;padding:9px 0;width:100%;font-size:12px;color:var(--color-text)}.account-search:focus-within{border-color:var(--color-chart-link);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-chart-link) 12%,transparent)}.role-filter-row{display:flex;align-items:center;gap:10px;padding:0 22px 18px}.role-filters{display:flex;gap:4px;flex-wrap:wrap}.role-filters button{font-size:12px;padding:6px 11px;color:var(--color-text-secondary);border-radius:5px}.role-filters button[aria-pressed=true]{color:var(--color-chart-link);background:color-mix(in srgb,var(--color-chart-link) 10%,var(--color-surface));font-weight:600}.role-filters button:hover{background:var(--color-bg)}.account-total{margin-left:auto;font-size:11px;color:var(--color-text-secondary);white-space:nowrap}.role-reference p{margin:4px 0}.account-table-wrap{overflow-x:auto}.account-table{width:100%;min-width:850px;border-collapse:collapse;text-align:left;table-layout:auto}.account-table thead{background:var(--color-bg)}.account-table th{font-size:11px;font-weight:500;color:var(--color-text-secondary);padding:12px 16px;border-block:1px solid var(--color-border);white-space:nowrap}.account-table td{font-size:12px;padding:15px 16px;border-bottom:1px solid var(--color-border);vertical-align:middle}.account-table th:first-child,.account-table td:first-child{padding-left:22px}.account-table th:last-child,.account-table td:last-child{padding-right:22px}.account-table tbody tr:last-child td{border-bottom:0}.account-table tbody tr:hover{background:color-mix(in srgb,var(--color-chart-link) 2.5%,var(--color-surface))}.account-identity{display:flex;align-items:center;gap:12px;white-space:nowrap}.account-avatar{display:grid;place-items:center;width:34px;height:34px;flex-shrink:0;border-radius:9px;color:var(--color-chart-link);background:color-mix(in srgb,var(--color-chart-link) 10%,var(--color-surface));font-size:13px;font-weight:600}.account-name{display:flex;gap:8px;align-items:center}.account-name strong{font-size:13px;font-weight:600}.account-identity p{font-size:11px;margin:4px 0 0;color:var(--color-text-secondary)}.self-label{font-size:10px;color:var(--color-text-secondary);border:1px solid var(--color-border);border-radius:3px;padding:0 4px}.department-name{font-size:12px;white-space:nowrap}.employee-name,.bench-count{display:block;color:var(--color-text-secondary);font-size:11px;margin-top:5px}.account-role{display:inline-block;padding:4px 8px;border:1px solid var(--color-border);border-radius:5px;font-size:11px;white-space:nowrap}.account-role[data-role=administrator]{color:var(--color-chart-link);border-color:color-mix(in srgb,var(--color-chart-link) 25%,var(--color-border));background:color-mix(in srgb,var(--color-chart-link) 7%,var(--color-surface))}.account-role[data-role=department_manager]{color:var(--color-text);background:var(--color-bg)}.scope-name{font-size:12px;white-space:nowrap}.muted{color:var(--color-text-secondary)}.binding-state{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--color-text-secondary);white-space:nowrap}.binding-state>span{height:5px;width:5px;border-radius:50%;background:currentColor;opacity:.6}.binding-state.linked{color:var(--color-success,#368779)}.binding-state:hover{text-decoration:underline}.account-actions{text-align:right;white-space:nowrap}.edit-access{display:inline-flex;align-items:center;gap:6px;color:var(--color-chart-link);font-size:12px;padding:7px 8px;border-radius:5px}.edit-access:hover{background:color-mix(in srgb,var(--color-chart-link) 8%,var(--color-surface))}.account-pagination{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 22px;border-top:1px solid var(--color-border);color:var(--color-text-secondary);font-size:11px}.account-pagination>div{display:flex;align-items:center;gap:16px}.account-pagination .btn{font-size:11px;padding:6px 10px}.account-empty{height:220px;text-align:center;color:var(--color-text-secondary)}.account-notice{padding:10px 14px;border:1px solid var(--color-border);border-radius:6px;margin-bottom:14px;font-size:12px}.account-notice.error{color:var(--color-danger,#c34c4c)}.account-notice.success{color:var(--color-success,#368779)}.spinning{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:760px){.accounts-toolbar,.role-filter-row{padding-inline:14px}.role-filter-row{flex-wrap:wrap}.account-total{margin-left:0}.accounts-heading{align-items:flex-start}.accounts-heading .btn{font-size:11px}.refresh-accounts{font-size:0;gap:0}.account-pagination{padding:14px}}
</style>

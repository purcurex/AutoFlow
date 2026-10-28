<script setup lang="ts">
import ChartPermissionsDialog from '@/components/admin/ChartPermissionsDialog.vue'
import { onSessionReset } from '@/utils/session'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AppLayout } from '@/components/layout'
import { getWorkbenchAccounts, updateWorkbenchRoles, updateBusinessScope, updateManagementRole, type BusinessScope, type WorkbenchAccount } from '@/api/workbench-access'
import { useUserStore } from '@/stores/user'
import { refreshWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { workbenchNames, workbenchRoles, type WorkbenchRole } from '@/utils/workbench'

const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const userStore = useUserStore()
const managementRoles = ref<Record<string, WorkbenchAccount['role']>>({})
const accounts = ref<WorkbenchAccount[]>([])
const chartAccount = ref<WorkbenchAccount>()
function chartsSaved(saved: WorkbenchAccount) {
  const account = accounts.value.find(item => item.id === saved.id)
  if (account) account.chartPermissions = saved.chartPermissions
  chartAccount.value = undefined
  success.value = text(`${saved.username} 的图表权限已保存。`, `Chart permissions saved for ${saved.username}.`)
}
const offSession = onSessionReset(() => { requestId++; accounts.value = []; chartAccount.value = undefined })
const drafts = ref<Record<string, WorkbenchRole[]>>({})
const scopes = ref<Record<string, BusinessScope>>({})
const search = ref(new URLSearchParams(window.location.search).get('search') ?? '')
const page = ref(1)
const total = ref(0)
const busy = ref(false)
const saving = ref('')
const error = ref('')
const success = ref('')
let requestId = 0
async function load(reset = false) {
  if (saving.value) return
  if (reset) page.value = 1
  const request = ++requestId
  busy.value = true
  error.value = ''
  success.value = ''
  accounts.value = []
  try {
    const result = await getWorkbenchAccounts({ page: page.value, pageSize: 20, search: search.value.trim() || undefined })
    if (request !== requestId) return
    accounts.value = result.items
    total.value = result.total
    managementRoles.value = Object.fromEntries(result.items.map(item => [item.id, item.role]))
    scopes.value = Object.fromEntries(result.items.map(item => [item.id, { ...(item.businessScope ?? { role: 'salesperson', departmentId: null, employeeId: null }) }]))
    drafts.value = Object.fromEntries(result.items.map(item => [item.id, [...item.workbenchRoles]]))
  } catch {
    if (request === requestId) error.value = text('账号加载失败，请确认管理员权限后重试。', 'Could not load accounts. Check administrator access and retry.')
  } finally { if (request === requestId) busy.value = false }
}
function changed(account: WorkbenchAccount) {
  const draft = drafts.value[account.id] || []
  return draft.length !== account.workbenchRoles.length || draft.some(role => !account.workbenchRoles.includes(role))
}
async function save(account: WorkbenchAccount) {
  if (saving.value) return
  saving.value = account.id
  error.value = ''
  success.value = ''
  try {
    const saved = await updateWorkbenchRoles(account.id, drafts.value[account.id] || [])
    account.workbenchRoles = [...saved.workbenchRoles]
    drafts.value[account.id] = [...saved.workbenchRoles]
    success.value = text(`${account.username} 的工作台权限已保存。`, `Workbench access saved for ${account.username}.`)
  } catch {
    error.value = text('保存失败，权限未更新。请检查管理员权限后重试。', 'Save failed. Access was not changed. Check administrator access and retry.')
  } finally { saving.value = '' }
}
function scopeChanged(account: WorkbenchAccount) {
  return JSON.stringify(scopes.value[account.id]) !== JSON.stringify(account.businessScope)
}
async function saveScope(account: WorkbenchAccount) {
  if (saving.value) return
  const draft = scopes.value[account.id]!
  const scope: BusinessScope = { role: draft.role, departmentId: draft.departmentId?.trim() || null, employeeId: draft.employeeId?.trim() || null }
  error.value = ''; success.value = ''
  if ((scope.role === 'department_manager' && !scope.departmentId) || (scope.role === 'salesperson' && !scope.employeeId)) {
    error.value = text('部门经理必须绑定部门 ID，业务员必须绑定员工 ID。', 'Managers require a department ID; salespeople require an employee ID.'); return
  }
  saving.value = account.id
  try {
    const saved = await updateBusinessScope(account.id, scope)
    account.businessScope = saved.businessScope
    scopes.value[account.id] = { ...saved.businessScope! }
    if (userStore.user?.id === account.id) { await userStore.fetchUser(); await refreshWorkbenchAccess() }
    success.value = text(`${account.username} 的业务数据权限已保存，下次请求立即生效。`, `Data access saved for ${account.username}; effective on the next request.`)
  } catch { error.value = text('数据权限保存失败，请核对管理员权限及绑定信息。', 'Could not save data access. Check administrator permissions and assignments.') }
  finally { saving.value = '' }
}
async function saveManagement(account: WorkbenchAccount) {
  if (saving.value) return
  saving.value = account.id
  error.value = ''; success.value = ''
  try {
    const saved = await updateManagementRole(account.id, managementRoles.value[account.id]!)
    account.role = saved.role
    managementRoles.value[account.id] = saved.role
    success.value = text(`${account.username} 的系统管理权限已保存，业务数据范围保持不变。`, `Management access saved for ${account.username}. Business data scope is unchanged.`)
  } catch (cause) {
    const conflict = typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 409
    error.value = conflict ? text('不能撤销自己的系统管理权限，请由另一位管理员操作。', 'Ask another administrator to remove your management access.') : text('系统管理权限保存失败，请检查当前管理员权限。', 'Could not save management access. Check your administrator permissions.')
  } finally { saving.value = '' }
}
onMounted(() => load())
onBeforeUnmount(() => { requestId++; offSession() })
</script>

<template>
  <AppLayout><div class="app-page">
    <header class="mb-6 flex items-start justify-between gap-4"><div><p class="mb-2 text-xs font-bold tracking-widest text-slate-400">HYPERZONE · ACCOUNTS & ACCESS</p><h1 class="text-2xl font-bold">{{ text('账号与权限管理', 'Account & Access Management') }}</h1></div><div class="flex shrink-0 flex-wrap gap-2"><RouterLink to="/organization" class="btn btn-secondary">{{ text('维护组织与成员', 'Manage organization and members') }}</RouterLink><RouterLink to="/" class="btn btn-secondary">{{ text('返回工作台', 'Back to workbench') }}</RouterLink></div></header>
    <p class="mb-5 rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">{{ text('系统管理角色控制组织架构及账号授权；业务数据范围控制可见记录；岗位控制工作台入口。FOP 绑定用于核验后台用户权限。一个 FOP 租户内的用户仅可绑定一个前端账号。绑定不等于授权，管理员也需要绑定并取得 FOP 数据权限。', 'Management roles control organization and account administration. Business scope controls visible records; operational roles control workbench access. FOP bindings identify the backend user. Each FOP tenant/user pair can link to one frontend account. Linking does not grant data access; administrators also require FOP authorization.') }}</p>
    <p v-if="error" role="alert" class="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>
    <p v-if="success" role="status" class="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{{ success }}</p>
    <section class="panel overflow-hidden" :aria-busy="busy">
      <form class="flex gap-3 border-b p-4" @submit.prevent="load(true)"><input v-model="search" type="search" class="input query-search-control" :placeholder="text('搜索账号、邮箱或用户编号', 'Search username, email or user ID')" :aria-label="text('搜索账号', 'Search accounts')" /><button class="btn btn-secondary" :disabled="busy || !!saving">{{ text('查询', 'Search') }}</button></form>
      <p v-if="busy" class="p-10 text-center text-sm text-slate-500">{{ text('正在加载…', 'Loading…') }}</p>
      <div v-else class="overflow-x-auto"><table class="data-table min-w-[950px]"><thead><tr><th>{{ text('账号', 'Account') }}</th><th>{{ text('系统管理权限', 'System management') }}</th><th>{{ text('业务数据权限', 'Business data scope') }}</th><th>{{ text('工作台岗位', 'Workbench roles') }}</th><th>{{ text('图表权限', 'Chart permissions') }}</th><th>{{ text('FOP 用户数据绑定', 'FOP user data binding') }}</th></tr></thead><tbody><tr v-for="account in accounts" :key="account.id"><td class="min-w-[180px]"><strong>{{ account.username }}</strong><p class="mt-1 text-xs text-slate-500">{{ account.email }}</p><p class="text-xs text-slate-400">ID {{ account.displayId }}</p><p v-if="account.employee" class="mt-2 text-xs text-slate-500">{{ account.employee.name }} · {{ account.employee.code }}<br />{{ account.employee.department.name }}</p></td><td class="min-w-[230px]">
        <form class="space-y-2 py-2" @submit.prevent="saveManagement(account)">
          <select v-model="managementRoles[account.id]" class="input" :disabled="!!saving" :aria-label="`${account.username} · ${text('系统管理角色', 'Management role')}`">
            <option value="user">{{ text('普通账号 · 无管理权限', 'Standard account · No management') }}</option>
            <option value="admin">{{ text('系统管理员', 'System administrator') }}</option>
          </select>
          <p class="text-xs text-slate-500">{{ text('组织架构、账号与角色设置；不自动授予业务数据权限。', 'Manage organizations, accounts and roles. No automatic business data access.') }}</p>
          <button data-save-management class="btn btn-secondary" :disabled="!!saving || managementRoles[account.id] === account.role">{{ text('保存管理权限', 'Save management access') }}</button>
        </form>
      </td><td class="min-w-[270px]">
        <form class="space-y-2 py-2" @submit.prevent="saveScope(account)">
          <select v-model="scopes[account.id]!.role" class="input" :disabled="!!saving" :aria-label="`${account.username} · ${text('业务数据角色', 'Business data role')}`">
            <option value="none">{{ text('无业务数据权限', 'No business data access') }}</option>
            <option value="admin">{{ text('全部业务数据', 'All business data') }}</option>
            <option value="department_manager">{{ text('部门经理 · 本部门及子部门', 'Department manager · Department and teams') }}</option>
            <option value="salesperson">{{ text('业务员 · 仅本人数据', 'Salesperson · Own records') }}</option>
          </select>
          <label v-if="['department_manager', 'salesperson'].includes(scopes[account.id]!.role)" class="block text-xs">{{ text('所属部门 ID', 'Department ID') }}<input v-model="scopes[account.id]!.departmentId" class="input mt-1" maxlength="128" :disabled="!!saving" :aria-label="`${account.username} · ${text('所属部门 ID', 'Department ID')}`" /></label>
          <label v-if="['department_manager', 'salesperson'].includes(scopes[account.id]!.role)" class="block text-xs">{{ text('绑定员工 ID', 'Employee ID') }}<input v-model="scopes[account.id]!.employeeId" class="input mt-1" maxlength="128" :disabled="!!saving" :aria-label="`${account.username} · ${text('绑定员工 ID', 'Employee ID')}`" /></label>
          <p class="text-xs text-slate-500">{{ text('数据范围独立生效；部门和员工使用组织目录／FOP 的稳定 ID。', 'Data scope is independent. Use stable directory / FOP department and employee IDs.') }}</p>
          <p class="text-xs text-slate-500">{{ text('每个账号独立保存数据范围。业务员仅查看本人；管理与协同人员按职责授予部门或全部范围。系统管理员身份不扩大业务数据权限，仍与 FOP 授权取交集。', 'Save data access separately for each account. Salespeople view their own records; managers and collaborators receive department or company scope as needed. System management never expands business access; FOP grants still apply.') }}</p>
          <button data-save-scope class="btn btn-secondary" :disabled="!!saving || !scopeChanged(account)">{{ text('保存数据权限', 'Save data access') }}</button>
        </form>
      </td><td class="min-w-[200px]">
        <div class="space-y-2 py-2">
          <label v-for="role in workbenchRoles" :key="role" class="flex items-center gap-2 text-xs">
            <input v-if="account.businessScope?.role !== 'admin'" v-model="drafts[account.id]" type="checkbox" :value="role" :disabled="!!saving" :aria-label="`${account.username} · ${workbenchNames[role][zh ? 0 : 1]}`" class="h-4 w-4 accent-indigo-600" />
            <span v-else class="text-emerald-600">✓</span>{{ workbenchNames[role][zh ? 0 : 1] }}
          </label>
          <p v-if="account.businessScope?.role === 'none'" class="text-xs text-slate-500">{{ text('岗位配置保留；业务数据关闭期间不开放工作台。', 'Assignments retained; workbenches remain closed while business access is disabled.') }}</p>
          <button v-if="account.businessScope?.role !== 'admin'" data-save class="btn btn-secondary" :disabled="!!saving || !changed(account)" @click="save(account)">{{ text('保存岗位权限', 'Save workbench access') }}</button>
        </div>
      </td><td class="min-w-[180px]"><button data-chart-permissions class="btn btn-secondary" :disabled="!!saving" @click="chartAccount = account">{{ text('配置图表权限', 'Configure charts') }}</button><p class="mt-2 text-xs text-slate-500">{{ text('逐图配置可见性、范围、汇总、明细与导出。', 'Visibility, scope, summaries, details and exports per chart.') }}</p></td><td class="min-w-[200px]"><p class="text-xs text-slate-500">{{ account.fopBinding ? text('已绑定 FOP 用户', 'FOP user linked') : text('未绑定 FOP 用户', 'FOP user not linked') }}</p><RouterLink :to="{ path: '/organization', query: { accountId: account.id } }" class="mt-2 inline-block text-xs text-indigo-600">{{ text('在组织架构中编辑账号', 'Edit account in organization') }}</RouterLink></td></tr></tbody></table><p v-if="!accounts.length" class="p-10 text-center text-sm text-slate-500">{{ text('暂无账号', 'No accounts found') }}</p></div>
      <footer class="flex items-center justify-between border-t p-4 text-xs text-slate-500"><span>{{ text(`共 ${total} 个账号`, `${total} accounts`) }}</span><div class="flex items-center gap-4"><button :disabled="busy || !!saving || page <= 1" @click="page--; load()">{{ text('上一页', 'Previous') }}</button><span>{{ page }} / {{ Math.max(1, Math.ceil(total / 20)) }}</span><button :disabled="busy || !!saving || page * 20 >= total" @click="page++; load()">{{ text('下一页', 'Next') }}</button></div></footer>
    </section>
  </div><ChartPermissionsDialog v-if="chartAccount" :account="chartAccount" @close="chartAccount = undefined" @saved="chartsSaved" /></AppLayout>
</template>

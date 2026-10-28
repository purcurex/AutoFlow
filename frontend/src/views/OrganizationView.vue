<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Building2, ChevronDown, ChevronRight, Folder, GitBranch, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-vue-next'
import { AppLayout } from '@/components/layout'
import EmployeeAccountDialog from '@/components/admin/EmployeeAccountDialog.vue'
import EmployeeLoginDialog from '@/components/admin/EmployeeLoginDialog.vue'
import EmployeeImportDialog from '@/components/admin/EmployeeImportDialog.vue'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import { createOrganizationNode, deleteOrganizationNode, getOrganization, moveOrganizationEmployee, removeOrganizationEmployees, updateOrganizationNode, type OrganizationEmployee, type OrganizationNode, type OrganizationWorkspace } from '@/api/organization'
import { onSessionReset } from '@/utils/session'
import { workbenchNames } from '@/utils/workbench'

const route = useRoute()
const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const workspace = ref<OrganizationWorkspace>()
const selectedId = ref('')
const search = ref('')
const collapsed = ref(new Set<string>())
const busy = ref(false)
const error = ref('')
const success = ref('')
const creating = ref(false)
const confirmDelete = ref(false)
const employeeDialog = ref(false)
const accountEmployee = ref<OrganizationEmployee>()
const editingEmployee = ref(false), importDialog = ref(false), removingMembers = ref(false)
const activeAccountId = ref(typeof route.query?.accountId === 'string' ? route.query.accountId : '')
const memberSearch = ref(''), checkedMembers = ref<string[]>([]), removalIds = ref<string[]>([]), memberError = ref('')
function addEmployee(employee?: OrganizationEmployee, edit = false) { accountEmployee.value = employee; editingEmployee.value = edit; employeeDialog.value = true }
function memberImported(data: OrganizationWorkspace) { importDialog.value = false; accept(data); success.value = text('成员已导入，可继续开通账号并分配权限。', 'Members imported. Open accounts and assign permissions next.') }
async function accountSaved() { activeAccountId.value = ''; await load(); success.value = text('账号资料已保存。', 'Account details saved.') }
function confirmMemberRemoval(ids: string[]) { removalIds.value = [...ids]; memberError.value = '' }
async function removeMembers() {
  if (removingMembers.value) return
  removingMembers.value = true; memberError.value = ''
  try { const data = await removeOrganizationEmployees(removalIds.value); accept(data); removalIds.value = []; checkedMembers.value = []; success.value = text('成员已删除，关联账号已停用。', 'Members removed and linked accounts disabled.') }
  catch (cause) { memberError.value = (cause as {statusCode?: number}).statusCode === 409 ? (cause as {message: string}).message : text('删除失败，请刷新成员清单后重试。', 'Removal failed. Refresh members and retry.') }
  finally { removingMembers.value = false }
}
function employeeCreated(result: { workspace: OrganizationWorkspace; employee: OrganizationEmployee }) {
  employeeDialog.value = false
  search.value = ''
  collapsed.value = new Set()
  accept(result.workspace, result.employee.departmentId)
  success.value = editingEmployee.value ? text('成员信息已保存。', 'Member details saved.') : result.employee.accountId ? text('成员与账号已保存，可前往账号权限分配权限。', 'Employee and account saved. Assign permissions next.') : text('员工已建档，可继续开通账号。', 'Employee created. A login can be opened next.')
}
const draft = reactive({ name: '', parentId: '', sortOrder: 0 })
let requestId = 0
const nodes = computed(() => workspace.value?.nodes ?? [])
const selected = computed(() => nodes.value.find(node => node.id === selectedId.value))
const root = computed(() => nodes.value.find(node => node.parentId === null))
const children = (id: string | null) => nodes.value.filter(node => node.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
function descendants(id: string): Set<string> {
  const ids = new Set([id])
  for (const current of ids) for (const node of children(current)) ids.add(node.id)
  return ids
}
function path(node: OrganizationNode): string {
  const names = [node.name]
  const visited = new Set([node.id])
  let parentId = node.parentId
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes.value.find(item => item.id === parentId)
    if (!parent) break
    names.unshift(parent.name)
    parentId = parent.parentId
  }
  return names.join(' / ')
}
const rows = computed(() => {
  const query = search.value.trim().toLowerCase()
  const included = new Set<string>()
  if (query) for (const node of nodes.value.filter(item => item.name.toLowerCase().includes(query))) {
    let current: OrganizationNode | undefined = node
    while (current && !included.has(current.id)) { included.add(current.id); current = nodes.value.find(item => item.id === current!.parentId) }
  }
  const result: { node: OrganizationNode; depth: number; hasChildren: boolean }[] = []
  const seen = new Set<string>()
  function walk(parentId: string | null, depth: number) {
    for (const node of children(parentId)) {
      if (seen.has(node.id) || (query && !included.has(node.id))) continue
      seen.add(node.id)
      result.push({ node, depth, hasChildren: children(node.id).length > 0 })
      if (query || !collapsed.value.has(node.id)) walk(node.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
})
const selectedDescendants = computed(() => descendants(selectedId.value))
const members = computed(() => workspace.value?.employees.filter(employee => selectedDescendants.value.has(employee.departmentId)) ?? [])
const visibleMembers = computed(() => { const query = memberSearch.value.trim().toLowerCase(); return members.value.filter(employee => !query || [employee.name, employee.code, employee.email, employee.jobTitle, employee.phone].some(value => value?.toLowerCase().includes(query))) })
const selectableMembers = computed(() => visibleMembers.value.slice(0, 100))
const allMembersChecked = computed(() => selectableMembers.value.length > 0 && selectableMembers.value.every(employee => checkedMembers.value.includes(employee.id)))
function checkAll(event: Event) { checkedMembers.value = (event.target as HTMLInputElement).checked ? selectableMembers.value.map(employee => employee.id) : [] }
watch([selectedId, memberSearch], () => { checkedMembers.value = [] })
const directMembers = computed(() => workspace.value?.employees.filter(employee => employee.departmentId === selectedId.value) ?? [])
const parentOptions = computed(() => nodes.value.filter(node => creating.value || !selectedDescendants.value.has(node.id)))
const deleteBlockedReason = computed(() => {
  if (!workspace.value?.canEdit) return text('仅系统管理员可删除部门。', 'Only system administrators can delete departments.')
  if (!selected.value?.parentId) return text('根组织不可删除。', 'The root organization cannot be deleted.')
  const childCount = children(selectedId.value).length
  const memberCount = directMembers.value.length
  if (selected.value?.archivedEmployeeCount) return text(`保留 ${selected.value.archivedEmployeeCount} 名历史成员记录，该部门暂不能删除。`, `${selected.value.archivedEmployeeCount} historical member records are retained; this department cannot be deleted.`)
  if (childCount && memberCount) return text(`有 ${memberCount} 名直属成员、${childCount} 个下级部门，请先调整归属后再删除。`, `Move ${memberCount} direct members and ${childCount} child departments before deleting.`)
  if (memberCount) return text(`有 ${memberCount} 名直属成员，请先调入其他部门后再删除。`, `Move ${memberCount} direct members to another department before deleting.`)
  if (childCount) return text(`有 ${childCount} 个下级部门，请先移动或删除下级部门。`, `Move or delete ${childCount} child departments first.`)
  return ''
})
const canDelete = computed(() => !!selected.value && !deleteBlockedReason.value)
function select(node: OrganizationNode) {
  selectedId.value = node.id
  creating.value = false
  confirmDelete.value = false
  Object.assign(draft, { name: node.name, parentId: node.parentId ?? '', sortOrder: node.sortOrder })
}
function accept(data: OrganizationWorkspace, preferredId = selectedId.value) {
  workspace.value = data
  checkedMembers.value = []
  const next = data.nodes.find(node => node.id === preferredId) ?? data.nodes.find(node => node.parentId === null)
  if (next) select(next)
}
async function load() {
  const id = ++requestId
  busy.value = true
  error.value = ''
  workspace.value = undefined
  try {
    const data = await getOrganization()
    if (id === requestId) accept(data, typeof route.query.node === 'string' ? route.query.node : selectedId.value)
  } catch { if (id === requestId) error.value = text('组织架构加载失败，请重试。', 'Unable to load the organization. Please retry.') }
  finally { if (id === requestId) busy.value = false }
}
async function mutate(operation: () => Promise<OrganizationWorkspace>, message: string, preferred?: (data: OrganizationWorkspace) => string | undefined, deleting = false) {
  if (busy.value) return
  const id = ++requestId
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    const data = await operation()
    if (id !== requestId) return
    accept(data, preferred?.(data) ?? selectedId.value)
    success.value = message
  } catch (cause) {
    if (id !== requestId) return
    const conflict = typeof cause === 'object' && cause !== null && 'statusCode' in cause && cause.statusCode === 409
    error.value = deleting ? (conflict ? text('删除失败：部门仍有成员或下级部门，请刷新后核对。', 'Deletion failed: the department has members or child departments. Refresh to check.') : text('删除失败，服务器未确认变更，请刷新后重试。', 'The server could not confirm deletion. Refresh and retry.')) : conflict ? text('无法保存：请检查重复名称、层级循环，或先迁移子部门和成员。', 'Unable to save. Check duplicate names, circular hierarchy or remaining child departments and members.') : text('保存失败，服务器未确认变更，请刷新后重试。', 'The server could not confirm this change. Refresh and retry.')
  } finally { if (id === requestId) busy.value = false }
}
function startCreate() {
  if (!selected.value) return
  creating.value = true
  confirmDelete.value = false
  Object.assign(draft, { name: '', parentId: selectedId.value, sortOrder: children(selectedId.value).length * 10 + 10 })
}
function save() {
  if (!selected.value || !draft.name.trim()) return
  const input = { name: draft.name.trim(), sortOrder: draft.sortOrder, ...(draft.parentId ? { parentId: draft.parentId } : {}) }
  if (creating.value) {
    const existing = new Set(nodes.value.map(node => node.id))
    return mutate(() => createOrganizationNode({ ...input, parentId: draft.parentId }), text('部门已创建。', 'Department created.'), data => data.nodes.find(node => !existing.has(node.id))?.id)
  }
  return mutate(() => updateOrganizationNode(selectedId.value, input), text('组织架构已保存。', 'Organization saved.'))
}
function remove() {
  if (!canDelete.value) return
  const id = selectedId.value
  const parentId = selected.value!.parentId!
  return mutate(() => deleteOrganizationNode(id), text('部门已删除。', 'Department deleted.'), () => parentId, true)
}
function moveMember(id: string, event: Event) {
  const input = event.target as HTMLSelectElement
  const departmentId = input.value
  input.value = workspace.value!.employees.find(employee => employee.id === id)!.departmentId
  return mutate(() => moveOrganizationEmployee(id, departmentId), text('成员归属已更新；相关演示订单和图表将在刷新后同步。', 'Member assignment updated. Refresh demo orders and charts to see the change.'))
}
watch(() => route.query.node, value => { const node = nodes.value.find(item => item.id === value); if (node) select(node) })
onMounted(load)
const offSession = onSessionReset(() => { requestId++; workspace.value = undefined; employeeDialog.value = false; importDialog.value = false; activeAccountId.value = ''; removalIds.value = [] })
onBeforeUnmount(() => { requestId++; offSession() })
</script>

<template>
  <AppLayout><main class="app-page org-page">
    <header class="org-heading"><div><p class="page-eyebrow">HYPERZONE · ORGANIZATION</p><h1 class="page-title">{{ text('组织架构', 'Organization') }} <span class="demo-badge">MOCK</span></h1></div><div class="department-actions"><button class="btn btn-secondary" :disabled="busy" @click="load"><RefreshCw :size="15" />{{ text('刷新', 'Refresh') }}</button></div></header>
    <p v-if="error" role="alert" class="notice border-red-500 bg-red-50 text-red-700">{{ error }}</p><p v-if="success" role="status" class="notice border-emerald-500 bg-emerald-50 text-emerald-700">{{ success }}</p>
    <div class="org-stats"><article><Building2 :size="19" /><div><strong>{{ root?.name ?? '—' }}</strong><span>{{ text('所属组织', 'Organization') }}</span></div></article><article><GitBranch :size="19" /><div><strong>{{ workspace ? nodes.length - 1 : '—' }}</strong><span>{{ text('自定义部门', 'Departments') }}</span></div></article><article><Users :size="19" /><div><strong>{{ workspace?.employees.length ?? '—' }}</strong><span>{{ text('员工', 'Employees') }}</span></div></article></div>
    <p v-if="!workspace" class="panel empty-state">{{ busy ? text('正在加载组织…', 'Loading organization…') : text('暂时无法显示组织架构', 'Organization unavailable') }}</p>
    <div v-else class="org-layout" :aria-busy="busy">
      <section class="panel org-tree"><div class="tree-heading"><strong>{{ text('组织目录', 'Directory') }}</strong><button class="text-xs text-indigo-600" @click="collapsed = new Set()">{{ text('全部展开', 'Expand all') }}</button></div>
        <label class="tree-search"><Search :size="15" /><input v-model="search" type="search" :aria-label="text('搜索部门', 'Search departments')" :placeholder="text('搜索组织或部门', 'Search organization or department')" /></label>
        <div class="tree-scroll" role="tree" :aria-label="text('组织树', 'Organization tree')">
          <div v-for="row in rows" :key="row.node.id" class="tree-row" role="treeitem" :aria-level="row.depth + 1" :aria-selected="selectedId === row.node.id" :aria-expanded="row.hasChildren ? !collapsed.has(row.node.id) : undefined" :style="{ paddingLeft: `${10 + row.depth * 18}px` }" :class="{ selected: selectedId === row.node.id }">
            <button v-if="row.hasChildren" class="tree-toggle" :aria-label="`${collapsed.has(row.node.id) ? text('展开', 'Expand') : text('折叠', 'Collapse')} ${row.node.name}`" @click="collapsed.has(row.node.id) ? collapsed.delete(row.node.id) : collapsed.add(row.node.id)"><component :is="collapsed.has(row.node.id) ? ChevronRight : ChevronDown" :size="14" /></button><span v-else class="tree-toggle" />
            <button class="tree-node" :disabled="busy" :data-node="row.node.id" @click="select(row.node)"><component :is="row.node.kind === 'organization' ? Building2 : Folder" :size="17" /><span>{{ row.node.name }}</span></button>
          </div><p v-if="!rows.length" class="p-5 text-xs text-slate-500">{{ text('没有匹配部门', 'No matching departments') }}</p>
        </div>
        <footer>{{ text('支持多级部门与自定义排序', 'Supports nested departments and custom ordering') }}</footer>
      </section>
      <div v-if="selected" class="org-content">
        <section class="panel">
          <div class="panel-header org-node-header">
            <div><p class="text-xs text-slate-400">{{ path(selected) }}</p><h2 class="mt-2 text-lg font-bold">{{ creating ? text('新增子部门', 'New department') : selected.name }}</h2></div>
            <div v-if="workspace.canEdit && !creating" class="department-actions">
              <button class="btn btn-secondary" :disabled="busy" @click="startCreate"><Plus :size="15" />{{ text('新增子部门', 'Add department') }}</button>
              <button v-if="selected.parentId" type="button" class="btn department-delete" :disabled="busy || !canDelete" :title="deleteBlockedReason || text('删除空部门', 'Delete empty department')" :aria-describedby="deleteBlockedReason ? 'department-delete-hint' : undefined" @click="confirmDelete = true"><Trash2 :size="15" />{{ text('删除部门', 'Delete department') }}</button>
            </div>
            <p v-if="!creating && selected.parentId && workspace.canEdit" id="department-delete-hint" class="department-delete-hint">{{ deleteBlockedReason || text('无成员、无下级部门，可删除。', 'No members or child departments. This department can be deleted.') }}</p>
          </div>
          <div v-if="confirmDelete" class="delete-confirmation" role="group" :aria-label="text('删除部门确认', 'Confirm department deletion')">
            <p>{{ text(`确认删除空部门“${selected.name}”？`, `Delete the empty department “${selected.name}”?`) }}</p>
            <div class="department-actions"><button type="button" class="btn btn-secondary" data-action="cancel-delete" :disabled="busy" @click="confirmDelete = false">{{ text('取消', 'Cancel') }}</button><button type="button" class="btn department-delete" :disabled="busy" @click="remove">{{ text('确认删除', 'Confirm deletion') }}</button></div>
          </div>
          <form class="org-form" @submit.prevent="save"><label><span class="field-label">{{ text('名称', 'Name') }}</span><input v-model="draft.name" class="input" required maxlength="80" :disabled="busy || !workspace.canEdit" :aria-label="text('部门名称', 'Department name')" /></label><label><span class="field-label">{{ text('上级部门', 'Parent department') }}</span><select v-model="draft.parentId" class="input" :disabled="busy || !workspace.canEdit || (!creating && !selected.parentId)" :aria-label="text('上级部门', 'Parent department')"><option v-if="!creating && !selected.parentId" value="">{{ text('根组织', 'Root organization') }}</option><option v-for="node in parentOptions" :key="node.id" :value="node.id">{{ path(node) }}</option></select></label><label><span class="field-label">{{ text('同级排序', 'Sibling order') }}</span><input v-model.number="draft.sortOrder" type="number" min="0" max="10000" step="1" class="input" :disabled="busy || !workspace.canEdit" :aria-label="text('同级排序', 'Sibling order')" /><span class="field-help">{{ text('数值越小越靠前', 'Lower numbers appear first') }}</span></label><div class="form-actions"><button class="btn btn-primary" :disabled="busy || !workspace.canEdit">{{ creating ? text('创建部门', 'Create department') : text('保存修改', 'Save changes') }}</button><button v-if="creating" type="button" class="btn btn-secondary" :disabled="busy" @click="select(selected)">{{ text('取消', 'Cancel') }}</button></div></form>
        </section>
        <section class="panel overflow-hidden">
          <div class="panel-header member-header"><div><h2 class="panel-title">{{ text('部门成员', 'Department members') }} <span class="text-slate-400">{{ members.length }}</span></h2></div>
          <div v-if="workspace.canEdit" class="department-actions"><button class="btn btn-primary" data-add-member :disabled="busy || selected.kind !== 'department'" :title="selected.kind !== 'department' ? text('请先选择部门', 'Select a department first') : undefined" @click="addEmployee()"><Plus :size="15" />{{ text('添加成员', 'Add member') }}</button><button class="btn btn-secondary" data-import-members :disabled="busy || selected.kind !== 'department'" @click="importDialog = true">{{ text('批量导入', 'Import members') }}</button><button class="btn department-delete" data-remove-selected :disabled="busy || !checkedMembers.length" @click="confirmMemberRemoval(checkedMembers)"><Trash2 :size="15" />{{ text('删除所选', 'Remove selected') }}<span v-if="checkedMembers.length">({{ checkedMembers.length }})</span></button></div></div>
          <div class="member-search"><Search :size="15" /><input v-model="memberSearch" class="input" type="search" :aria-label="text('搜索部门成员', 'Search department members')" :placeholder="text('搜索姓名、编号、邮箱、职务或手机', 'Name, code, email, job title or phone')" /></div>
          <div class="overflow-x-auto"><table class="data-table min-w-[1050px]"><thead><tr><th class="w-10"><input type="checkbox" :checked="allMembersChecked" :disabled="!visibleMembers.length || busy" :aria-label="visibleMembers.length > 100 ? text('选择前100名成员', 'Select first 100 members') : text('全选当前成员', 'Select visible members')" @change="checkAll" /></th><th>{{ text('员工', 'Employee') }}</th><th>{{ text('职务 / 手机', 'Job title / phone') }}</th><th>{{ text('所属部门', 'Department') }}</th><th>{{ text('岗位档案', 'Employee roles') }}</th><th>{{ text('成员与账号操作', 'Member and account actions') }}</th></tr></thead><tbody><tr v-for="employee in visibleMembers" :key="employee.id" :data-member-id="employee.id"><td><input v-model="checkedMembers" type="checkbox" :value="employee.id" :disabled="busy || (checkedMembers.length >= 100 && !checkedMembers.includes(employee.id))" :aria-label="`${text('选择', 'Select')} ${employee.name}`" /></td><td><div class="flex items-center gap-3"><span class="employee-avatar">{{ employee.name.slice(0, 1) }}</span><div><strong>{{ employee.name }}</strong><p class="text-xs text-slate-400">{{ employee.code }} · {{ employee.email }}</p></div></div></td><td><p>{{ employee.jobTitle || '—' }}</p><p class="mt-1 text-xs text-slate-400">{{ employee.phone || '—' }}</p></td><td><select class="input min-w-36 max-w-64" :value="employee.departmentId" :disabled="busy || !workspace.canEdit" :aria-label="`${employee.name} · ${text('所属部门', 'department')}`" @change="moveMember(employee.id, $event)"><option v-for="node in nodes.filter(item => item.kind === 'department')" :key="node.id" :value="node.id">{{ path(node) }}</option></select></td><td><span v-for="role in employee.workbenchRoles" :key="role" class="role-pill">{{ workbenchNames[role]?.[zh ? 0 : 1] ?? role }}</span><span v-if="!employee.workbenchRoles.length" class="text-xs text-slate-400">—</span></td><td><div v-if="workspace.canEdit" class="member-row-actions"><button type="button" data-edit-member :disabled="busy" @click="addEmployee(employee, true)">{{ text('编辑信息', 'Edit member') }}</button><button v-if="employee.accountId" type="button" data-edit-account :disabled="busy" @click="activeAccountId = employee.accountId">{{ text('编辑账号', 'Edit account') }}</button><button v-else type="button" :disabled="busy" @click="addEmployee(employee)">{{ text('开通账号', 'Create login') }}</button><RouterLink v-if="employee.accountId" :to="{ path: '/admin/workbenches', query: { search: employee.email } }">{{ text('分配权限', 'Assign access') }}</RouterLink><button type="button" class="text-red-500" :disabled="busy" @click="confirmMemberRemoval([employee.id])">{{ text('删除', 'Remove') }}</button></div></td></tr></tbody></table><p v-if="!visibleMembers.length" class="empty-state">{{ memberSearch ? text('没有匹配的成员。', 'No matching members.') : text('该部门暂无成员，可添加或批量导入。', 'Add members or import a file to get started.') }}</p></div>
        </section>
      </div>
    </div>
  </main><EmployeeAccountDialog v-if="employeeDialog && workspace" :workspace="workspace" :department-id="selected?.kind === 'department' ? selectedId : undefined" :employee="accountEmployee" :edit="editingEmployee" @close="employeeDialog = false" @saved="employeeCreated" />
  <EmployeeImportDialog v-if="importDialog && selected" :department-id="selectedId" :department-name="path(selected)" @close="importDialog = false" @saved="memberImported" />
  <EmployeeLoginDialog v-if="activeAccountId" :account-id="activeAccountId" @close="activeAccountId = ''" @saved="accountSaved" />
  <OrganizationModal v-if="removalIds.length" :title="text('删除部门成员', 'Remove department members')" :busy="removingMembers" @close="removalIds = []"><p class="text-sm leading-7">{{ text(`将删除 ${removalIds.length} 名成员并停用其登录账号，已有登录会话将失效。历史业务记录保留。`, `Remove ${removalIds.length} members and disable their logins. Active sessions will expire; historical business records are retained.`) }}</p><ul class="my-4 text-sm leading-7"><li v-for="id in removalIds" :key="id">{{ workspace?.employees.find(employee => employee.id === id)?.name }}</li></ul><p v-if="memberError" role="alert" class="org-error">{{ memberError }}</p><template #footer><button class="btn btn-secondary" :disabled="removingMembers" @click="removalIds = []">{{ text('取消', 'Cancel') }}</button><button class="btn department-delete" data-confirm-remove-members :disabled="removingMembers" @click="removeMembers">{{ text('确认删除成员', 'Confirm removal') }}</button></template></OrganizationModal>
  </AppLayout>
</template>

<style scoped>
.member-header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px}.member-search{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--color-border);color:var(--color-text-secondary)}.member-search .input{max-width:var(--query-search-width)}.member-row-actions{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#667db9}.member-row-actions button:hover,.member-row-actions a:hover{text-decoration:underline}
.org-node-header { flex-wrap:wrap; gap:16px; }
.department-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.department-delete { color:#b63d4b; background:#fff5f5; border:1px solid #efcbd0; }
.department-delete:hover:not(:disabled) { background:#ffe8eb; border-color:#dfa0a9; }
.department-delete:disabled { opacity:.5; cursor:not-allowed; }
.department-delete-hint { flex-basis:100%; color:var(--color-text-secondary); font-size:12px; line-height:1.6; }
.delete-confirmation { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px; margin:18px 22px 0; padding:14px 16px; background:#fff5f5; border:1px solid #efcbd0; border-radius:8px; font-size:13px; color:#a13342; }

.org-heading { display:flex; justify-content:space-between; gap:20px; align-items:center; margin-bottom:24px; }.demo-badge { display:inline-block; vertical-align:middle; font-size:10px; line-height:1.3; font-weight:700; letter-spacing:.08em; border:1px solid #f4d59a; background:#fff8e8; color:#ae7616; padding:4px 8px; border-radius:5px; margin-left:10px; }.org-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:20px 0; }.org-stats article { display:flex; align-items:center; gap:14px; padding:18px; border:1px solid var(--color-border); border-radius:8px; background:var(--color-surface); }.org-stats svg { color:#5873d4; }.org-stats strong,.org-stats span { display:block; }.org-stats strong { font-size:20px; }.org-stats span { font-size:11px; color:var(--color-text-secondary); margin-top:4px; }.org-layout { display:grid; grid-template-columns:300px minmax(0,1fr); gap:20px; align-items:start; }.org-tree { overflow:hidden; }.tree-heading { display:flex; justify-content:space-between; padding:18px 16px; font-size:13px; }.tree-search { display:flex; align-items:center; gap:7px; margin:0 12px 12px; padding:9px; border:1px solid var(--color-border); border-radius:6px; color:#8490a3; }.tree-search input { min-width:0; width:100%; font-size:12px; background:transparent; color:var(--color-text); }.tree-scroll { max-height:650px; overflow:auto; padding:0 8px 12px; }.tree-row { display:flex; align-items:center; border-radius:6px; margin:2px 0; min-height:38px; }.tree-row.selected { background:#5873d414; color:#4164c8; }.tree-toggle { width:20px; flex-shrink:0; color:#8e99aa; }.tree-node { display:flex; align-items:center; gap:8px; padding:9px 6px; text-align:left; min-width:0; flex:1; font-size:13px; }.tree-node svg { flex-shrink:0; color:#78a8eb; }.tree-node span { white-space:nowrap; }.org-tree footer { border-top:1px solid var(--color-border); padding:12px 16px; font-size:10px; color:#8e99aa; }.org-content { display:grid; gap:20px; min-width:0; }.org-form { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:18px; padding:22px; }.form-actions { display:flex; align-items:center; gap:10px; grid-column:1/-1; }.employee-avatar { display:flex; align-items:center; justify-content:center; width:33px; height:33px; border-radius:50%; background:#5873d414; color:#5873d4; font-size:12px; }.role-pill { display:inline-block; white-space:nowrap; padding:3px 6px; margin:2px; border-radius:4px; background:#14b8a614; color:#159b88; font-size:10px; }.notice { margin:12px 0; }@media(max-width:1000px){.org-layout{grid-template-columns:245px minmax(0,1fr)}.org-form{grid-template-columns:1fr}}@media(max-width:760px){.org-layout{grid-template-columns:1fr}.tree-scroll{max-height:340px}.org-stats{gap:8px}.org-stats article{padding:12px}.org-stats svg{display:none}.org-stats strong{font-size:17px}.org-heading{align-items:flex-start}}
</style>

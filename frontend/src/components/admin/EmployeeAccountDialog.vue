<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { UserPlus, X } from 'lucide-vue-next'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'
import { createEmployeeAccount, createOrganizationEmployee, updateOrganizationEmployee, getOrganization, type OrganizationEmployee, type OrganizationNode, type OrganizationWorkspace } from '@/api/organization'
import { workbenchNames, workbenchRoles, type WorkbenchRole } from '@/utils/workbench'
import { installSelectDropdowns } from '@/utils/selectDropdowns'

const props = defineProps<{ workspace?: OrganizationWorkspace; departmentId?: string; employee?: OrganizationEmployee; edit?: boolean }>()
const emit = defineEmits<{ close: []; saved: [result: { workspace: OrganizationWorkspace; employee: OrganizationEmployee }] }>()
const { locale } = useI18n()
const zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const titleId = useId(), dialog = ref<HTMLDialogElement>()
const directory = ref(props.workspace), loading = ref(false), saving = ref(false), error = ref('')
const createLogin = ref(!props.edit), bindFop = ref(false)
const draft = reactive({ name: props.employee?.name ?? '', code: props.employee?.code ?? '', email: props.employee?.email ?? '', departmentId: props.employee?.departmentId ?? props.departmentId ?? '',
  workbenchRoles: [...(props.employee?.workbenchRoles ?? ['sales'])] as WorkbenchRole[], jobTitle: props.employee?.jobTitle ?? '', phone: props.employee?.phone ?? '', username: '', password: '', confirmPassword: '', tenantId: '', userId: '' })
const title = computed(() => props.edit ? text('编辑成员信息', 'Edit member') : props.employee ? text('开通员工账号', 'Open employee account') : text('添加部门成员', 'Add department member'))
const departments = computed(() => directory.value?.nodes.filter(node => node.kind === 'department') ?? [])
let active = true, opener: HTMLElement | undefined
let disposeDropdowns: (() => void) | undefined
function departmentPath(node: OrganizationNode): string {
  const names = [node.name], visited = new Set([node.id])
  let parent = directory.value?.nodes.find(item => item.id === node.parentId)
  while (parent && !visited.has(parent.id)) { visited.add(parent.id); names.unshift(parent.name); parent = directory.value?.nodes.find(item => item.id === parent!.parentId) }
  return names.join(' / ')
}
function clearPasswords() { draft.password = ''; draft.confirmPassword = '' }
watch(createLogin, value => { if (!value) { clearPasswords(); bindFop.value = false } })
async function load() {
  loading.value = true; error.value = ''
  try { const result = await getOrganization(); if (active) directory.value = result }
  catch { if (active) error.value = text('部门加载失败，请确认管理员权限后重试。', 'Unable to load departments. Check administrator access and retry.') }
  finally { if (active) loading.value = false }
}
async function save() {
  if (saving.value || loading.value || !directory.value?.canEdit) return
  error.value = ''
  if (!draft.name.trim() || !draft.code.trim() || !draft.email.trim() || !departments.value.some(node => node.id === draft.departmentId)) { error.value = text('请填写员工信息并选择所属部门。', 'Complete the employee details and choose a department.'); return }
  if (createLogin.value) {
    if (draft.username.trim().length < 2 || draft.password.length < 10 || new TextEncoder().encode(draft.password).length > 72) { error.value = text('登录名称至少2个字符；初始密码至少10个字符，UTF-8长度不超过72字节。', 'Use at least 2 characters for the login name and 10 characters for the password (up to 72 UTF-8 bytes).'); return }
    if (draft.password !== draft.confirmPassword) { error.value = text('两次密码不一致，请重新输入。', 'The passwords do not match.'); return }
    if (bindFop.value && (!draft.tenantId.trim() || !draft.userId.trim())) { error.value = text('请完整填写 FOP 租户 ID 和用户 ID。', 'Enter both the FOP tenant and user IDs.'); return }
  }
  const account = createLogin.value ? { username: draft.username.trim(), password: draft.password, fopBinding: bindFop.value ? { tenantId: draft.tenantId.trim(), userId: draft.userId.trim() } : null } : null
  saving.value = true
  const session = captureSession()
  try {
    const profile = { name: draft.name.trim(), code: draft.code.trim(), email: draft.email.trim().toLowerCase(), departmentId: draft.departmentId, workbenchRoles: [...draft.workbenchRoles], jobTitle: draft.jobTitle.trim(), phone: draft.phone.trim() }
    const result = props.edit && props.employee ? await updateOrganizationEmployee(props.employee.id, profile) : props.employee && account ? await createEmployeeAccount(props.employee.id, account) : await createOrganizationEmployee({ ...profile, account })
    assertCurrentSession(session)
    if (!active) return
    const employee = result.employees.find(item => props.employee ? item.id === props.employee.id : item.code === draft.code.trim())
    if (!employee) throw new Error('Missing employee confirmation')
    clearPasswords()
    emit('saved', { workspace: result, employee })
  } catch (cause) {
    if (!active) return
    const failure = cause as { statusCode?: number; message?: unknown }
    error.value = failure.statusCode === 409 && typeof failure.message === 'string' ? failure.message : text('保存失败，请核对账号、员工信息及管理员权限后重试。', 'Save failed. Check employee details, account information and administrator access.')
  } finally { if (active) saving.value = false }
}
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  if (dialog.value?.showModal) dialog.value.showModal(); else dialog.value?.setAttribute('open', '')
  // Teleported forms sit outside #app; opt into the shared downward menu explicitly.
  const form = dialog.value?.querySelector('form')
  if (form) disposeDropdowns = installSelectDropdowns(form)
  if (!directory.value) void load()
})
const off = onSessionReset(() => { active = false; clearPasswords(); emit('close') })
onBeforeUnmount(() => { active = false; clearPasswords(); off(); disposeDropdowns?.(); dialog.value?.close?.(); if (opener?.isConnected) opener.focus({ preventScroll: true }) })
</script>

<template>
  <Teleport to="body"><dialog ref="dialog" class="employee-dialog" aria-modal="true" :aria-labelledby="titleId" @cancel.prevent="!saving && emit('close')">
    <header><div class="employee-dialog-title"><UserPlus :size="22" /><div><h2 :id="titleId">{{ title }}</h2><p>{{ text('员工归属、登录账号与 FOP 关联', 'Department, login and FOP identity') }}</p></div></div><button type="button" class="btn btn-secondary" :aria-label="text('关闭', 'Close')" :disabled="saving" @click="emit('close')"><X :size="17" /></button></header>
    <form @submit.prevent="save">
      <div class="employee-dialog-body">
        <p v-if="error" role="alert" class="employee-error">{{ error }}</p>
        <p v-if="loading" class="text-sm text-slate-500">{{ text('正在加载部门…', 'Loading departments…') }}</p>
        <button v-if="!loading && !directory" type="button" class="btn btn-secondary" @click="load">{{ text('重新加载部门', 'Retry loading departments') }}</button>
        <fieldset :disabled="saving || loading || !directory?.canEdit">
          <legend>{{ text('员工信息', 'Employee details') }}</legend>
          <div class="employee-fields">
            <label><span class="field-label">{{ text('员工姓名', 'Employee name') }}</span><input v-model="draft.name" class="input" :aria-label="text('员工姓名', 'Employee name')" maxlength="100" required :disabled="!!employee && !edit" :placeholder="text('中文名（English name）', 'Full name')" /></label>
            <label><span class="field-label">{{ text('员工编号', 'Employee code') }}</span><input v-model="draft.code" class="input" :aria-label="text('员工编号', 'Employee code')" maxlength="40" required :disabled="!!employee && !edit" placeholder="HZ001" /></label>
            <label><span class="field-label">{{ text('员工邮箱', 'Employee email') }}</span><input v-model="draft.email" type="email" class="input" :aria-label="text('员工邮箱', 'Employee email')" maxlength="160" required :disabled="!!employee && !edit" autocomplete="off" /><span class="field-help">{{ text('开通账号后使用此邮箱登录', 'Use this email to sign in') }}</span></label>
            <label><span class="field-label">{{ text('所属部门', 'Department') }}</span><select v-model="draft.departmentId" class="input" :aria-label="text('所属部门', 'Department')" required :disabled="!!employee && !edit"><option disabled value="">{{ text('请选择部门', 'Choose a department') }}</option><option v-for="node in departments" :key="node.id" :value="node.id">{{ departmentPath(node) }}</option></select></label>
            <label><span class="field-label">{{ text('职务', 'Job title') }}</span><input v-model="draft.jobTitle" class="input" :aria-label="text('职务', 'Job title')" maxlength="100" :disabled="!!employee && !edit" /></label>
            <label><span class="field-label">{{ text('手机', 'Phone') }}</span><input v-model="draft.phone" class="input" :aria-label="text('手机', 'Phone')" maxlength="40" :disabled="!!employee && !edit" /></label>
          </div>
          <p v-if="edit" class="employee-note">{{ text('修改员工岗位档案不会改变账号权限；请在账号权限中独立分配。邮箱修改会同步到登录账号。', 'Employee roles do not change account grants. Email changes also update the login account.') }}</p>
          <p class="field-label mt-4">{{ text('工作台岗位', 'Workbench roles') }}</p><div class="employee-roles"><label v-for="role in workbenchRoles" :key="role"><input v-model="draft.workbenchRoles" type="checkbox" :value="role" :disabled="!!employee && !edit" />{{ workbenchNames[role][zh ? 0 : 1] }}</label></div>
        </fieldset>
        <fieldset v-if="!edit" :disabled="saving || loading || !directory?.canEdit">
          <legend>{{ text('登录账号', 'Login account') }}</legend>
          <label v-if="!employee" class="employee-check"><input v-model="createLogin" type="checkbox" :aria-label="text('同时开通登录账号', 'Create a login account')" />{{ text('同时开通登录账号', 'Create a login account') }}</label>
          <template v-if="createLogin">
            <p class="employee-note">{{ text('默认普通员工账号，仅查看本人业务数据。管理员可在“账号与权限”中另行调整角色和数据范围。', 'New accounts are standard employees with access to their own records. Administrators can adjust roles and data access in Account & Access.') }}</p>
            <label class="block mb-4"><span class="field-label">{{ text('登录名称', 'Login name') }}</span><input v-model="draft.username" class="input" :aria-label="text('登录名称', 'Login name')" minlength="2" maxlength="50" autocomplete="off" required /></label>
            <div class="employee-fields"><label><span class="field-label">{{ text('初始密码', 'Initial password') }}</span><input v-model="draft.password" type="password" class="input" :aria-label="text('初始密码', 'Initial password')" minlength="10" maxlength="72" autocomplete="new-password" required /></label><label><span class="field-label">{{ text('确认初始密码', 'Confirm initial password') }}</span><input v-model="draft.confirmPassword" type="password" class="input" :aria-label="text('确认初始密码', 'Confirm initial password')" minlength="10" maxlength="72" autocomplete="new-password" required /></label></div>
            <label class="employee-check mt-5"><input v-model="bindFop" type="checkbox" :aria-label="text('同时绑定 FOP 用户', 'Link FOP user now')" />{{ text('同时绑定 FOP 用户', 'Link FOP user now') }}<span class="text-xs text-slate-400">{{ text('可稍后设置', 'Optional') }}</span></label>
            <div v-if="bindFop" class="employee-fields mt-4"><label><span class="field-label">FOP {{ text('租户 ID', 'tenant ID') }}</span><input v-model="draft.tenantId" class="input" :aria-label="text('FOP 租户 ID', 'FOP tenant ID')" maxlength="128" autocomplete="off" required /></label><label><span class="field-label">FOP {{ text('用户 ID', 'user ID') }}</span><input v-model="draft.userId" class="input" :aria-label="text('FOP 用户 ID', 'FOP user ID')" maxlength="128" autocomplete="off" required /></label></div>
            <p class="employee-note">{{ text('关联 FOP 已有用户，不会创建后台用户。绑定信息保存后，仍需完成后台身份映射及数据授权。', 'Link an existing FOP user; this does not create a backend user. Identity mapping and FOP data authorization are still required.') }}</p>
          </template>
        </fieldset>
      </div>
      <footer><button type="button" class="btn btn-secondary" :disabled="saving" @click="emit('close')">{{ text('取消', 'Cancel') }}</button><button class="btn btn-primary" :disabled="saving || loading || !directory?.canEdit">{{ saving ? text('正在保存…', 'Saving…') : edit ? text('保存成员信息', 'Save member') : employee ? text('开通账号', 'Create login') : createLogin ? text('创建员工与账号', 'Create employee and login') : text('创建员工', 'Create employee') }}</button></footer>
    </form>
  </dialog></Teleport>
</template>

<style scoped>
.employee-dialog{position:fixed;inset:0;margin:auto;width:min(760px,calc(100vw - 32px));max-height:calc(100dvh - 40px);padding:0;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);color:var(--color-text);box-shadow:0 24px 70px #18263c30;overflow:auto}.employee-dialog::backdrop{background:#16273e66;backdrop-filter:blur(2px)}.employee-dialog header,.employee-dialog footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:20px 24px;background:var(--color-surface)}.employee-dialog header{border-bottom:1px solid var(--color-border)}.employee-dialog-title{display:flex;align-items:center;gap:12px}.employee-dialog-title svg{color:#788fca}.employee-dialog h2{font-size:18px;font-weight:650}.employee-dialog header p{font-size:12px;color:var(--color-text-secondary);margin-top:4px}.employee-dialog-body{padding:20px 24px}.employee-dialog fieldset+fieldset{border-top:1px solid var(--color-border);margin-top:22px;padding-top:22px}.employee-dialog legend{font-weight:600;font-size:14px;margin-bottom:16px}.employee-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.employee-roles{display:flex;gap:10px 18px;flex-wrap:wrap;font-size:12px}.employee-roles label,.employee-check{display:flex;align-items:center;gap:8px}.employee-check{font-size:13px}.employee-note{font-size:12px;line-height:1.7;color:var(--color-text-secondary);margin:12px 0}.employee-error{font-size:13px;line-height:1.6;color:#b53b49;background:#fff2f3;padding:12px;border-radius:8px;margin-bottom:16px}.employee-dialog footer{position:sticky;bottom:0;border-top:1px solid var(--color-border);justify-content:flex-end}.employee-dialog input[type=checkbox]{accent-color:#7088c4}.employee-dialog .input{width:100%;min-width:0}@media(max-width:600px){.employee-fields{grid-template-columns:1fr}.employee-dialog header,.employee-dialog footer,.employee-dialog-body{padding:16px}}
</style>

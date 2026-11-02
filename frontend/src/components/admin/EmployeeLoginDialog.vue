<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getEmployeeLogin, updateEmployeeLogin, type EmployeeLogin } from '@/api/organization'
import { bindFopEmployee, unbindFopEmployee, fopAccessError } from '@/api/fop-access'
import { captureSession, assertCurrentSession, onSessionReset } from '@/utils/session'
import OrganizationModal from './OrganizationModal.vue'
import KingdeeEmployeePicker from './KingdeeEmployeePicker.vue'
const props = defineProps<{ accountId: string }>(), emit = defineEmits<{ close: []; saved: [] }>()
const { locale } = useI18n(), zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const loading = ref(true), saving = ref(false), error = ref(''), loaded = ref(false), bindingBusy = ref(false), bindingMessage = ref('')
const account = ref<EmployeeLogin>(), selectedEmployee = ref<{ employeeId: string; membershipId: string } | null>(null)
const draft = reactive({ username: '', email: '', password: '', confirmPassword: '' })
let active = true
async function load() {
  loading.value = true; error.value = ''; const session = captureSession(), targetId = props.accountId
  try {
    const result = await getEmployeeLogin(targetId); assertCurrentSession(session)
    if (active && targetId === props.accountId) { account.value = result; Object.assign(draft, { username: result.username, email: result.email }); loaded.value = true }
  } catch { if (active && targetId === props.accountId) error.value = text('账号资料加载失败，请核对管理权限后重试。', 'Unable to load account details. Check access and retry.') }
  finally { if (active && targetId === props.accountId) loading.value = false }
}
async function save() {
  if (saving.value || bindingBusy.value || !loaded.value) return
  error.value = ''
  if (draft.password && (draft.password.length < 10 || new TextEncoder().encode(draft.password).length > 72 || draft.password !== draft.confirmPassword)) { error.value = text('新密码至少10个字符、最多72字节，两次输入需一致。', 'Use a matching password of 10 or more characters and at most 72 UTF-8 bytes.'); return }
  if (!draft.password && draft.confirmPassword) { error.value = text('请输入新密码。', 'Enter the new password.'); return }
  saving.value = true; const session = captureSession(), targetId = props.accountId
  try {
    // 账号资料保存不提交金蝶裸ID，避免编辑邮箱时覆盖独立保存的员工绑定。
    await updateEmployeeLogin(targetId, { username: draft.username.trim(), email: draft.email.trim().toLowerCase(), ...(draft.password ? { password: draft.password } : {}) })
    assertCurrentSession(session); if (active && targetId === props.accountId) emit('saved')
  } catch (cause) { if (active && targetId === props.accountId) error.value = (cause as {statusCode?: number;message?: string}).statusCode === 409 ? (cause as {message: string}).message : text('保存失败，请核对信息和权限后重试。', 'Save failed. Check details and access.') }
  finally { if (active && targetId === props.accountId) saving.value = false }
}
/** 只提交人员及任职ID；用户名、租户和认证主体由后端重新核验，不接收浏览器自报身份。 */
async function saveBinding(unlink = false) {
  if (saving.value || bindingBusy.value || !loaded.value || !unlink && !selectedEmployee.value) return
  saving.value = true; error.value = ''; bindingMessage.value = ''; const session = captureSession(), targetId = props.accountId
  try {
    const result = unlink ? await unbindFopEmployee(targetId) : await bindFopEmployee(targetId, selectedEmployee.value!.employeeId, selectedEmployee.value!.membershipId)
    assertCurrentSession(session)
    if (active && targetId === props.accountId) { account.value = result; selectedEmployee.value = null; bindingMessage.value = text('金蝶绑定已保存，该账号需重新登录后使用。', 'Kingdee binding saved. This account must sign in again.') }
  } catch (cause) { if (active && targetId === props.accountId) error.value = (cause as {statusCode?: number;message?: string}).statusCode === 409 ? (cause as {message: string}).message : fopAccessError(cause, zh.value) }
  finally { if (active && targetId === props.accountId) saving.value = false }
}
watch(() => props.accountId, () => { loaded.value = false; account.value = undefined; selectedEmployee.value = null; saving.value = false; bindingMessage.value = ''; draft.password = ''; draft.confirmPassword = ''; void load() })
onMounted(load)
const off = onSessionReset(() => { active = false; account.value = undefined; emit('close') })
onBeforeUnmount(() => { active = false; draft.password = ''; draft.confirmPassword = ''; off() })
</script>
<template>
  <OrganizationModal :title="text('编辑登录账号', 'Edit login account')" :busy="saving || bindingBusy" @close="emit('close')">
    <p v-if="error" class="org-error" role="alert">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">{{ text('正在加载…', 'Loading…') }}</p>
    <button v-else-if="!loaded" class="btn btn-secondary" @click="load">{{ text('重试', 'Retry') }}</button>
    <form id="employee-login-form" @submit.prevent="save"><fieldset :disabled="loading || saving || bindingBusy || !loaded"><div class="org-fields">
      <label><span class="field-label">{{ text('登录名称', 'Login name') }}</span><input v-model="draft.username" class="input" aria-label="登录名称" required minlength="2" maxlength="50" /></label>
      <label><span class="field-label">{{ text('登录邮箱', 'Login email') }}</span><input v-model="draft.email" class="input" aria-label="登录邮箱" type="email" required maxlength="160" /></label>
      <label><span class="field-label">{{ text('新密码（留空不修改）', 'New password (optional)') }}</span><input v-model="draft.password" class="input" aria-label="新密码" type="password" autocomplete="new-password" maxlength="72" /></label>
      <label><span class="field-label">{{ text('确认新密码', 'Confirm new password') }}</span><input v-model="draft.confirmPassword" class="input" aria-label="确认新密码" type="password" autocomplete="new-password" maxlength="72" /></label>
    </div><p class="mt-5 text-xs leading-6 text-slate-500">{{ text('邮箱与员工档案同步。修改密码后旧登录会话失效；角色与数据权限请在账号权限中分配。', 'Email is synchronized with the employee record. Resetting the password revokes previous sessions. Assign access on the permissions page.') }}</p></fieldset></form>
    <section v-if="loaded" class="mt-5 space-y-3 border-t pt-4" :aria-label="text('金蝶员工绑定', 'Kingdee employee binding')">
      <p class="field-label">{{ text('金蝶员工绑定', 'Kingdee employee binding') }}</p>
      <p v-if="account?.fopBindingDetails" class="text-sm">{{ account.fopBindingDetails.name }} · {{ account.fopBindingDetails.username }}</p>
      <p v-else class="text-sm text-slate-500">{{ account?.fopBinding ? text('原绑定尚未验证，请重新选择对应金蝶员工。', 'Verify the previous link by selecting the corresponding Kingdee employee.') : text('尚未绑定金蝶员工。', 'No Kingdee employee linked.') }}</p>
      <KingdeeEmployeePicker :key="accountId" v-model="selectedEmployee" :disabled="saving" @busy="bindingBusy = $event" />
      <div class="flex flex-wrap gap-3"><button type="button" class="btn btn-secondary" :disabled="saving || bindingBusy || !selectedEmployee" @click="saveBinding(false)">{{ text('验证并绑定金蝶员工', 'Verify and link Kingdee employee') }}</button><button v-if="account?.fopBinding" type="button" class="btn btn-secondary" :disabled="saving || bindingBusy" @click="saveBinding(true)">{{ text('解除金蝶绑定', 'Unlink Kingdee employee') }}</button></div>
      <p v-if="bindingMessage" role="status" class="text-sm text-emerald-600">{{ bindingMessage }}</p>
    </section>
    <template #footer><button class="btn btn-secondary" :disabled="saving || bindingBusy" @click="emit('close')">{{ text('取消', 'Cancel') }}</button><button form="employee-login-form" class="btn btn-primary" :disabled="loading || saving || bindingBusy || !loaded">{{ saving ? text('保存中…', 'Saving…') : text('保存账号资料', 'Save account') }}</button></template>
  </OrganizationModal>
</template>

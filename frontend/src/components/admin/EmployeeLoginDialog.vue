<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getEmployeeLogin, updateEmployeeLogin } from '@/api/organization'
import { captureSession, assertCurrentSession } from '@/utils/session'
import OrganizationModal from './OrganizationModal.vue'
const props = defineProps<{ accountId: string }>(), emit = defineEmits<{ close: []; saved: [] }>()
const { locale } = useI18n(), zh = computed(() => locale.value.startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const loading = ref(true), saving = ref(false), error = ref(''), loaded = ref(false)
const draft = reactive({ username: '', email: '', password: '', confirmPassword: '', tenantId: '', userId: '' })
let active = true
async function load() {
  loading.value = true; error.value = ''
  try { const result = await getEmployeeLogin(props.accountId); if (active) { Object.assign(draft, { username: result.username, email: result.email, tenantId: result.fopBinding?.tenantId ?? '', userId: result.fopBinding?.userId ?? '' }); loaded.value = true } }
  catch { if (active) error.value = text('账号资料加载失败，请核对管理权限后重试。', 'Unable to load account details. Check access and retry.') }
  finally { if (active) loading.value = false }
}
async function save() {
  if (saving.value || !loaded.value) return
  error.value = ''
  if (draft.password && (draft.password.length < 10 || new TextEncoder().encode(draft.password).length > 72 || draft.password !== draft.confirmPassword)) { error.value = text('新密码至少10个字符、最多72字节，两次输入需一致。', 'Use a matching password of 10 or more characters and at most 72 UTF-8 bytes.'); return }
  if (!draft.password && draft.confirmPassword) { error.value = text('请输入新密码。', 'Enter the new password.'); return }
  const tenantId = draft.tenantId.trim(), userId = draft.userId.trim()
  if (!!tenantId !== !!userId) { error.value = text('FOP 租户与用户 ID 必须同时填写或同时清空。', 'Provide both FOP IDs or clear both.'); return }
  saving.value = true; const session = captureSession()
  try { await updateEmployeeLogin(props.accountId, { username: draft.username.trim(), email: draft.email.trim().toLowerCase(), ...(draft.password ? { password: draft.password } : {}), fopBinding: tenantId ? { tenantId, userId } : null }); assertCurrentSession(session); if (active) emit('saved') }
  catch (cause) { if (active) error.value = (cause as {statusCode?: number;message?: string}).statusCode === 409 ? (cause as {message: string}).message : text('保存失败，请核对信息和权限后重试。', 'Save failed. Check details and access.') }
  finally { if (active) saving.value = false }
}
onMounted(load)
onBeforeUnmount(() => { active = false; draft.password = ''; draft.confirmPassword = '' })
</script>
<template><OrganizationModal :title="text('编辑登录账号', 'Edit login account')" :busy="saving" @close="emit('close')"><p v-if="error" class="org-error" role="alert">{{ error }}</p><p v-if="loading" class="text-sm text-slate-500">{{ text('正在加载…', 'Loading…') }}</p><button v-else-if="!loaded" class="btn btn-secondary" @click="load">{{ text('重试', 'Retry') }}</button><form id="employee-login-form" @submit.prevent="save"><fieldset :disabled="loading || saving || !loaded"><div class="org-fields"><label><span class="field-label">{{ text('登录名称', 'Login name') }}</span><input v-model="draft.username" class="input" aria-label="登录名称" required minlength="2" maxlength="50" /></label><label><span class="field-label">{{ text('登录邮箱', 'Login email') }}</span><input v-model="draft.email" class="input" aria-label="登录邮箱" type="email" required maxlength="160" /></label><label><span class="field-label">{{ text('新密码（留空不修改）', 'New password (optional)') }}</span><input v-model="draft.password" class="input" aria-label="新密码" type="password" autocomplete="new-password" maxlength="72" /></label><label><span class="field-label">{{ text('确认新密码', 'Confirm new password') }}</span><input v-model="draft.confirmPassword" class="input" aria-label="确认新密码" type="password" autocomplete="new-password" maxlength="72" /></label><label><span class="field-label">FOP {{ text('租户 ID', 'tenant ID') }}</span><input v-model="draft.tenantId" class="input" aria-label="FOP 租户 ID" maxlength="128" /></label><label><span class="field-label">FOP {{ text('用户 ID', 'user ID') }}</span><input v-model="draft.userId" class="input" aria-label="FOP 用户 ID" maxlength="128" /></label></div><p class="mt-5 text-xs leading-6 text-slate-500">{{ text('邮箱与员工档案同步。修改密码后旧登录会话失效；FOP 两项留空将解除绑定。角色与数据权限请在账号权限中分配。', 'Email is synchronized with the employee record. Resetting the password revokes previous sessions. Clear both FOP fields to unlink. Assign access on the permissions page.') }}</p></fieldset></form><template #footer><button class="btn btn-secondary" :disabled="saving" @click="emit('close')">{{ text('取消', 'Cancel') }}</button><button form="employee-login-form" class="btn btn-primary" :disabled="loading || saving || !loaded">{{ saving ? text('保存中…', 'Saving…') : text('保存账号资料', 'Save account') }}</button></template></OrganizationModal></template>

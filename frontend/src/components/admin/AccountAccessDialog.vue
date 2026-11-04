<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, SlidersHorizontal, X } from 'lucide-vue-next'
import InfoTip from '@/components/ui/InfoTip.vue'
import { accountRoles, updateAccountAccess, type AccountRole, type BusinessScope, type WorkbenchAccount } from '@/api/workbench-access'
import { accountRoleNames, accountRoleDescriptions, employeeDisplayName, getAccountRole, scopeName } from '@/utils/account-role'
import { workbenchNames, workbenchRoles } from '@/utils/workbench'
import { englishDisplayName } from '@/utils/user-display'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'

const props = defineProps<{ account: WorkbenchAccount; self?: boolean }>()
const emit = defineEmits<{ close: []; saved: [account: WorkbenchAccount]; charts: [] }>()
const { locale } = useI18n(), titleId = useId()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const dialog = ref<HTMLDialogElement>(), busy = ref(false), error = ref('')
const role = ref(getAccountRole(props.account))
const scope = ref<BusinessScope>({ ...(props.account.businessScope ?? { role: 'salesperson', departmentId: null, employeeId: null }) })
const benches = ref([...props.account.workbenchRoles])
const advanced = ref(false)
const scoped = computed(() => ['department_manager', 'salesperson'].includes(scope.value.role))
const input = computed(() => ({ accountRole: role.value, businessScope: { role: scope.value.role, departmentId: scope.value.departmentId?.trim() || null, employeeId: scope.value.employeeId?.trim() || null }, workbenchRoles: [...benches.value] }))
const original = JSON.stringify(input.value)
const changed = computed(() => JSON.stringify(input.value) !== original)
const templateChanged = computed(() => role.value !== getAccountRole(props.account) || props.account.businessScope?.role === 'none' && scope.value.role !== 'none')
function chooseRole(value: AccountRole) {
  if (busy.value || value === role.value || props.self && value !== 'administrator') return
  role.value = value
  scope.value.role = value === 'administrator' || value === 'collaboration' ? 'admin' : value
  // Preserve external assignments; use directory defaults only when unassigned.
  scope.value.departmentId ||= props.account.employee?.department.id ?? null
  scope.value.employeeId ||= props.account.employee?.id ?? null
  benches.value = [...workbenchRoles]
  error.value = ''
}
let active = true, opener: HTMLElement | undefined
async function save() {
  if (busy.value || !changed.value) return
  error.value = ''
  if (scope.value.role === 'department_manager' && !input.value.businessScope.departmentId || scope.value.role === 'salesperson' && !input.value.businessScope.employeeId) {
    advanced.value = true
    error.value = text('请补全部门或员工归属。', 'Complete the department or employee assignment.'); return
  }
  busy.value = true
  const session = captureSession()
  try {
    const saved = await updateAccountAccess(props.account.id, input.value)
    assertCurrentSession(session)
    if (active) emit('saved', saved)
  } catch (cause) {
    if (active) error.value = (cause as { statusCode?: number })?.statusCode === 409
      ? text('不能撤销自己的管理员角色。', 'You cannot remove your own administrator role.')
      : text('保存失败，请重试。', 'Could not save. Please retry.')
  } finally { if (active) busy.value = false }
}
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  if (dialog.value?.showModal) dialog.value.showModal(); else dialog.value?.setAttribute('open', '')
})
const off = onSessionReset(() => emit('close'))
onBeforeUnmount(() => { active = false; off(); dialog.value?.close?.(); if (opener?.isConnected) opener.focus() })
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="account-access-dialog" aria-modal="true" :aria-labelledby="titleId" @cancel.prevent="!busy && emit('close')">
    <form @submit.prevent="save">
      <header class="access-header"><div><p>{{ text('账号权限', 'Account access') }}</p><h2 :id="titleId">{{ englishDisplayName(account) }}<span>{{ employeeDisplayName(account) }}</span></h2><small>{{ account.email }}</small></div><button type="button" class="access-close" :aria-label="text('关闭', 'Close')" :disabled="busy" @click="emit('close')"><X :size="20" /></button></header>
      <div class="access-body">
        <p v-if="error" role="alert" class="access-error">{{ error }}</p>
        <section><div class="access-section-title"><h3>{{ text('账号角色', 'Account role') }}</h3><InfoTip :label="text('角色说明', 'About roles')">{{ text('仅管理员可访问系统管理。切换角色将应用工作台与图表模板；FOP 授权仍独立生效。', 'Only administrators can access system management. Changing roles applies workbench and chart defaults; FOP grants remain independent.') }}</InfoTip></div>
          <div class="role-options" role="group" :aria-label="text('账号角色', 'Account role')"><button v-for="option in accountRoles" :key="option" type="button" :data-role="option" :aria-pressed="role === option" :disabled="busy || self && option !== 'administrator'" @click="chooseRole(option)"><span>{{ text(...accountRoleNames[option]) }}<Check v-if="role === option" :size="15" /></span><small>{{ text(...accountRoleDescriptions[option]) }}</small></button></div>
        </section>
        <section class="data-access-section"><div class="access-section-title"><h3>{{ text('业务数据', 'Business data') }}</h3><span class="scope-preview">{{ text(...scopeName({ businessScope: scope })) }}</span></div>
          <label v-if="role === 'administrator'" class="access-field">{{ text('数据范围', 'Data scope') }}<select v-model="scope.role" class="input" :disabled="busy" aria-label="业务数据范围"><option value="admin">{{ text('全部业务部门', 'All business departments') }}</option><option value="none">{{ text('未开通', 'Off') }}</option></select></label>
          <label v-else-if="role === 'collaboration'" class="business-toggle"><span>{{ text('开通业务数据', 'Enable business data') }}</span><input type="checkbox" :checked="scope.role !== 'none'" :disabled="busy" aria-label="开通业务数据" @change="scope.role = ($event.target as HTMLInputElement).checked ? 'admin' : 'none'" /></label>
          <p v-if="scoped" class="assignment-preview">{{ account.employee?.department.id === scope.departmentId ? account.employee.department.name : (scope.departmentId || text('待设置部门', 'Department not assigned')) }}<span v-if="scope.role === 'salesperson'"> · {{ account.employee?.id === scope.employeeId ? account.employee.name : (scope.employeeId || text('待绑定员工', 'Employee not assigned')) }}</span></p>
          <div class="access-inline"><span>{{ text('工作台', 'Workbenches') }}</span><strong>{{ scope.role === 'none' ? text('未开放', 'Closed') : scope.role === 'admin' || benches.length === 5 ? text('全部 5 个', 'All 5') : text(`${benches.length} 个`, `${benches.length} enabled`) }}</strong></div>
          <button type="button" class="chart-config-link" data-chart-permissions :disabled="busy || changed" @click="emit('charts')"><span><SlidersHorizontal :size="15" />{{ text('图表权限', 'Chart permissions') }}</span><span>{{ account.chartPermissions.length ? text('已配置', 'Configured') : text('角色默认', 'Role defaults') }}<ChevronRight :size="16" /></span></button>
          <p v-if="templateChanged" class="template-note">{{ text('保存时应用所选角色的工作台与图表模板。', 'Saving applies the selected role’s workbench and chart defaults.') }}</p>
        </section>
        <details :open="advanced" @toggle="advanced = ($event.target as HTMLDetailsElement).open"><summary>{{ text('高级配置', 'Advanced settings') }}</summary><div class="advanced-content">
          <div class="assignment-fields"><label class="access-field">{{ text('业务部门 ID', 'Business department ID') }}<input v-model="scope.departmentId" class="input" maxlength="128" :disabled="busy" aria-label="业务部门 ID" /></label><label class="access-field">{{ text('业务员 ID', 'Salesperson ID') }}<input v-model="scope.employeeId" class="input" maxlength="128" :disabled="busy" aria-label="业务员 ID" /></label></div>
          <div class="access-section-title"><h3>{{ text('工作台访问', 'Workbench access') }}</h3><InfoTip>{{ text('ID 使用当前组织目录或已映射的 FOP 内码。调整不修改员工档案。', 'Use directory IDs or mapped FOP IDs. Changes do not edit employee profiles.') }}</InfoTip></div>
          <div class="bench-options"><label v-for="bench in workbenchRoles" :key="bench"><input v-if="scope.role === 'admin'" type="checkbox" checked disabled :aria-label="text(...workbenchNames[bench])" /><input v-else v-model="benches" type="checkbox" :value="bench" :disabled="busy" :aria-label="text(...workbenchNames[bench])" />{{ text(...workbenchNames[bench]) }}</label></div>
        </div></details>
      </div>
      <footer class="access-footer"><button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('close')">{{ text('取消', 'Cancel') }}</button><button type="submit" data-save-access class="btn workbench-primary" :disabled="busy || !changed">{{ busy ? text('保存中…', 'Saving…') : text('保存权限', 'Save changes') }}</button></footer>
    </form>
  </dialog></Teleport>
</template>
<style scoped>
.account-access-dialog{position:fixed;inset:0 0 0 auto;margin:0;width:min(570px,100vw);height:100dvh;max-height:100dvh;max-width:100vw;padding:0;border:0;border-left:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);box-shadow:-12px 0 48px #0f172a18}.account-access-dialog::backdrop{background:#0f172a66;backdrop-filter:blur(2px)}.account-access-dialog form{height:100%;display:flex;flex-direction:column}.access-header{display:flex;justify-content:space-between;gap:16px;padding:28px;border-bottom:1px solid var(--color-border)}.access-header p{font-size:12px;color:var(--color-text-secondary);margin:0 0 8px}.access-header h2{font-size:22px;font-weight:650;margin:0 0 5px}.access-header h2 span{display:inline-block;margin-left:12px;font-size:12px;font-weight:400;color:var(--color-text-secondary)}.access-header small{font-size:12px;color:var(--color-text-secondary)}.access-close{height:32px;width:32px;display:grid;place-items:center;border-radius:6px;color:var(--color-text-secondary)}.access-close:hover{background:var(--color-bg)}.access-body{padding:26px 28px;overflow-y:auto;flex:1}.access-body section+section{margin-top:26px;padding-top:24px;border-top:1px solid var(--color-border)}.access-section-title{display:flex;align-items:center;gap:8px;margin-bottom:14px}.access-section-title h3{font-size:13px;font-weight:650;margin:0}.role-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}.role-options button{border:1px solid var(--color-border);border-radius:8px;padding:14px;text-align:left;background:var(--color-surface)}.role-options button>span{display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;gap:8px}.role-options small{display:block;font-size:11px;color:var(--color-text-secondary);margin-top:6px;line-height:1.5}.role-options button[aria-pressed=true]{border-color:var(--color-chart-link);background:color-mix(in srgb,var(--color-chart-link) 8%,var(--color-surface));color:var(--color-chart-link)}.role-options button:disabled{opacity:.45;cursor:not-allowed}.scope-preview{margin-left:auto;font-size:12px;color:var(--color-chart-link)}.access-field{display:grid;gap:7px;font-size:12px;color:var(--color-text-secondary)}.access-field .input{width:100%;min-width:0;font-size:12px}.business-toggle,.access-inline{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:10px 0}.access-inline{color:var(--color-text-secondary)}.access-inline strong{font-weight:500;color:var(--color-text)}.business-toggle input,.bench-options input{accent-color:var(--color-chart-link)}.assignment-preview{font-size:12px;line-height:1.7;color:var(--color-text-secondary);overflow-wrap:anywhere}.chart-config-link{display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 0;font-size:12px;border-top:1px solid var(--color-border)}.chart-config-link>span{display:flex;align-items:center;gap:8px}.chart-config-link>span+span{color:var(--color-text-secondary)}.chart-config-link:disabled{opacity:.45}.template-note{font-size:11px;color:var(--color-text-secondary);margin:6px 0 0}.access-body details{margin-top:22px;border-top:1px solid var(--color-border);padding-top:18px;font-size:12px}.access-body summary{cursor:pointer;color:var(--color-text-secondary)}.advanced-content{padding-top:18px}.assignment-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px}.bench-options{display:flex;flex-wrap:wrap;gap:14px}.bench-options label{display:flex;gap:6px;align-items:center;font-size:12px}.access-footer{display:flex;justify-content:flex-end;gap:10px;padding:18px 28px;border-top:1px solid var(--color-border)}.access-error{font-size:13px;color:var(--color-danger,#c34c4c);padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:18px}@media(max-width:480px){.access-header,.access-body{padding:20px}.role-options{gap:8px}.role-options button{padding:10px}.assignment-fields{grid-template-columns:1fr}}
</style>

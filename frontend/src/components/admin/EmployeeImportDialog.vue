<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { importOrganizationEmployees, previewOrganizationImport, type EmployeeImportPreview, type OrganizationWorkspace } from '@/api/organization'
import OrganizationModal from './OrganizationModal.vue'
const props = defineProps<{ departmentId: string; departmentName: string }>(), emit = defineEmits<{ close: []; saved: [OrganizationWorkspace] }>()
const { locale } = useI18n(), zh = computed(() => locale.value.startsWith('zh')), text = (cn: string, en: string) => zh.value ? cn : en
const busy = ref(false), error = ref(''), preview = ref<EmployeeImportPreview>(), filename = ref('')
let active = true
function template() {
  const blob = new Blob(['\ufeff姓名,员工编号,邮箱,职务,手机\r\n演示员工（Demo）,HZ-DEMO-001,demo@example.com,外贸业务员,\r\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'HyperZone-成员导入模板.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function inspect(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; preview.value = undefined; error.value = ''; filename.value = file?.name ?? ''
  if (!file) return
  if (file.size > 2 * 1024 * 1024 || !/\.(xlsx|csv)$/i.test(file.name)) { error.value = text('请选择2MB以内的 .xlsx 或 .csv 文件。', 'Choose an .xlsx or .csv file up to 2 MB.'); input.value = ''; return }
  busy.value = true
  try { const result = await previewOrganizationImport(props.departmentId, file); if (active) preview.value = result }
  catch (cause) { if (active) error.value = typeof (cause as {message?: unknown}).message === 'string' ? (cause as {message: string}).message : text('预览失败，请检查模板格式。', 'Preview failed. Check the template format.') }
  finally { if (active) busy.value = false; input.value = '' }
}
async function save() {
  if (busy.value || !preview.value?.employees.length || preview.value.errors.length) return
  busy.value = true; error.value = ''
  try { const result = await importOrganizationEmployees(props.departmentId, preview.value.employees); if (active) emit('saved', result) }
  catch (cause) { if (active) error.value = (cause as {statusCode?: number}).statusCode === 409 ? (cause as {message: string}).message : text('导入失败，本批次未保存，请修改文件后重新预览。', 'Import failed. No rows were saved. Update the file and preview again.') }
  finally { if (active) busy.value = false }
}
onBeforeUnmount(() => { active = false; preview.value = undefined })
</script>
<template><OrganizationModal :title="text('批量导入部门成员', 'Import department members')" :busy="busy" @close="emit('close')"><p class="mb-4 text-sm">{{ text('导入部门', 'Department') }}：<strong>{{ departmentName }}</strong></p><div class="mb-4 flex flex-wrap items-center gap-3"><button class="btn btn-secondary" @click="template">{{ text('下载导入模板', 'Download template') }}</button><label class="btn btn-secondary cursor-pointer">{{ text('选择 Excel / CSV 文件', 'Choose Excel / CSV') }}<input aria-label="导入文件" type="file" accept=".xlsx,.csv" class="sr-only" :disabled="busy" @change="inspect" /></label><span class="text-xs text-slate-500">{{ filename }}</span></div><p class="mb-5 text-xs leading-6 text-slate-500">{{ text('每次最多100人，2MB以内。所有成员归属当前部门，导入仅创建员工档案；完成后可逐一开通账号，再分配权限。请删除模板演示行。', 'Up to 100 members and 2 MB. All members belong to this department. Import creates employee records; open accounts and assign permissions afterwards. Remove the sample row.') }}</p><p v-if="error" role="alert" class="org-error">{{ error }}</p><p v-if="busy" role="status" class="mb-4 text-sm text-slate-500">{{ text('正在处理…', 'Processing…') }}</p><div v-if="preview"><ul v-if="preview.errors.length" role="alert" class="org-error"><li v-for="(issue, index) in preview.errors" :key="index">{{ text('第', 'Row ') }}{{ issue.row }}{{ text('行：', ': ') }}{{ issue.message }}</li></ul><p class="mb-3 text-sm font-semibold">{{ text('导入预览', 'Preview') }} · {{ preview.employees.length }} {{ text('人', 'members') }}</p><div class="overflow-x-auto"><table class="data-table min-w-[640px]"><thead><tr><th>{{ text('姓名', 'Name') }}</th><th>{{ text('员工编号', 'Code') }}</th><th>{{ text('邮箱', 'Email') }}</th><th>{{ text('职务', 'Job title') }}</th><th>{{ text('手机', 'Phone') }}</th></tr></thead><tbody><tr v-for="(employee, index) in preview.employees" :key="index"><td>{{ employee.name }}</td><td>{{ employee.code }}</td><td>{{ employee.email }}</td><td>{{ employee.jobTitle || '—' }}</td><td>{{ employee.phone || '—' }}</td></tr></tbody></table></div></div><template #footer><button class="btn btn-secondary" :disabled="busy" @click="emit('close')">{{ text('取消', 'Cancel') }}</button><button class="btn btn-primary" :disabled="busy || !preview?.employees.length || !!preview?.errors.length" @click="save">{{ text('确认导入', 'Import members') }}</button></template></OrganizationModal></template>

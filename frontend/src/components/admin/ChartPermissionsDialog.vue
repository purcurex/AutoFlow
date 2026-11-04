<script setup lang="ts">
import InfoTip from '@/components/ui/InfoTip.vue'
import { englishDisplayName } from '@/utils/user-display'
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { chartIds, type ChartId, type ChartPermissionOverride, type SalesDepartmentCode } from '@/api/fop-chart-access'
import { updateChartPermissions, type WorkbenchAccount } from '@/api/workbench-access'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'
const props = defineProps<{ account: WorkbenchAccount }>()
const emit = defineEmits<{ close: []; saved: [account: WorkbenchAccount] }>()
const { locale } = useI18n(), titleId = useId()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const names: Record<ChartId, [string, string]> = {
  registrations: ['注册会员', 'Registrations'], department_receipts: ['部门回款', 'Department collections'], salesperson_receipts: ['业务员回款', 'Salesperson collections'], order_volume: ['业务订单量', 'Business orders'], customer_orders: ['客户订单', 'Customer orders'], freight: ['物流运费', 'Freight'], sales_performance: ['个人收款与毛利', 'Personal receipts and profit'],
}
const summaryCharts: ChartId[] = ['registrations', 'department_receipts', 'order_volume']
const departments: SalesDepartmentCode[] = ['sales1', 'sales2', 'sales3', 'sales4']
const drafts = ref<ChartPermissionOverride[]>(chartIds.map(chartId => {
  const saved = props.account.chartPermissions?.find(item => item.chartId === chartId)
  return saved ? { ...saved, summaryDepartments: [...saved.summaryDepartments] } : { chartId, visibility: 'inherit', dataScope: 'inherit', summaryMode: 'inherit', summaryDepartments: [], details: 'inherit', export: 'inherit' }
}))
const invalidSummary = computed(() => drafts.value.some(item => item.summaryMode === 'selected' && !item.summaryDepartments.length))
const dialog = ref<HTMLDialogElement>(), busy = ref(false), error = ref('')
let active = true, opener: HTMLElement | undefined
async function save() {
  if (busy.value || invalidSummary.value) return
  busy.value = true; error.value = ''
  const session = captureSession()
  try {
    const account = await updateChartPermissions(props.account.id, drafts.value.map(item => ({ ...item, summaryDepartments: item.summaryMode === 'selected' ? [...item.summaryDepartments] : [] })))
    assertCurrentSession(session)
    if (active) emit('saved', account)
  } catch { if (active) error.value = text('图表权限保存失败，请核对管理员权限后重试。', 'Could not save chart permissions. Check administrator access and retry.') }
  finally { if (active) busy.value = false }
}
onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  if (dialog.value?.showModal) dialog.value.showModal()
  else dialog.value?.setAttribute('open', '')
})
const off = onSessionReset(() => emit('close'))
onBeforeUnmount(() => { active = false; off(); dialog.value?.close?.(); if (opener?.isConnected) opener.focus() })
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="chart-permissions-dialog panel" aria-modal="true" :aria-labelledby="titleId" @cancel.prevent="!busy && emit('close')">
    <header class="flex items-center justify-between gap-4"><h2 :id="titleId" class="text-lg font-bold">{{ englishDisplayName(account) }} · {{ text('图表权限', 'Chart permissions') }}</h2><button class="btn btn-secondary" :disabled="busy" @click="emit('close')">{{ text('关闭', 'Close') }}</button></header>
    <div class="chart-permissions-hint"><span>{{ text('按需覆盖角色默认权限', 'Override role defaults as needed') }}</span><InfoTip :label="text('图表权限说明', 'About chart access')">{{ text('继承角色模板；记录范围受账号及 FOP 授权限制。组织汇总不授予客户、业务员或单据明细。', 'Inherit role defaults. Account and FOP grants cap record scope. Organization summaries do not grant customer, salesperson or order details.') }}</InfoTip></div>
    <p v-if="error" role="alert" class="text-red-600">{{ error }}</p>
    <div class="overflow-x-auto"><table class="data-table min-w-[950px]"><thead><tr><th>{{ text('图表', 'Chart') }}</th><th>{{ text('可见性', 'Visibility') }}</th><th>{{ text('记录范围上限', 'Record scope cap') }}</th><th>{{ text('组织汇总', 'Organization summaries') }}</th><th>{{ text('明细', 'Details') }}</th><th>{{ text('导出', 'Export') }}</th></tr></thead><tbody>
      <tr v-for="item in drafts" :key="item.chartId" :data-chart-id="item.chartId"><th>{{ text(...names[item.chartId]) }}</th><td><select v-model="item.visibility" aria-label="图表可见性" class="input" :disabled="busy"><option value="inherit">{{ text('继承', 'Inherit') }}</option><option value="allow">{{ text('允许', 'Allow') }}</option><option value="deny">{{ text('禁止', 'Deny') }}</option></select></td>
        <td><span v-if="item.chartId === 'department_receipts'" class="text-xs text-slate-500">{{ text('仅汇总', 'Summary only') }}</span><select v-else v-model="item.dataScope" aria-label="记录范围" class="input" :disabled="busy"><option value="inherit">{{ text('继承', 'Inherit') }}</option><option value="none">{{ text("不读取记录（仅汇总）", "No records (summaries only)") }}</option><option value="self">{{ text('仅本人', 'Self') }}</option><option value="department">{{ text('本部门', 'Own department') }}</option></select></td>
        <td><span v-if="!summaryCharts.includes(item.chartId)" class="text-xs text-slate-500">{{ text('不适用', 'Not applicable') }}</span><select v-else v-model="item.summaryMode" aria-label="组织汇总" class="input" :disabled="busy"><option value="inherit">{{ text('继承', 'Inherit') }}</option><option value="none">{{ text('无汇总', 'None') }}</option><template v-if="summaryCharts.includes(item.chartId)"><option value="selected">{{ text('指定部门', 'Selected departments') }}</option><option value="marketing">{{ text('营销中心', 'Marketing center') }}</option></template></select><div v-if="item.summaryMode === 'selected'" class="mt-2 space-y-1"><label v-for="(department, index) in departments" :key="department" class="flex items-center gap-2 text-xs"><input v-model="item.summaryDepartments" type="checkbox" :value="department" :disabled="busy">{{ text(`业务${['一','二','三','四'][index]}部`, `Sales ${index + 1}`) }}</label></div></td>
        <td><span v-if="['department_receipts', 'registrations'].includes(item.chartId)" class="text-xs text-slate-500">{{ '—' }}</span><select v-else v-model="item.details" aria-label="明细权限" class="input" :disabled="busy"><option value="inherit">{{ text('继承', 'Inherit') }}</option><option value="allow">{{ text('允许', 'Allow') }}</option><option value="deny">{{ text('禁止', 'Deny') }}</option></select></td>
        <td><select v-model="item.export" aria-label="导出权限" class="input" :disabled="busy"><option value="inherit">{{ text('继承', 'Inherit') }}</option><option value="allow">{{ text('允许', 'Allow') }}</option><option value="deny">{{ text('禁止', 'Deny') }}</option></select></td></tr>
    </tbody></table></div>
    <p v-if="invalidSummary" class="mt-3 text-sm text-amber-700">{{ text('指定部门汇总至少选择一个部门。', 'Select at least one department for each selected summary.') }}</p>
    <footer class="chart-permissions-footer mt-5 flex justify-end"><button data-save-chart-permissions class="btn btn-primary" :disabled="busy || invalidSummary" @click="save">{{ busy ? text('保存中…', 'Saving…') : text('保存图表权限', 'Save chart permissions') }}</button></footer>
  </dialog></Teleport>
</template>
<style scoped>
.chart-permissions-hint{display:flex;align-items:center;gap:8px;margin:16px 0;font-size:12px;color:var(--color-text-secondary)}
.chart-permissions-dialog{position:fixed;inset:0;margin:auto;width:min(1220px,96vw);max-height:90vh;padding:24px;overflow:auto;border:1px solid var(--color-border);color:var(--color-text);background:var(--color-surface);border-radius:12px}.chart-permissions-dialog::backdrop{background:#0f172a77}.chart-permissions-dialog :is(th,td){vertical-align:top}.chart-permissions-dialog select{min-width:100px}.chart-permissions-footer{position:sticky;bottom:-24px;margin:20px -24px -24px;padding:16px 24px;background:var(--color-surface);border-top:1px solid var(--color-border);z-index:1}
</style>

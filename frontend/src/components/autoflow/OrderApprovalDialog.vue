<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import { previewOrderApproval, submitOrderApproval, type ApprovalQueue, type ApprovalPreview, type ApprovalResult, type ApprovalStatus } from '@/api/fop-approvals'
import { captureSession, isCurrentSession } from '@/utils/session'
const props = defineProps<{ queue: ApprovalQueue; orderIds: string[] }>()
const emit = defineEmits<{ close: []; completed: [] }>()
const { locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const busy = ref(true), attempted = ref(false), error = ref(''), preview = ref<ApprovalPreview>(), result = ref<ApprovalResult>()
const session = captureSession(); let active = true
const requestId = crypto.randomUUID()
const current = () => active && isCurrentSession(session)
const eligible = computed(() => preview.value?.items.filter(row => row.eligible) ?? [])
const documentCount = computed(() => eligible.value.reduce((sum, row) => sum + row.documents.filter(d => d.eligible).length, 0))
const labels: Record<ApprovalStatus, string> = { approved: '审核成功', already_approved: '已审核', partial: '部分完成', blocked: '未提交', failed: '审核失败', unknown: '待核对' }
const label = (status: ApprovalStatus) => text(labels[status], status.replaceAll('_', ' '))
onMounted(async () => {
  try { const response = await previewOrderApproval(props.queue, props.orderIds); if (current()) preview.value = response }
  catch { if (current()) error.value = text('无法获取审核单据，请检查审核权限或刷新清单后重试。', 'Unable to load documents. Check approval access or refresh the list.') }
  finally { if (current()) busy.value = false }
})
onBeforeUnmount(() => { active = false })
async function confirm() {
  if (busy.value || attempted.value || !eligible.value.length) return
  busy.value = true; attempted.value = true
  try {
    const response = await submitOrderApproval(props.queue, requestId, preview.value!.items.map(row => ({ orderId: row.orderId, version: row.version })))
    if (current()) result.value = response
  } catch {
    if (current()) error.value = text('连接中断，审核结果尚未确认。请在 FOP 核对，勿重复提交。', 'Connection interrupted; results are unconfirmed. Verify in FOP before taking further action.')
  } finally { if (current()) { busy.value = false; emit('completed') } }
}
</script>
<template>
  <OrganizationModal :title="result || attempted ? text('审核结果', 'Approval results') : queue === 'review' ? text('审核履约订单', 'Approve fulfillment orders') : text('审核配货单', 'Approve allocation documents')" :busy="busy" @close="emit('close')">
    <p v-if="busy" class="approval-note" role="status">{{ attempted ? text('正在提交审核，请勿重复操作…', 'Submitting approval. Please wait…') : text('正在核对权限与关联单据…', 'Checking permissions and linked documents…') }}</p>
    <p v-if="error" class="approval-error" role="alert">{{ error }}</p>
    <template v-if="preview && !attempted">
      <p class="approval-summary">{{ text(`已选 ${preview.items.length} 笔订单，可审核 ${documentCount} 张单据`, `${preview.items.length} orders selected · ${documentCount} documents eligible`) }}</p>
      <p class="approval-note">{{ preview.source === 'mock' ? text('演示审核仅更新本地模拟状态，不影响 FOP。', 'Demo approval updates simulated state only.') : text('确认后将在 FOP 执行审核，后台将再次校验权限及单据状态。', 'Confirmation executes approval in FOP after permission and state checks.') }}</p>
      <div class="approval-orders"><article v-for="row in preview.items" :key="row.orderId"><strong>{{ row.orderNumber }}</strong><ul><li v-for="doc in row.documents" :key="doc.id"><span>{{ doc.number }}</span><span :class="doc.eligible ? 'approval-ready' : 'approval-note'">{{ doc.eligible ? text('可审核', 'Ready') : doc.reason || text('暂不可审核', 'Not eligible') }}</span></li></ul></article></div>
    </template>
    <small v-if="error && attempted" class="approval-note">{{ text('请求编号', 'Request ID') }}：{{ requestId }}</small>
    <template v-if="result">
      <p class="approval-summary" role="status">{{ text(`已完成 ${result.items.filter(r => ['approved', 'already_approved'].includes(r.status)).length} / ${result.items.length} 笔订单`, `${result.items.filter(r => ['approved', 'already_approved'].includes(r.status)).length} / ${result.items.length} orders completed`) }}</p>
      <div class="approval-orders"><article v-for="row in result.items" :key="row.orderId"><div class="approval-row-title"><strong>{{ row.orderNumber || row.orderId }}</strong><span :class="['approved','already_approved'].includes(row.status) ? 'approval-ready' : 'approval-alert'">{{ label(row.status) }}</span></div><p class="approval-note">{{ row.message }}</p><ul><li v-for="doc in row.documents" :key="doc.id"><span>{{ doc.number }}</span><div><span>{{ label(doc.status) }} · {{ doc.message }}</span><p v-if="doc.warning" class="approval-alert">{{ doc.warning }}</p></div></li></ul></article></div>
      <p class="approval-note">{{ text('清单将刷新已确认的最新状态；未完成的单据请按提示核对。', 'The list will refresh confirmed state. Review unfinished documents as indicated.') }}</p>
      <small class="approval-note">{{ text('请求编号', 'Request ID') }}：{{ result.requestId }}</small>
    </template>
    <template #footer><button class="btn btn-secondary" :disabled="busy" @click="emit('close')">{{ attempted ? text('完成', 'Done') : text('取消', 'Cancel') }}</button><button v-if="!attempted" data-testid="confirm-approval" class="btn btn-primary" :disabled="busy || !documentCount" @click="confirm">{{ preview?.source === 'mock' ? text('确认模拟审核', 'Confirm demo approval') : text('确认审核', 'Confirm approval') }}<template v-if="documentCount"> · {{ documentCount }}</template></button></template>
  </OrganizationModal>
</template>
<style scoped>
.approval-summary{font-size:16px;font-weight:600;margin-bottom:10px}.approval-note{font-size:12px;color:var(--color-text-secondary);line-height:1.8}.approval-orders{display:grid;gap:12px;margin:18px 0}.approval-orders article{padding:14px 16px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface)}.approval-orders strong{font-size:13px}.approval-orders ul{margin-top:10px}.approval-orders li,.approval-row-title{display:flex;justify-content:space-between;gap:24px;font-size:12px;line-height:1.8}.approval-orders li+li{margin-top:6px}.approval-ready{color:var(--color-chart-link)}.approval-alert{color:#bd9b6c}.approval-error{color:#cb8b91;background:color-mix(in srgb,#cb8b91 9%,transparent);border-radius:8px;padding:12px;font-size:13px}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageCircle, Copy, RefreshCw } from 'lucide-vue-next'
import OrganizationModal from '@/components/admin/OrganizationModal.vue'
import { getSupplierFollowUps, getSupplierChat, type SupplierFollowUp, type SupplierFollowUpPage } from '@/api/supplier-follow-up'
import { openSupplierChat } from '@/utils/supplierChat'
import { copyText } from '@/utils/copyText'
import { onSessionReset } from '@/utils/session'
const props = defineProps<{ orderId: string; orderNumber: string }>()
const emit = defineEmits<{ close: [] }>()
const { locale } = useI18n()
const t = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const page = ref<SupplierFollowUpPage>(), loading = ref(false), launching = ref(''), error = ref(''), notice = ref('')
let active = true, generation = 0
function close() { active = false; generation++; page.value = undefined; emit('close') }
const off = onSessionReset(close)
onBeforeUnmount(() => { active = false; generation++; off() })
function errorText(cause: unknown) {
  const message = (cause as { message?: unknown })?.message
  return typeof message === 'string' && /[\u4e00-\u9fff]/.test(message) ? message : t('暂时无法获取供应商信息，请刷新重试。', 'Supplier details are unavailable. Refresh to try again.')
}
async function load(auto = false) {
  const current = ++generation
  page.value = undefined; error.value = ''; notice.value = ''; loading.value = true
  try {
    const result = await getSupplierFollowUps(props.orderId)
    if (!active || current !== generation) return
    if (result.orderId !== props.orderId || !Array.isArray(result.items)) throw new Error('供应商信息不匹配，请刷新重试。')
    page.value = result
    if (auto && result.items.length === 1 && result.items[0]?.availability === 'ready') await launch(result.items[0])
  } catch (cause) { if (active && current === generation) error.value = errorText(cause) }
  finally { if (active && current === generation) loading.value = false }
}
async function launch(contact: SupplierFollowUp) {
  if (launching.value || !active || contact.availability !== 'ready') return
  const current = generation
  launching.value = contact.purchaseOrderId; error.value = ''; notice.value = ''
  try {
    const result = await getSupplierChat(props.orderId, contact.purchaseOrderId, contact.contactVersion)
    if (!active || current !== generation) return
    if (result.orderId !== props.orderId || result.purchaseOrderId !== contact.purchaseOrderId || result.wangwangAccount !== contact.supplier.wangwangAccount || result.source !== page.value?.source) throw new Error('供应商信息已变化，请刷新后重新选择。')
    if (result.source === 'mock' && result.mode === 'demo' && result.url === null) {
      notice.value = t(`演示环境：已核对 ${contact.purchaseOrderNumber} 对应 ${result.wangwangAccount}，未唤醒真实会话。`, `Demo: verified ${contact.purchaseOrderNumber} → ${result.wangwangAccount}. No real chat was opened.`)
    } else if (result.source === 'fop' && result.mode === 'live' && result.url) {
      openSupplierChat(result.url, result.wangwangAccount)
      notice.value = t('已尝试打开旺旺；若没有弹出，请确认已安装并登录旺旺，再点击“打开旺旺”或复制账号联系。', 'Tried to open Wangwang. If no chat appears, install and sign in, then retry or copy the account.')
    } else throw new Error('旺旺联系地址不可用，请刷新后重试。')
  } catch (cause) { if (active && current === generation) { page.value = undefined; error.value = errorText(cause) } }
  finally { if (active && current === generation) launching.value = '' }
}
async function copy(value: string) {
  try { await copyText(value); if (active) notice.value = t('已复制', 'Copied') } catch { if (active) notice.value = t('复制失败，请手动复制。', 'Copy failed. Please copy manually.') }
}
onMounted(() => load(true))
</script>
<template>
  <OrganizationModal :title="t('采购催办', 'Purchase follow-up')" @close="close">
    <div class="follow-up-intro"><div><strong>{{ orderNumber }}</strong><p>{{ t('联系本单待发货采购单的供应商', 'Contact suppliers for this order’s pending purchases') }}</p></div><button type="button" class="btn btn-secondary" :disabled="loading || !!launching" @click="load()"><RefreshCw :size="14" />{{ t('刷新', 'Refresh') }}</button></div>
    <p v-if="loading" role="status" class="follow-up-hint">{{ t('正在核对采购单与供应商…', 'Checking purchases and suppliers…') }}</p>
    <p v-if="error" role="alert" class="follow-up-error">{{ error }}</p>
    <p v-if="page && !page.items.length" class="follow-up-hint">{{ t('暂无可联系的待发货采购单，请在 FOP 核对采购关联与供应商资料。', 'No pending purchase contacts. Check purchase links and supplier details in FOP.') }}</p>
    <div v-if="page?.items.length" class="supplier-cards">
      <article v-for="contact in page.items" :key="contact.purchaseOrderId" :data-purchase="contact.purchaseOrderId" class="supplier-card">
        <header><div><h3>{{ contact.supplier.name }}</h3><p>{{ t('旺旺', 'Wangwang') }}：{{ contact.supplier.wangwangAccount || t('未填写', 'Not provided') }}<button v-if="contact.supplier.wangwangAccount" class="copy-contact" :aria-label="t('复制旺旺账号', 'Copy Wangwang account')" @click="copy(contact.supplier.wangwangAccount)"><Copy :size="13" /></button></p></div><span class="shipment-pill">{{ contact.shipmentStatus === 'partial' ? t('部分发货', 'Partly shipped') : t('待发货', 'Awaiting shipment') }}</span></header>
        <div class="purchase-numbers"><span>{{ t('采购单', 'Purchase') }} <b>{{ contact.purchaseOrderNumber }}</b><button class="copy-contact" :aria-label="t('复制采购单号', 'Copy purchase number')" @click="copy(contact.purchaseOrderNumber)"><Copy :size="13" /></button></span><span v-if="contact.platformOrderNumber">1688 <b>{{ contact.platformOrderNumber }}</b><button class="copy-contact" :aria-label="t('复制1688订单号', 'Copy 1688 order number')" @click="copy(contact.platformOrderNumber)"><Copy :size="13" /></button></span></div>
        <ul><li v-for="line in contact.lines" :key="`${line.fulfillmentLineId}:${line.purchaseLineId}`"><div><strong>{{ line.sku }}</strong><span>{{ line.name }}</span></div><span>{{ t('待发', 'Pending') }} <b>{{ line.pendingQuantity }}</b></span></li></ul>
        <footer><span>{{ contact.availability === 'missing_account' ? t('旺旺账号未填写，请在 FOP 补充。', 'Add the Wangwang account in FOP.') : contact.availability === 'chat_unavailable' ? t('联系地址待核对，请在 FOP 确认。', 'Verify the chat address in FOP.') : t('打开会话后由您发送催办信息', 'Send your follow-up in the chat') }}</span><button type="button" class="btn btn-primary open-chat" :disabled="contact.availability !== 'ready' || !!launching" @click="launch(contact)"><MessageCircle :size="15" />{{ launching === contact.purchaseOrderId ? t('核对中…', 'Checking…') : t('打开旺旺', 'Open Wangwang') }}</button></footer>
      </article>
    </div>
    <template #footer><span v-if="notice" role="status" class="follow-up-notice footer-notice">{{ notice }}</span><span v-else class="follow-up-hint">{{ t('仅联系供应商，不更改订单状态。', 'Contact only; order status stays unchanged.') }}</span><button class="btn btn-secondary" @click="close">{{ t('关闭', 'Close') }}</button></template>
  </OrganizationModal>
</template>
<style scoped>
.follow-up-intro,.supplier-card header,.supplier-card footer,.supplier-card li{display:flex;align-items:center;justify-content:space-between;gap:16px}.follow-up-intro{margin-bottom:18px}.follow-up-intro strong{font-size:15px}.follow-up-intro p,.follow-up-hint{font-size:12px;color:var(--color-text-secondary);line-height:1.8}.supplier-cards{display:grid;gap:14px}.supplier-card{border:1px solid var(--color-border);border-radius:10px;overflow:hidden}.supplier-card header{padding:16px 18px;background:var(--color-bg-secondary)}.supplier-card h3{font-size:15px;font-weight:600}.supplier-card p{font-size:12px;color:var(--color-text-secondary);margin-top:5px;overflow-wrap:anywhere}.copy-contact{display:inline-flex;vertical-align:middle;margin-left:7px;color:var(--color-text-secondary)}.copy-contact:hover{color:var(--color-text)}.shipment-pill{white-space:nowrap;font-size:11px;padding:4px 8px;border-radius:5px;color:var(--color-chart-link);background:color-mix(in srgb,var(--color-chart-link) 10%,transparent)}.purchase-numbers{display:flex;flex-wrap:wrap;gap:8px 20px;padding:12px 18px;font-size:12px;color:var(--color-text-secondary)}.purchase-numbers b{font-weight:500;color:var(--color-text)}.supplier-card ul{padding:0 18px 12px}.supplier-card li{padding:8px 0;border-top:1px solid var(--color-border);font-size:12px}.supplier-card li div{display:grid;gap:3px}.supplier-card li strong{font-size:12px;font-weight:500}.supplier-card li span{color:var(--color-text-secondary)}.supplier-card footer{padding:12px 18px;border-top:1px solid var(--color-border)}.supplier-card footer>span{font-size:11px;color:var(--color-text-secondary)}.supplier-card button:focus{outline:none;box-shadow:none}.follow-up-error,.follow-up-notice{padding:12px 14px;margin-bottom:14px;border-radius:8px;font-size:12px;line-height:1.8}.follow-up-notice{background:color-mix(in srgb,var(--color-chart-link) 10%,transparent);color:var(--color-chart-link)}.follow-up-error{background:#b56d7515;color:#ba7d86}.footer-notice{margin:0;flex:1}.open-chat{flex-shrink:0}.btn{display:inline-flex;align-items:center;gap:6px}@media(max-width:600px){.supplier-card footer{align-items:flex-start;flex-direction:column}.follow-up-intro{align-items:flex-start}}
</style>

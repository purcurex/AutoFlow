<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from 'lucide-vue-next'
import { configureWorkbenchReplica, initializeWorkbenchReplica, getWorkbenchReplicaJob, getWorkbenchReplicaStatus, requestWorkbenchReplicaSync, type WorkbenchReplicaSnapshot, type WorkbenchReplicaStatus } from '@/api/workbench-replica'
import { fopAccessError } from '@/api/fop-access'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { clearWorkbenchCounts } from '@/utils/workbench-counts'
import { navigationSyncGate, workbenchNavigationKey } from '@/utils/workbench-navigation-sync'

const props = withDefaults(defineProps<{ replica?: WorkbenchReplicaSnapshot; disabled?: boolean; navigationReady?: boolean }>(), { navigationReady: true })
const emit = defineEmits<{ synced: [] }>()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const text = (cn: string, en: string) => zh.value ? cn : en
const status = ref<WorkbenchReplicaStatus>(), syncing = ref(false), feedback = ref(''), feedbackError = ref(false), statusUnavailable = ref(false)
const initializing = ref(false)
const bootstrapRequest = ref<{companyId:string;requestKey:string}>()
const initializationReason = computed(() => {
  const value = status.value?.bootstrap
  if (value?.configured === false) return text('FOP 同步服务未配置，暂不能初始化。', 'FOP synchronization services are not configured.')
  if (value?.blockers?.includes('fop_queries_paused')) return text('FOP 调用已暂停，初始化暂不可用。', 'FOP access is paused. Initialization is unavailable.')
  if (value?.blockers?.includes('workbench_bootstrap_mock_forbidden')) return text('当前为模拟环境，不能初始化真实业务数据。', 'Real initialization is unavailable in the demo environment.')
  return ''
})
const route = inject(routeLocationKey, undefined), router = inject(routerKey, undefined)
const claimNavigation = router ? navigationSyncGate(router) : () => false
const navigationKey = computed(() => route ? workbenchNavigationKey(route) : '')
let activeTrigger: 'manual' | 'navigation' | undefined
let pendingReload: { ticket: number; session: number } | undefined
let releaseWait: (() => void) | undefined
let disposed = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined
const local = computed(() => props.replica?.readMode === 'local' || status.value?.readMode === 'local')
const collected = computed(() => props.replica?.dataMode === 'collected' || status.value?.state === 'collected')
const sourceSyncedAt = computed(() => props.replica ? props.replica.sourceSyncedAt : status.value?.sourceSyncedAt)
const formatTime = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat(zh.value ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) + ' · UTC+8' : '—'
const buttonTitle = computed(() => feedback.value || (statusUnavailable.value ? text('同步状态暂不可用', 'Sync status unavailable')
  : !status.value?.initialized ? text('数据尚未就绪', 'Data is not ready')
  : status.value.paused || status.value.syncConfigured === false ? text('同步暂不可用', 'Sync unavailable')
  : status.value.state === 'failed' ? text('上次同步失败', 'Last sync failed')
  : status.value.state === 'syncing' ? text('后台同步进行中', 'Background sync is running')
  : text('按需同步业务数据', 'Sync business data when needed')))
const current = (ticket: number, session: number) => !disposed && ticket === generation && isCurrentSession(session)
function cancel() { generation++; clearTimeout(timer); releaseWait?.(); releaseWait = undefined; controller?.abort(); syncing.value = false; initializing.value = false; pendingReload = undefined; activeTrigger = undefined }
function applyReload() {
  if (!pendingReload || props.disabled) return
  const { ticket, session } = pendingReload; pendingReload = undefined
  if (current(ticket, session)) { clearWorkbenchCounts(); emit('synced') }
}
async function loadStatus(ticket = generation, session = captureSession()) {
  try {
    const next = await getWorkbenchReplicaStatus(controller?.signal)
    if (current(ticket, session)) { status.value = next; statusUnavailable.value = false }
  } catch { if (current(ticket, session)) statusUnavailable.value = true }
}
async function initialize() {
  if (syncing.value || props.disabled || !status.value?.bootstrap?.allowed || !status.value.bootstrap.executable || statusUnavailable.value) return
  cancel(); const ticket = generation, session = captureSession()
  controller = new AbortController(); syncing.value = true; initializing.value = true; activeTrigger = 'manual'; feedback.value = ''; feedbackError.value = false
  try {
    const resume = status.value.bootstrap.resume
    if (!bootstrapRequest.value && resume && resume.errorCode !== 'workbench_snapshot_expired') bootstrapRequest.value = { companyId: resume.companyId, requestKey: resume.requestKey }
    if (!bootstrapRequest.value) {
      const configured = await configureWorkbenchReplica(controller.signal)
      if (!current(ticket, session)) return
      bootstrapRequest.value = { companyId: configured.companyId, requestKey: crypto.randomUUID() }
    }
    // Only this explicit invocation performs bounded continuation. No mount/timer retries.
    for (let step = 0; step < 100 && current(ticket, session); step++) {
      const result = await initializeWorkbenchReplica(bootstrapRequest.value.companyId, bootstrapRequest.value.requestKey, controller.signal)
      if (!current(ticket, session)) return
      if (result.state === 'published') {
        bootstrapRequest.value = undefined; pendingReload = { ticket, session }; applyReload()
        feedback.value = text('初始化完成', 'Initialization complete'); await loadStatus(ticket, session); return
      }
      if (result.state === 'failed' || result.errorCode) {
        if (result.errorCode === 'workbench_snapshot_expired') bootstrapRequest.value = undefined
        throw { code: result.errorCode ?? 'workbench_bootstrap_failed' }
      }
      if (!['importing','replaying','validating'].includes(result.state)) throw new Error('Unexpected initialization state')
    }
    feedback.value = text('初始化进度已保存，可继续初始化。', 'Progress saved. Continue initialization when ready.')
  } catch (cause) {
    const error = cause as { code?: string; response?: { data?: { code?: string } } }
    if (current(ticket, session) && (error?.code === 'workbench_snapshot_expired' || error?.response?.data?.code === 'workbench_snapshot_expired')) bootstrapRequest.value = undefined
    if (current(ticket, session)) { feedback.value = fopAccessError(cause, zh.value); feedbackError.value = true; await loadStatus(ticket, session) }
  } finally { if (current(ticket, session)) { initializing.value = false; syncing.value = false; activeTrigger = undefined } }
}
async function synchronize(trigger: 'manual' | 'navigation' = 'manual') {
  if (collected.value || trigger === 'navigation' && status.value?.automaticCallsEnabled === false) return
  if (syncing.value || props.disabled || !local.value || !status.value?.initialized || statusUnavailable.value || status.value.paused || status.value.syncConfigured === false) return
  cancel(); const ticket = generation, session = captureSession()
  controller = new AbortController(); syncing.value = true; activeTrigger = trigger; feedback.value = ''; feedbackError.value = false
  try {
    let job = await requestWorkbenchReplicaSync(crypto.randomUUID(), controller.signal, trigger)
    // Observe only this navigation/manual receipt, for at most one minute.
    for (let attempt = 0; current(ticket, session); attempt++) {
      if (job.state === 'skipped') return
      if (job.state === 'succeeded') {
        pendingReload = { ticket, session }; applyReload()
        feedback.value = text('同步完成', 'Sync complete')
        await loadStatus(ticket, session)
        return
      }
      if (job.state === 'blocked' || job.state === 'failed') {
        feedbackError.value = true
        if (job.errorCode === 'fop_queries_paused') {
          status.value = { ...status.value!, paused: true }
          feedback.value = text('同步暂不可用', 'Sync unavailable')
        } else feedback.value = fopAccessError({ code: job.errorCode }, zh.value)
        return
      }
      if (!job.id || !['pending', 'running'].includes(job.state)) throw new Error('Invalid synchronization state')
      if (attempt >= 30) { feedback.value = text('后台同步仍在进行，请稍后手动查看。', 'Sync is still running. Check again later.'); return }
      await new Promise<void>(resolve => { releaseWait = resolve; timer = setTimeout(() => { releaseWait = undefined; resolve() }, 2_000) })
      if (!current(ticket, session)) return
      job = await getWorkbenchReplicaJob(job.id, controller.signal)
    }
  } catch (cause) { if (current(ticket, session)) { feedback.value = fopAccessError(cause, zh.value); feedbackError.value = true } }
  finally { if (current(ticket, session)) { if (trigger === 'manual') claimNavigation(session); activeTrigger = undefined; syncing.value = false } }
}
watch(navigationKey, () => {
  // Manual synchronization belongs to the shared workbench, independent of the selected queue.
  if (syncing.value && activeTrigger === 'manual') return
  cancel(); feedback.value = ''; feedbackError.value = false
  if ((!status.value || statusUnavailable.value) && !disposed) { controller = new AbortController(); void loadStatus() }
})
watch([navigationKey, () => props.disabled, () => props.navigationReady, status, statusUnavailable, syncing], () => {
  applyReload()
  const value = status.value, key = navigationKey.value
  if (!key || props.navigationReady === false || props.disabled || syncing.value || statusUnavailable.value || !value?.initialized || value.readMode !== 'local' || value.syncConfigured !== true || value.paused || value.dataMode === 'mock' || value.automaticCallsEnabled === false) return
  if (!claimNavigation(captureSession())) return
  void synchronize('navigation')
}, { flush: 'post' })
const off = onSessionReset(() => { cancel(); bootstrapRequest.value = undefined; status.value = undefined; feedback.value = ''; feedbackError.value = false; statusUnavailable.value = false })
onMounted(() => { controller = new AbortController(); void loadStatus() })
onBeforeUnmount(() => { disposed = true; cancel(); off() })
</script>

<template>
  <div v-if="local" class="workbench-replica-controls" aria-live="polite">
    <template v-if="!status?.initialized && status?.bootstrap?.allowed">
      <button class="replica-sync" data-testid="initialize-workbench" :disabled="disabled || syncing || !status.bootstrap.executable || statusUnavailable" @click="initialize">{{ initializing ? text('初始化中…', 'Initializing…') : status.bootstrap.resume || bootstrapRequest ? text('继续初始化', 'Continue initialization') : text('初始化数据', 'Initialize data') }}</button>
      <span v-if="initializationReason" class="replica-error">{{ initializationReason }}</span>
    </template>
    <button class="replica-sync" data-testid="sync-workbench" :title="buttonTitle" :disabled="collected || disabled || syncing || status?.paused || !status?.initialized || status?.syncConfigured === false || statusUnavailable" @click="synchronize()"><RefreshCw :size="12" :class="{ spinning: syncing }" />{{ syncing ? text('同步中…', 'Syncing…') : text('同步数据', 'Sync data') }}</button>
    <span class="replica-time">{{ collected ? text('采集时点', 'Source as of') : text('最近同步', 'Last synced') }} {{ formatTime(sourceSyncedAt) }}</span>
    <span v-if="collected" class="replica-time">{{ text('已采集 · 只读 · 正式同步待接入', 'Collected · Read-only · Full sync pending') }}</span>
    <span v-if="feedback" :class="feedbackError ? 'replica-error' : 'replica-announcement'" :role="feedbackError ? 'alert' : 'status'">{{ feedback }}</span>
  </div>
</template>

<style scoped>
.workbench-replica-controls{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;color:var(--color-text-secondary)}
.replica-sync{display:inline-flex;align-items:center;gap:5px;padding:4px 7px;font-size:11px;font-weight:400;line-height:1.5;white-space:nowrap;color:var(--color-text-secondary);background:transparent;border:1px solid transparent;border-radius:5px;cursor:pointer}
.replica-sync:hover:not(:disabled){background:var(--color-surface);border-color:var(--color-border);color:var(--color-text)}
.replica-sync:focus-visible{outline:2px solid var(--color-text-secondary);outline-offset:2px}.replica-sync:disabled{opacity:.5;cursor:default}
.replica-time{font-size:10px;line-height:1.5;white-space:nowrap}.replica-error{font-size:11px;max-width:280px;color:var(--color-warning,#9a6700)}
.replica-announcement{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.spinning{animation:replica-spin 1s linear infinite}@keyframes replica-spin{to{transform:rotate(360deg)}}
</style>

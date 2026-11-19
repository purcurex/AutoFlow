<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Plus, RefreshCw } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { AppLayout } from '@/components/layout'
import { PageHeader } from '@/components/ui'
import FollowUpStages from '@/components/follow-up/FollowUpStages.vue'
import CustomerDevelopmentOverview from './DashboardView.vue'
import { autoflowApi, type AutoFlowDashboard, type FollowUpStage } from '@/api/autoflow'
import { useWorkbenchAccess } from '@/composables/useWorkbenchAccess'
import { captureSession, isCurrentSession, sessionEpoch } from '@/utils/session'

const { t, locale } = useI18n()
const copy = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const { roles, isAdmin, access } = useWorkbenchAccess()
// Relocation preserves the former overview's display grant. The APIs still scope every query.
const canViewOverview = computed(() => roles.value.includes('sales') && isAdmin.value
  && (access.value?.chartVisibility === undefined || access.value.chartVisibility.sales_performance === true))
const dashboard = ref<AutoFlowDashboard | null>(null)
const stages = ref<FollowUpStage[]>([])
const loading = ref(false)
const failed = ref(false)
const stagesFailed = ref(false)
let request = 0
async function refresh() {
  const ownRequest = ++request, session = captureSession()
  const current = () => ownRequest === request && isCurrentSession(session)
  loading.value = true; failed.value = false; stagesFailed.value = false
  try {
    if (canViewOverview.value) {
      const result = await autoflowApi.getDashboard()
      if (current()) { dashboard.value = result; stages.value = result.funnel }
    } else {
      const result = await autoflowApi.getFollowUps()
      if (current()) stages.value = result
    }
  } catch {
    if (!current()) return
    failed.value = true
    if (canViewOverview.value) {
      // Keep existing follow-up usable even when the separate overview endpoint fails.
      try { const result = await autoflowApi.getFollowUps(); if (current()) stages.value = result }
      catch { if (current()) stagesFailed.value = true }
    } else stagesFailed.value = true
  } finally { if (current()) loading.value = false }
}
watch([canViewOverview, sessionEpoch], () => {
  dashboard.value = null; stages.value = []
  void refresh()
}, { immediate: true })
onBeforeUnmount(() => { request++ })
</script>

<template>
  <AppLayout>
    <div class="app-page customer-follow-up">
      <PageHeader :eyebrow="t('followUps.eyebrow')" :title="t('nav.followUps')">
        <template #actions>
          <button class="btn follow-up-refresh" :disabled="loading" :aria-label="copy('刷新客户跟进', 'Refresh customer follow-up')" @click="refresh"><RefreshCw :size="15" :class="{ spinning: loading }" />{{ loading ? t('common.loading') : t('common.refresh') }}</button>
          <RouterLink v-if="canViewOverview" to="/workflows/new" class="btn follow-up-create"><Plus :size="16" />{{ t('nav.newWorkflow') }}</RouterLink>
        </template>
      </PageHeader>
      <div v-if="failed" class="follow-up-error" role="alert">{{ copy('部分数据未能更新，请点击刷新重试；已加载的结果仍可查看。', 'Some data could not be updated. Refresh to retry; loaded results remain available.') }}</div>
      <CustomerDevelopmentOverview v-if="canViewOverview" :dashboard="dashboard" :stages="stages" :loading="loading" :stages-failed="stagesFailed" />
      <FollowUpStages v-else :stages="stages" :loading="loading" :failed="stagesFailed" />
    </div>
  </AppLayout>
</template>
<style scoped>
.customer-follow-up{min-width:0;color:var(--color-text)}.follow-up-refresh{background:color-mix(in srgb,#67b2ee 12%,var(--color-surface));border:1px solid color-mix(in srgb,#67b2ee 28%,var(--color-border));color:var(--color-chart-link)}.follow-up-create{background:var(--color-primary);border:1px solid var(--color-primary);color:var(--color-on-primary)}.follow-up-create:hover{background:#465aab}.follow-up-error{padding:12px 16px;margin-bottom:20px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg-secondary);color:var(--color-text-secondary);font-size:13px}.spinning{animation:follow-up-spin 1s linear infinite}@keyframes follow-up-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.spinning{animation:none}}@media(max-width:720px){.customer-follow-up :deep(.page-header){align-items:flex-start;flex-direction:column;gap:16px}}
</style>

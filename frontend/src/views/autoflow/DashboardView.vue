<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ArrowRight, CheckCircle2, MessageSquareReply, PlayCircle, Target, Users } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui'
import { withReturnTo } from '@/composables/useReturnNavigation'
import { workflowCreatedDate } from '@/utils/workflowDisplay'
import { workflowProgressDisplay } from '@/utils/workflowProgress'

const store = useAutoFlowStore()
const route = useRoute()
const { t } = useI18n()
onMounted(() => store.fetchDashboard())
const metrics = computed(() => store.dashboard?.metrics)
const workflows = computed(() => (
  store.workflows.length ? store.workflows : store.dashboard?.recentWorkflows || []
))
const topLeads = computed(() => store.dashboard?.topLeads || store.leads.slice(0, 5))
const tasks = computed(() => store.dashboard?.nextTasks || store.outreachTasks.slice(0, 4))
const metricCards = computed(() => [
  { label: t('dashboard.activeRuns'), value: metrics.value?.activeWorkflows ?? 0, icon: PlayCircle, to: '/workflows' },
  { label: t('dashboard.newLeads'), value: metrics.value?.newLeads ?? 0, icon: Users, to: '/leads?status=new' },
  { label: t('dashboard.topQualified'), value: store.topLeads.filter((lead) => lead.status === 'qualified').length, icon: Target, to: '/leads?status=qualified' },
  { label: t('dashboard.readyTasks'), value: metrics.value?.readyOutreach ?? 0, icon: CheckCircle2, to: '/outreach?status=ready' },
  { label: t('dashboard.replies'), value: metrics.value?.replies ?? 0, icon: MessageSquareReply, to: '/leads?status=replied' },
  { label: t('dashboard.leadRecords'), value: store.followUpStages.reduce((sum, stage) => sum + stage.count, 0), icon: Users, to: '/leads' },
])
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader :eyebrow="t('dashboard.eyebrow')" :title="t('dashboard.title')" :description="t('dashboard.subtitle')" />

      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <RouterLink v-for="item in metricCards" :key="item.label" :to="item.to" class="metric-card group focus:outline-none focus:ring-2 focus:ring-orange-500"><p class="metric-label">{{ item.label }}</p><p class="metric-value">{{ item.value }}</p><span class="metric-icon transition group-hover:bg-orange-100 group-hover:text-orange-700 dark:group-hover:bg-orange-950"><component :is="item.icon" class="h-4 w-4" /></span><ArrowRight class="absolute bottom-4 right-4 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-500" /></RouterLink>
      </div>

      <div class="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <section class="panel overflow-hidden">
          <div class="panel-header"><div><h2 class="panel-title">{{ t('dashboard.workflowActivity') }}</h2><p class="panel-description">{{ t('workflows.description') }}</p></div><RouterLink to="/workflows" class="btn btn-ghost">{{ t('dashboard.viewAll') }}<ArrowRight class="h-4 w-4" /></RouterLink></div>
          <div v-if="workflows.length" class="divide-y divide-slate-100 dark:divide-slate-800">
            <div v-for="workflow in workflows.slice(0, 5)" :key="workflow.id" class="px-5 py-4">
              <div class="flex items-start justify-between gap-4"><div class="min-w-0"><p class="truncate text-sm font-semibold text-slate-900 dark:text-white">{{ workflow.name }}</p><p class="mt-1 text-xs text-slate-500">ID {{ workflow.displayId }} · {{ workflowCreatedDate(workflow.createdAt) }} · {{ $te(`status.${workflow.currentStage}`) ? $t(`status.${workflow.currentStage}`) : workflow.currentStage }} · {{ workflow.targetMarket }}</p></div><StatusBadge :status="workflow.status" /></div>
              <div class="mt-3 flex items-center gap-3"><div class="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div class="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" :style="{ width: `${workflowProgressDisplay(workflow).percent}%` }" /></div><span class="min-w-9 text-right text-xs font-semibold tabular-nums text-slate-500">{{ t(workflowProgressDisplay(workflow).labelKey, workflowProgressDisplay(workflow).labelParams || {}) }}</span></div>
            </div>
          </div>
          <EmptyState v-else :message="t('dashboard.noWorkflow')"><RouterLink to="/workflows/new" class="btn btn-secondary">{{ t('nav.newWorkflow') }}</RouterLink></EmptyState>
        </section>

        <section class="panel overflow-hidden">
          <div class="panel-header"><div><h2 class="panel-title">{{ t('dashboard.outreachQueue') }}</h2><p class="panel-description">{{ t('outreach.reviewHint') }}</p></div><RouterLink to="/outreach" class="btn btn-ghost">{{ t('dashboard.openQueue') }}<ArrowRight class="h-4 w-4" /></RouterLink></div>
          <div v-if="tasks.length" class="divide-y divide-slate-100 dark:divide-slate-800">
            <div v-for="task in tasks" :key="task.id" class="px-5 py-4"><div class="flex items-center justify-between gap-3"><p class="text-sm font-semibold capitalize text-slate-900 dark:text-white">{{ task.channel }}</p><StatusBadge :status="task.status" /></div><p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{{ task.message }}</p></div>
          </div>
          <EmptyState v-else :message="t('dashboard.noOutreach')" />
        </section>
      </div>

      <section class="panel mt-5 overflow-hidden">
        <div class="panel-header"><div><h2 class="panel-title">{{ t('dashboard.highestLeads') }}</h2><p class="panel-description">{{ t('leads.description') }}</p></div><RouterLink to="/leads" class="btn btn-ghost">{{ t('dashboard.leadPool') }}<ArrowRight class="h-4 w-4" /></RouterLink></div>
        <div v-if="topLeads.length" class="overflow-x-auto"><table class="data-table"><thead><tr><th>{{ t('dashboard.brand') }}</th><th>{{ t('common.market') }}</th><th>{{ t('common.category') }}</th><th>{{ t('common.score') }}</th><th>{{ t('common.status') }}</th></tr></thead><tbody><tr v-for="lead in topLeads" :key="lead.id"><td><RouterLink :to="withReturnTo(`/leads/${lead.id}`, route.fullPath)" class="font-semibold text-orange-600 hover:underline dark:text-orange-400">{{ lead.brandName }}</RouterLink><p class="mt-0.5 text-xs text-slate-500">{{ lead.domain }}</p></td><td>{{ lead.country }}</td><td>{{ lead.category }}</td><td><span class="font-bold text-slate-950 dark:text-white">{{ lead.totalScore }}</span></td><td><StatusBadge :status="lead.status" /></td></tr></tbody></table></div>
        <EmptyState v-else :message="t('dashboard.noLeads')" />
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, MessageSquare, PlayCircle } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import type { AutoFlowDashboard, FollowUpStage } from '@/api/autoflow'
import { StatusBadge } from '@/components/ui'
import FollowUpStages from '@/components/follow-up/FollowUpStages.vue'
import { withReturnTo } from '@/composables/useReturnNavigation'
import { workflowCreatedDate } from '@/utils/workflowDisplay'
import { workflowProgressDisplay } from '@/utils/workflowProgress'

// Each business count has one home: lead stages or its corresponding task tab.
const props = defineProps<{ dashboard: AutoFlowDashboard | null; stages: FollowUpStage[]; loading: boolean; stagesFailed: boolean }>()
const route = useRoute()
const { t, locale } = useI18n()
const copy = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const workflows = computed(() => props.dashboard?.recentWorkflows ?? [])
const topLeads = computed(() => props.dashboard?.topLeads ?? [])
const tasks = computed(() => props.dashboard?.nextTasks ?? [])
const activeTask = ref<'development' | 'communication'>('development')
const developmentTab = ref<HTMLButtonElement | null>(null)
const communicationTab = ref<HTMLButtonElement | null>(null)
function onTaskKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  activeTask.value = event.key === 'Home' ? 'development' : event.key === 'End' ? 'communication'
    : activeTask.value === 'development' ? 'communication' : 'development'
  const target = activeTask.value === 'development' ? developmentTab.value : communicationTab.value
  target?.focus()
}
const emptyMessage = (cn: string, en: string) => props.loading && !props.dashboard ? t('common.loading')
  : props.dashboard ? copy(cn, en) : copy('数据暂未加载', 'Data not loaded')
</script>

<template>
  <div class="customer-development-overview" :aria-busy="loading">
    <FollowUpStages :stages="stages" :loading="loading" :failed="stagesFailed">
      <section class="priority-leads" :aria-label="t('dashboard.highestLeads')">
        <div class="section-caption">{{ t('dashboard.highestLeads') }}</div>
        <div v-if="topLeads.length" class="lead-table-container">
          <table class="data-table overview-leads"><thead><tr><th>{{ t('dashboard.brand') }}</th><th>{{ t('common.market') }}</th><th>{{ t('common.category') }}</th><th>{{ t('common.score') }}</th><th>{{ t('common.status') }}</th></tr></thead>
            <tbody><tr v-for="lead in topLeads" :key="lead.id"><td><RouterLink :to="withReturnTo(`/leads/${lead.id}`, route.fullPath)" class="lead-link">{{ lead.brandName }}</RouterLink><p class="lead-domain">{{ lead.domain }}</p></td><td>{{ lead.country }}</td><td>{{ lead.category }}</td><td><strong>{{ lead.totalScore }}</strong></td><td><StatusBadge :status="lead.status" /></td></tr></tbody>
          </table>
        </div>
        <p v-else class="compact-empty">{{ emptyMessage('暂无可展示的高评分线索', 'No high-scoring leads yet') }}</p>
      </section>
    </FollowUpStages>
    <section class="panel task-panel">
      <header class="task-header">
        <div class="task-tabs" role="tablist" :aria-label="copy('客户开发任务', 'Customer development tasks')" @keydown="onTaskKey">
          <button id="development-task-tab" ref="developmentTab" type="button" role="tab" :aria-selected="activeTask === 'development'" aria-controls="development-task-panel" :tabindex="activeTask === 'development' ? 0 : -1" @click="activeTask = 'development'"><PlayCircle :size="16" /><span>{{ copy('开发任务', 'Development tasks') }}</span><small>{{ copy('运行中', 'Running') }} {{ dashboard?.metrics.activeWorkflows ?? '—' }}</small></button>
          <button id="communication-task-tab" ref="communicationTab" type="button" role="tab" :aria-selected="activeTask === 'communication'" aria-controls="communication-task-panel" :tabindex="activeTask === 'communication' ? 0 : -1" @click="activeTask = 'communication'"><MessageSquare :size="16" /><span>{{ copy('沟通待办', 'Outreach queue') }}</span><small>{{ copy('待发送', 'Ready') }} {{ dashboard?.metrics.readyOutreach ?? '—' }}</small></button>
        </div>
        <div class="task-links">
          <RouterLink v-if="activeTask === 'communication'" to="/outreach?status=ready">{{ copy('待发送', 'Ready to send') }}</RouterLink>
          <RouterLink :to="activeTask === 'development' ? '/workflows' : '/outreach'">{{ copy('查看全部', 'View all') }}<ArrowRight :size="14" /></RouterLink>
        </div>
      </header>
      <div v-if="activeTask === 'development'" id="development-task-panel" role="tabpanel" aria-labelledby="development-task-tab" tabindex="0" class="task-content">
        <div v-if="workflows.length" class="activity-list">
          <div v-for="workflow in workflows.slice(0, 5)" :key="workflow.id" class="activity-row">
            <div class="activity-title"><div class="activity-name"><p>{{ workflow.name }}</p><span>ID {{ workflow.displayId }} · {{ workflowCreatedDate(workflow.createdAt) }} · {{ $te(`status.${workflow.currentStage}`) ? t(`status.${workflow.currentStage}`) : workflow.currentStage }} · {{ workflow.targetMarket }}</span></div><StatusBadge :status="workflow.status" /></div>
            <div class="workflow-progress"><div class="progress-track"><div class="progress-fill" :style="{ width: `${workflowProgressDisplay(workflow).percent}%` }" /></div><span>{{ t(workflowProgressDisplay(workflow).labelKey, workflowProgressDisplay(workflow).labelParams || {}) }}</span></div>
          </div>
        </div>
        <p v-else class="compact-empty">{{ emptyMessage('暂无开发任务，可从右上角新建。', 'No development tasks. Create one using the button above.') }}</p>
      </div>
      <div v-else id="communication-task-panel" role="tabpanel" aria-labelledby="communication-task-tab" tabindex="0" class="task-content">
        <div v-if="tasks.length" class="activity-list">
          <div v-for="task in tasks" :key="task.id" class="activity-row">
            <div class="activity-title"><div class="activity-name"><p>{{ task.leadName || task.channel }}</p><span class="task-channel">{{ task.channel }}</span></div><StatusBadge :status="task.status" /></div>
            <p class="task-message">{{ task.message }}</p>
          </div>
        </div>
        <p v-else class="compact-empty">{{ emptyMessage('暂无待发送的沟通任务', 'No outreach tasks ready to send') }}</p>
      </div>
    </section>
  </div>
</template>
<style scoped>
.customer-development-overview{display:grid;gap:22px;min-width:0}.priority-leads{border-top:1px solid var(--color-border);min-width:0}.section-caption{padding:16px 22px 10px;font-size:13px;font-weight:600;color:var(--color-text-secondary)}.compact-empty{padding:28px 22px 32px;text-align:center;font-size:13px;color:var(--color-text-secondary);line-height:1.8}.lead-table-container{overflow-x:auto}.overview-leads{width:100%;table-layout:fixed}.overview-leads th:first-child{width:34%}.overview-leads th:nth-child(2){width:17%}.overview-leads th:nth-child(3){width:22%}.overview-leads th:nth-child(4){width:10%}.overview-leads td{overflow-wrap:anywhere}.lead-link{font-weight:600;color:var(--color-chart-link)}.lead-domain{font-size:12px;color:var(--color-text-secondary);margin-top:4px}.task-panel{min-width:0;overflow:hidden}.task-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 22px;border-bottom:1px solid var(--color-border)}.task-tabs{display:flex;align-items:stretch;gap:26px;min-width:0}.task-tabs button{display:flex;align-items:center;gap:8px;padding:19px 0 17px;background:none;border:0;border-bottom:2px solid transparent;color:var(--color-text-secondary);white-space:nowrap;font-size:14px;cursor:pointer}.task-tabs button[aria-selected=true]{color:var(--color-chart-link);border-bottom-color:var(--color-chart-link)}.task-tabs small{font-size:11px;font-weight:500;padding:3px 7px;border-radius:4px;background:var(--color-bg-secondary);font-variant-numeric:tabular-nums}.task-links{display:flex;align-items:center;gap:18px;flex-shrink:0}.task-links a{display:inline-flex;align-items:center;gap:7px;color:var(--color-chart-link);font-size:12px;white-space:nowrap}.task-links a:hover,.lead-link:hover{text-decoration:underline}.task-content{min-height:125px}.task-content>.compact-empty{padding-top:42px}.activity-row{padding:18px 22px}.activity-row+.activity-row{border-top:1px solid var(--color-border)}.activity-title{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.activity-name{min-width:0}.activity-name p{font-size:14px;font-weight:600;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-name>span{display:block;font-size:12px;color:var(--color-text-secondary);margin-top:6px;line-height:1.6}.workflow-progress{display:flex;align-items:center;gap:12px;margin-top:14px;max-width:620px}.workflow-progress>span{font-size:12px;white-space:nowrap;color:var(--color-text-secondary)}.progress-track{height:5px;flex:1;background:var(--color-bg-secondary);border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:var(--color-chart-link);border-radius:4px}.task-channel{text-transform:capitalize}.task-message{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;line-height:1.8;color:var(--color-text-secondary);margin-top:9px}.task-tabs button:focus-visible,.task-links a:focus-visible,.lead-link:focus-visible,.task-content:focus-visible{outline:2px solid var(--color-chart-link);outline-offset:3px}@media(max-width:720px){.task-header{align-items:flex-start;flex-direction:column;gap:0;padding:0 16px}.task-tabs{gap:20px;flex-wrap:wrap}.task-tabs button{font-size:13px;gap:6px}.task-tabs button svg{display:none}.task-links{align-self:flex-end;padding:0 0 12px}.overview-leads{min-width:500px}.section-caption,.activity-row{padding-left:16px;padding-right:16px}}
</style>

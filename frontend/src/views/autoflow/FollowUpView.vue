<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, CircleX, MessageCircleReply, Send, Target } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { PageHeader } from '@/components/ui'

const store = useAutoFlowStore()
const { t } = useI18n()
onMounted(() => store.fetchFollowUps())
const stages = computed(() => store.followUpStages)
const totalLeads = computed(() => stages.value.reduce((sum, stage) => sum + stage.count, 0))
const icons: Record<string, unknown> = { qualified: Target, contacted: Send, replied: MessageCircleReply, opportunity: BriefcaseBusiness, won: CheckCircle2, lost: CircleX }
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader :eyebrow="t('followUps.eyebrow')" :title="t('followUps.title')" :description="t('followUps.description')">
        <template #actions><div class="rounded-md border bg-white px-3 py-2 text-sm font-semibold text-slate-600 dark:bg-[#111419] dark:text-slate-300" style="border-color: var(--color-border)">{{ t('followUps.activeRecords', { count: totalLeads }) }}</div></template>
      </PageHeader>
      <div class="notice mb-5 border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><ArrowUpRight class="mt-0.5 h-4 w-4 shrink-0" /><p>{{ t('followUps.authority') }}</p></div>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <RouterLink v-for="stage in stages" :key="stage.key" :to="`/leads?status=${stage.key}`" class="metric-card group focus:outline-none focus:ring-2 focus:ring-orange-500"><span class="metric-icon transition group-hover:bg-orange-100 group-hover:text-orange-700 dark:group-hover:bg-orange-950"><component :is="icons[stage.key] || Target" class="h-4 w-4" /></span><p class="metric-label">{{ $te(`status.${stage.key}`) ? $t(`status.${stage.key}`) : stage.label }}</p><p class="metric-value">{{ stage.count }}</p><p class="mt-1 text-xs text-slate-500">{{ t('followUps.workStatus') }}</p><ArrowUpRight class="absolute bottom-4 right-4 h-4 w-4 text-slate-300 transition group-hover:text-orange-500" /></RouterLink>
      </div>
    </div>
  </AppLayout>
</template>

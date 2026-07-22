<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ArrowUpRight, ListTodo } from 'lucide-vue-next'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'

const store = useAutoFlowStore()

onMounted(() => {
  store.fetchFollowUps()
})

const stages = computed(() => store.followUpStages)
const totalLeads = computed(() => stages.value.reduce((sum, stage) => sum + stage.count, 0))
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <p class="text-sm font-medium text-slate-500">Next actions before handoff</p>
          <h1 class="mt-1 text-2xl font-semibold">Follow-up & FOP handoff</h1>
        </div>
        <div class="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <ListTodo class="h-4 w-4" />
          <span>{{ totalLeads }} active records</span>
        </div>
      </div>

      <div class="mt-5 flex items-start gap-3 border-l-4 border-teal-500 bg-white px-4 py-3 text-sm dark:bg-slate-900">
        <ArrowUpRight class="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
        <p class="text-slate-600 dark:text-slate-300">
          Formal leads, opportunities, stages and authoritative follow-up records continue in Kingdee Cloud Cosmic FOP.
        </p>
      </div>

      <div class="mt-6 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4 dark:border-slate-800 dark:bg-slate-800">
        <section
          v-for="stage in stages"
          :key="stage.key"
          class="min-h-32 bg-white p-4 dark:bg-slate-900"
        >
          <p class="text-sm font-medium text-slate-500">{{ stage.label }}</p>
          <p class="mt-4 text-3xl font-semibold">{{ stage.count }}</p>
          <p class="mt-1 text-xs text-slate-500">AutoFlow work status</p>
        </section>
      </div>
    </div>
  </AppLayout>
</template>

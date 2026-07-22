<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'

const store = useAutoFlowStore()

onMounted(() => {
  store.fetchDashboard()
})

const metrics = computed(() => store.dashboard?.metrics)
const workflows = computed(() => store.dashboard?.recentWorkflows || store.workflows)
const topLeads = computed(() => store.dashboard?.topLeads || store.leads.slice(0, 5))
const tasks = computed(() => store.dashboard?.nextTasks || store.outreachTasks.slice(0, 4))

</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-slate-500 dark:text-slate-400">Sales command center</p>
          <h1 class="mt-1 text-2xl font-semibold">Dashboard</h1>
        </div>
        <RouterLink to="/workflows/new" class="btn btn-primary">New workflow</RouterLink>
      </div>

      <div class="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-medium uppercase text-slate-500">Active runs</p>
          <p class="mt-2 text-2xl font-semibold">{{ metrics?.activeWorkflows ?? 0 }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-medium uppercase text-slate-500">New leads</p>
          <p class="mt-2 text-2xl font-semibold">{{ metrics?.newLeads ?? 0 }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-medium uppercase text-slate-500">Top qualified</p>
          <p class="mt-2 text-2xl font-semibold">{{ store.topLeads.filter((lead) => lead.status === 'qualified').length }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-medium uppercase text-slate-500">Ready tasks</p>
          <p class="mt-2 text-2xl font-semibold">{{ metrics?.readyOutreach ?? 0 }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-medium uppercase text-slate-500">Replies</p>
          <p class="mt-2 text-2xl font-semibold">{{ metrics?.replies ?? 0 }}</p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs font-medium uppercase text-slate-500">Lead records</p>
          <p class="mt-2 text-2xl font-semibold">{{ store.followUpStages.reduce((sum, stage) => sum + stage.count, 0) }}</p>
        </div>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section class="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
            <h2 class="font-semibold">Workflow activity</h2>
            <RouterLink to="/workflows" class="text-sm font-medium text-primary-600">View all</RouterLink>
          </div>
          <div class="divide-y divide-slate-100 dark:divide-slate-800">
            <div v-for="workflow in workflows.slice(0, 5)" :key="workflow.id" class="p-4">
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ workflow.name }}</p>
                  <p class="mt-1 text-sm text-slate-500">{{ workflow.currentStage }} · {{ workflow.targetMarket }}</p>
                </div>
                <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {{ workflow.status }}
                </span>
              </div>
              <div class="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                <div class="h-2 rounded-full bg-teal-500" :style="{ width: `${workflow.progress}%` }"></div>
              </div>
            </div>
            <div v-if="workflows.length === 0" class="p-6 text-sm text-slate-500">No workflow data yet.</div>
          </div>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
            <h2 class="font-semibold">Outreach queue</h2>
            <RouterLink to="/outreach" class="text-sm font-medium text-primary-600">Open queue</RouterLink>
          </div>
          <div class="divide-y divide-slate-100 dark:divide-slate-800">
            <div v-for="task in tasks" :key="task.id" class="p-4">
              <div class="flex items-center justify-between">
                <p class="font-medium capitalize">{{ task.channel }}</p>
                <span class="text-xs text-slate-500">{{ task.owner }}</span>
              </div>
              <p class="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{{ task.message }}</p>
            </div>
            <div v-if="tasks.length === 0" class="p-6 text-sm text-slate-500">No outreach tasks ready.</div>
          </div>
        </section>
      </div>

      <section class="mt-6 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div class="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <h2 class="font-semibold">Highest scoring leads</h2>
          <RouterLink to="/leads" class="text-sm font-medium text-primary-600">Lead pool</RouterLink>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th class="px-4 py-3">Brand</th>
                <th class="px-4 py-3">Market</th>
                <th class="px-4 py-3">Category</th>
                <th class="px-4 py-3">Score</th>
                <th class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr v-for="lead in topLeads" :key="lead.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <td class="px-4 py-3 font-medium"><RouterLink :to="`/leads/${lead.id}`">{{ lead.brandName }}</RouterLink></td>
                <td class="px-4 py-3">{{ lead.country }}</td>
                <td class="px-4 py-3">{{ lead.category }}</td>
                <td class="px-4 py-3 font-semibold">{{ lead.totalScore }}</td>
                <td class="px-4 py-3 capitalize">{{ lead.status }}</td>
              </tr>
              <tr v-if="topLeads.length === 0">
                <td colspan="5" class="px-4 py-6 text-center text-slate-500">No leads discovered yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>



<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { AppLayout } from '@/components/layout'
import { useAutoFlowStore } from '@/stores'

const autoFlowStore = useAutoFlowStore()

onMounted(() => {
  autoFlowStore.fetchDashboard()
})
</script>

<template>
  <AppLayout>
    <div class="p-6 space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-semibold">Sales command center</h2>
          <p class="text-sm text-[var(--color-text-secondary)]">Track prospect discovery from product seed to outreach follow-up.</p>
        </div>
        <RouterLink to="/workflows/new" class="btn btn-primary">Start workflow</RouterLink>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Active workflows</div>
          <div class="mt-2 text-2xl font-semibold">{{ autoFlowStore.dashboard?.metrics.activeWorkflows ?? 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">New leads</div>
          <div class="mt-2 text-2xl font-semibold">{{ autoFlowStore.dashboard?.metrics.newLeads ?? 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Ready outreach</div>
          <div class="mt-2 text-2xl font-semibold">{{ autoFlowStore.dashboard?.metrics.readyOutreach ?? 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Replies</div>
          <div class="mt-2 text-2xl font-semibold">{{ autoFlowStore.dashboard?.metrics.replies ?? 0 }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Opportunities</div>
          <div class="mt-2 text-2xl font-semibold">{{ autoFlowStore.dashboard?.metrics.opportunities ?? 0 }}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section class="xl:col-span-2 card p-4">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">Top scored leads</h3>
            <RouterLink to="/leads" class="text-sm text-primary-600">View all</RouterLink>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="text-left text-[var(--color-text-secondary)]">
                <tr>
                  <th class="py-2">Brand</th>
                  <th>Market</th>
                  <th>Source</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="lead in autoFlowStore.dashboard?.topLeads || []" :key="lead.id" class="border-t border-[var(--color-border)]">
                  <td class="py-3">
                    <RouterLink :to="`/leads/${lead.id}`" class="font-medium hover:text-primary-600">{{ lead.brandName }}</RouterLink>
                    <div class="text-xs text-[var(--color-text-secondary)]">{{ lead.domain }}</div>
                  </td>
                  <td>{{ lead.country }}</td>
                  <td>{{ lead.source }}</td>
                  <td><span class="font-semibold">{{ lead.totalScore }}</span></td>
                  <td class="capitalize">{{ lead.status }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card p-4">
          <h3 class="font-semibold mb-4">Next outreach</h3>
          <div class="space-y-3">
            <div v-for="task in autoFlowStore.dashboard?.nextTasks || []" :key="task.id" class="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div class="font-medium">{{ task.leadName }}</div>
              <div class="text-xs text-[var(--color-text-secondary)] uppercase">{{ task.channel }} - {{ task.status }}</div>
              <p class="mt-2 text-sm line-clamp-3">{{ task.message }}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  </AppLayout>
</template>

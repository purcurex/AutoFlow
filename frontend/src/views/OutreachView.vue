<script setup lang="ts">
import { onMounted } from 'vue'
import { AppLayout } from '@/components/layout'
import { useAutoFlowStore } from '@/stores'

const autoFlowStore = useAutoFlowStore()

onMounted(() => {
  autoFlowStore.fetchOutreachTasks()
})
</script>

<template>
  <AppLayout>
    <div class="p-6 space-y-6">
      <div>
        <h2 class="text-xl font-semibold">Outreach queue</h2>
        <p class="text-sm text-[var(--color-text-secondary)]">Review AI drafts, send manually, then update the follow-up status.</p>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <article v-for="task in autoFlowStore.outreachTasks" :key="task.id" class="card p-4">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-semibold">{{ task.leadName }}</h3>
              <div class="text-xs text-[var(--color-text-secondary)] uppercase">{{ task.channel }} - {{ task.status }}</div>
            </div>
            <button class="btn btn-secondary text-xs" @click="autoFlowStore.updateOutreachTask(task.id, { status: 'sent' })">Mark sent</button>
          </div>
          <p class="mt-4 text-sm leading-6">{{ task.message }}</p>
          <div class="mt-4 text-xs text-[var(--color-text-secondary)]">Next follow-up: {{ new Date(task.nextFollowUpAt).toLocaleString() }}</div>
        </article>
      </div>
    </div>
  </AppLayout>
</template>

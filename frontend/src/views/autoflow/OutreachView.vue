<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { CheckCircle2, MessageSquareReply, RotateCcw, Send, SkipForward } from 'lucide-vue-next'

const store = useAutoFlowStore()
const status = ref('all')

onMounted(() => {
  store.fetchOutreachTasks()
})

const tasks = computed(() => {
  if (status.value === 'all') return store.outreachTasks
  return store.outreachTasks.filter(task => task.status === status.value)
})

function nextPrimaryAction(task: { status: string }) {
  if (task.status === 'draft') return { status: 'ready' as const, label: 'Approve', icon: CheckCircle2 }
  if (task.status === 'ready') return { status: 'sent' as const, label: 'Mark sent', icon: Send }
  if (task.status === 'sent') return { status: 'replied' as const, label: 'Mark replied', icon: MessageSquareReply }
  if (task.status === 'failed') return { status: 'ready' as const, label: 'Retry', icon: RotateCcw }
  return null
}
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-slate-500">Semi-automated sending</p>
          <h1 class="mt-1 text-2xl font-semibold">Outreach</h1>
        </div>
        <select v-model="status" class="input max-w-44">
          <option value="all">All tasks</option>
          <option value="draft">Draft</option>
          <option value="ready">Ready</option>
          <option value="sent">Sent</option>
          <option value="replied">Replied</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      <div class="grid gap-4">
        <article v-for="task in tasks" :key="task.id" class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-semibold capitalize">{{ task.channel }} task</p>
              <p class="text-sm text-slate-500">Owner {{ task.owner }} · follow up {{ task.nextFollowUpAt }}</p>
            </div>
            <div class="flex gap-2">
              <button v-if="['draft', 'ready', 'failed'].includes(task.status)" class="btn btn-secondary gap-2 text-sm" @click="store.updateOutreachTask(task.id, { status: 'skipped' })">
                <SkipForward class="h-4 w-4" />
                Skip
              </button>
              <button v-if="nextPrimaryAction(task)" class="btn btn-primary gap-2 text-sm" @click="store.updateOutreachTask(task.id, { status: nextPrimaryAction(task)!.status })">
                <component :is="nextPrimaryAction(task)!.icon" class="h-4 w-4" />
                {{ nextPrimaryAction(task)!.label }}
              </button>
            </div>
          </div>
          <p class="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 dark:bg-slate-800">{{ task.message }}</p>
        </article>
        <div v-if="tasks.length === 0" class="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          No outreach tasks in this status.
        </div>
      </div>
    </div>
  </AppLayout>
</template>

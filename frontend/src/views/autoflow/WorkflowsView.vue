<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import type { SeedType } from '@/api/autoflow'

const props = defineProps<{ create?: boolean }>()
const router = useRouter()
const store = useAutoFlowStore()

const form = reactive({
  name: '',
  seedType: 'keyword' as SeedType,
  seedValue: '',
  targetMarket: 'United States',
})

onMounted(() => {
  store.fetchWorkflows()
})

const title = computed(() => props.create ? 'Create workflow' : 'Workflows')

async function submitWorkflow() {
  if (!form.seedValue.trim()) return
  const workflow = await store.createWorkflow({ ...form })
  if (workflow) router.push('/workflows')
}
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-slate-500">Discovery operations</p>
          <h1 class="mt-1 text-2xl font-semibold">{{ title }}</h1>
        </div>
        <RouterLink v-if="!create" to="/workflows/new" class="btn btn-primary">New workflow</RouterLink>
      </div>

      <section v-if="create" class="max-w-3xl rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div class="grid gap-4 md:grid-cols-2">
          <label class="space-y-1">
            <span class="text-sm font-medium">Workflow name</span>
            <input v-model="form.name" class="input" placeholder="Spring gadget prospecting" />
          </label>
          <label class="space-y-1">
            <span class="text-sm font-medium">Seed type</span>
            <select v-model="form.seedType" class="input">
              <option value="keyword">Keyword</option>
              <option value="image">Image</option>
            </select>
          </label>
          <label class="space-y-1 md:col-span-2">
            <span class="text-sm font-medium">Seed value</span>
            <input v-model="form.seedValue" class="input" placeholder="pet hair remover, or image URL" />
          </label>
          <label class="space-y-1">
            <span class="text-sm font-medium">Target market</span>
            <input v-model="form.targetMarket" class="input" />
          </label>
        </div>
        <div class="mt-5 flex gap-3">
          <button class="btn btn-primary" :disabled="store.isLoading" @click="submitWorkflow">Create</button>
          <RouterLink to="/workflows" class="btn btn-secondary">Cancel</RouterLink>
        </div>
      </section>

      <section v-else class="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th class="px-4 py-3">Name</th>
                <th class="px-4 py-3">Seed</th>
                <th class="px-4 py-3">Market</th>
                <th class="px-4 py-3">Stage</th>
                <th class="px-4 py-3">Leads</th>
                <th class="px-4 py-3">Progress</th>
                <th class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr v-for="workflow in store.workflows" :key="workflow.id">
                <td class="px-4 py-3 font-medium">{{ workflow.name }}</td>
                <td class="px-4 py-3">{{ workflow.seedType }} · {{ workflow.seedValue }}</td>
                <td class="px-4 py-3">{{ workflow.targetMarket }}</td>
                <td class="px-4 py-3">{{ workflow.currentStage }}</td>
                <td class="px-4 py-3">{{ workflow.leadCount }}</td>
                <td class="px-4 py-3">
                  <div class="h-2 w-28 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div class="h-2 rounded-full bg-teal-500" :style="{ width: `${workflow.progress}%` }"></div>
                  </div>
                </td>
                <td class="px-4 py-3 capitalize">{{ workflow.status }}</td>
              </tr>
              <tr v-if="store.workflows.length === 0">
                <td colspan="7" class="px-4 py-8 text-center text-slate-500">No workflows yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>


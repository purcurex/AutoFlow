<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppLayout } from '@/components/layout'
import { useAutoFlowStore } from '@/stores'
import type { SeedType } from '@/api/autoflow'

const router = useRouter()
const autoFlowStore = useAutoFlowStore()
const name = ref('')
const seedType = ref<SeedType>('keyword')
const seedValue = ref('')
const targetMarket = ref('United States')
const isCreating = ref(false)

onMounted(() => {
  autoFlowStore.fetchWorkflows()
})

async function createWorkflow() {
  if (!seedValue.value.trim()) return
  isCreating.value = true
  try {
    await autoFlowStore.createWorkflow({
      name: name.value.trim() || undefined,
      seedType: seedType.value,
      seedValue: seedValue.value.trim(),
      targetMarket: targetMarket.value.trim() || 'United States',
    })
    router.push('/workflows')
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <AppLayout>
    <div class="p-6 space-y-6">
      <section v-if="$route.path.endsWith('/new')" class="max-w-3xl card p-6">
        <h2 class="text-xl font-semibold">Create prospect workflow</h2>
        <p class="mt-1 text-sm text-[var(--color-text-secondary)]">Start with a product keyword or image URL. AutoFlow will discover ads, identify stores, score leads, and prepare outreach.</p>
        <div class="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label class="space-y-1">
            <span class="text-sm font-medium">Workflow name</span>
            <input v-model="name" class="input" placeholder="Pet grooming brush prospects" />
          </label>
          <label class="space-y-1">
            <span class="text-sm font-medium">Target market</span>
            <input v-model="targetMarket" class="input" placeholder="United States" />
          </label>
          <label class="space-y-1">
            <span class="text-sm font-medium">Seed type</span>
            <select v-model="seedType" class="input">
              <option value="keyword">Product keyword</option>
              <option value="image">Product image URL</option>
            </select>
          </label>
          <label class="space-y-1">
            <span class="text-sm font-medium">Seed value</span>
            <input v-model="seedValue" class="input" :placeholder="seedType === 'keyword' ? 'portable blender' : 'https://example.com/product.jpg'" />
          </label>
        </div>
        <div class="mt-6 flex gap-3">
          <button class="btn btn-primary" :disabled="!seedValue.trim() || isCreating" @click="createWorkflow">
            {{ isCreating ? 'Creating...' : 'Create workflow' }}
          </button>
          <button class="btn btn-secondary" @click="router.push('/workflows')">Cancel</button>
        </div>
      </section>

      <section v-else class="card p-4">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-xl font-semibold">Workflows</h2>
            <p class="text-sm text-[var(--color-text-secondary)]">Each workflow represents one product-led outbound run.</p>
          </div>
          <button class="btn btn-primary" @click="router.push('/workflows/new')">New workflow</button>
        </div>
        <div class="space-y-3">
          <div v-for="workflow in autoFlowStore.workflows" :key="workflow.id" class="p-4 rounded-lg border border-[var(--color-border)]">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-medium">{{ workflow.name }}</div>
                <div class="text-xs text-[var(--color-text-secondary)]">{{ workflow.seedType }} - {{ workflow.seedValue }} - {{ workflow.targetMarket }}</div>
              </div>
              <div class="text-right">
                <div class="capitalize text-sm">{{ workflow.status }}</div>
                <div class="text-xs text-[var(--color-text-secondary)]">{{ workflow.leadCount }} leads</div>
              </div>
            </div>
            <div class="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-800">
              <div class="h-2 rounded-full bg-primary-600" :style="{ width: `${workflow.progress}%` }"></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

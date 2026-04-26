<script setup lang="ts">
import { onMounted } from 'vue'
import { AppLayout } from '@/components/layout'
import { useAutoFlowStore } from '@/stores'

const autoFlowStore = useAutoFlowStore()

onMounted(() => {
  autoFlowStore.fetchCrm()
})
</script>

<template>
  <AppLayout>
    <div class="p-6 space-y-6">
      <div>
        <h2 class="text-xl font-semibold">CRM pipeline</h2>
        <p class="text-sm text-[var(--color-text-secondary)]">A lightweight pipeline for tracking outbound conversion.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-4">
        <section v-for="stage in autoFlowStore.crmStages" :key="stage.key" class="card p-4 min-h-40">
          <div class="flex items-center justify-between">
            <h3 class="font-semibold">{{ stage.label }}</h3>
            <span class="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800">{{ stage.count }}</span>
          </div>
          <div class="mt-4 text-sm text-[var(--color-text-secondary)]">Estimated value</div>
          <div class="mt-1 text-xl font-semibold">${{ stage.value.toLocaleString() }}</div>
        </section>
      </div>
    </div>
  </AppLayout>
</template>

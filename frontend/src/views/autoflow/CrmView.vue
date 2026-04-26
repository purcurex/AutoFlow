<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'

const store = useAutoFlowStore()

onMounted(() => {
  store.fetchCrm()
})

const stages = computed(() => store.crmStages)
const totalValue = computed(() => stages.value.reduce((sum, stage) => sum + stage.value, 0))

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-sm font-medium text-slate-500">Pipeline follow-up</p>
          <h1 class="mt-1 text-2xl font-semibold">CRM</h1>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <p class="text-xs uppercase text-slate-500">Estimated pipeline</p>
          <p class="text-xl font-semibold">{{ formatCurrency(totalValue) }}</p>
        </div>
      </div>

      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <section
          v-for="stage in stages"
          :key="stage.key"
          class="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-semibold">{{ stage.label }}</h2>
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {{ stage.count }} leads
            </span>
          </div>
          <p class="mt-4 text-2xl font-semibold">{{ formatCurrency(stage.value) }}</p>
          <div class="mt-4 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              class="h-2 rounded-full bg-teal-500"
              :style="{ width: `${Math.min(100, Math.max(8, (stage.value / Math.max(totalValue, 1)) * 100))}%` }"
            ></div>
          </div>
        </section>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { AppLayout } from '@/components/layout'
import { useAutoFlowStore } from '@/stores'

const autoFlowStore = useAutoFlowStore()

onMounted(() => {
  autoFlowStore.fetchLeads()
})
</script>

<template>
  <AppLayout>
    <div class="p-6 space-y-6">
      <div>
        <h2 class="text-xl font-semibold">Lead pool</h2>
        <p class="text-sm text-[var(--color-text-secondary)]">Qualified Shopify and DTC store prospects from discovery workflows.</p>
      </div>

      <section class="card overflow-hidden">
        <table class="w-full text-sm">
          <thead class="text-left bg-gray-50 dark:bg-gray-800 text-[var(--color-text-secondary)]">
            <tr>
              <th class="px-4 py-3">Lead</th>
              <th>Market</th>
              <th>Category</th>
              <th>Shopify</th>
              <th>Score</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lead in autoFlowStore.leads" :key="lead.id" class="border-t border-[var(--color-border)]">
              <td class="px-4 py-3">
                <div class="font-medium">{{ lead.brandName }}</div>
                <a :href="lead.storeUrl" target="_blank" class="text-xs text-primary-600">{{ lead.domain }}</a>
              </td>
              <td>{{ lead.country }}</td>
              <td>{{ lead.category }}</td>
              <td>{{ lead.shopifyConfidence }}%</td>
              <td class="font-semibold">{{ lead.totalScore }}</td>
              <td class="capitalize">{{ lead.status }}</td>
              <td class="pr-4 text-right">
                <RouterLink :to="`/leads/${lead.id}`" class="btn btn-secondary text-xs">Open</RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </AppLayout>
</template>

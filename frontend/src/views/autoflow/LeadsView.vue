<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'

const store = useAutoFlowStore()
const query = ref('')
const status = ref('all')

onMounted(() => {
  store.fetchLeads()
})

const filteredLeads = computed(() => {
  const search = query.value.trim().toLowerCase()
  return store.leads.filter(lead => {
    const matchesStatus = status.value === 'all' || lead.status === status.value
    const matchesSearch = !search || [lead.brandName, lead.domain, lead.category, lead.country].some(value => value.toLowerCase().includes(search))
    return matchesStatus && matchesSearch
  })
})
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div class="mb-6">
        <p class="text-sm font-medium text-slate-500">Prospect database</p>
        <h1 class="mt-1 text-2xl font-semibold">Leads</h1>
      </div>

      <div class="mb-4 flex flex-wrap gap-3">
        <input v-model="query" class="input max-w-sm" placeholder="Search brand, domain, market..." />
        <select v-model="status" class="input max-w-48">
          <option value="all">All status</option>
          <option value="new">New</option>
          <option value="qualified">Qualified</option>
          <option value="contacted">Contacted</option>
          <option value="replied">Replied</option>
          <option value="opportunity">Opportunity</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </div>

      <section class="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th class="px-4 py-3">Lead</th>
                <th class="px-4 py-3">Market</th>
                <th class="px-4 py-3">Category</th>
                <th class="px-4 py-3">Scores</th>
                <th class="px-4 py-3">Angle</th>
                <th class="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
              <tr v-for="lead in filteredLeads" :key="lead.id" class="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <td class="px-4 py-3">
                  <RouterLink :to="`/leads/${lead.id}`" class="font-medium text-primary-600">{{ lead.brandName }}</RouterLink>
                  <p class="text-xs text-slate-500">{{ lead.domain }}</p>
                </td>
                <td class="px-4 py-3">{{ lead.country }} · {{ lead.language }}</td>
                <td class="px-4 py-3">{{ lead.category }}</td>
                <td class="px-4 py-3">
                  <span class="font-semibold">{{ lead.totalScore }}</span>
                  <span class="text-xs text-slate-500"> / ad {{ lead.adActivityScore }} / traffic {{ lead.trafficScore }}</span>
                </td>
                <td class="max-w-xs px-4 py-3 text-slate-600 dark:text-slate-300">{{ lead.recommendedAngle }}</td>
                <td class="px-4 py-3 capitalize">{{ lead.status }}</td>
              </tr>
              <tr v-if="filteredLeads.length === 0">
                <td colspan="6" class="px-4 py-8 text-center text-slate-500">No matching leads.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

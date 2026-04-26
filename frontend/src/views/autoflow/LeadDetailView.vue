<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'

const route = useRoute()
const store = useAutoFlowStore()
const generatedMessage = ref('')

onMounted(() => {
  store.fetchLead(String(route.params.id))
})

const lead = computed(() => store.currentLead)

async function generateMessage() {
  if (!lead.value) return
  const response = await store.generateMessage(lead.value.id)
  generatedMessage.value = response?.message || ''
}
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <RouterLink to="/leads" class="text-sm font-medium text-primary-600">Back to leads</RouterLink>

      <div v-if="lead" class="mt-4 grid gap-6 xl:grid-cols-[1fr_380px]">
        <section class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 class="text-2xl font-semibold">{{ lead.brandName }}</h1>
              <a :href="lead.storeUrl" target="_blank" class="mt-1 block text-sm text-primary-600">{{ lead.domain }}</a>
            </div>
            <span class="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Score {{ lead.totalScore }}
            </span>
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-4">
            <div class="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <p class="text-xs uppercase text-slate-500">Shopify</p>
              <p class="mt-2 text-xl font-semibold">{{ lead.shopifyConfidence }}%</p>
            </div>
            <div class="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <p class="text-xs uppercase text-slate-500">Ads</p>
              <p class="mt-2 text-xl font-semibold">{{ lead.adActivityScore }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <p class="text-xs uppercase text-slate-500">Traffic</p>
              <p class="mt-2 text-xl font-semibold">{{ lead.trafficScore }}</p>
            </div>
            <div class="rounded-lg bg-slate-50 p-4 dark:bg-slate-800">
              <p class="text-xs uppercase text-slate-500">Contacts</p>
              <p class="mt-2 text-xl font-semibold">{{ lead.contactScore }}</p>
            </div>
          </div>

          <div class="mt-6">
            <h2 class="font-semibold">Recommended angle</h2>
            <p class="mt-2 text-slate-600 dark:text-slate-300">{{ lead.recommendedAngle }}</p>
          </div>

          <div class="mt-6">
            <h2 class="font-semibold">Contacts</h2>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div v-for="contact in lead.contacts" :key="`${contact.type}-${contact.value}`" class="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p class="text-xs uppercase text-slate-500">{{ contact.type }}</p>
                <p class="mt-1 break-all font-medium">{{ contact.value }}</p>
              </div>
            </div>
          </div>
        </section>

        <aside class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 class="font-semibold">AI outreach draft</h2>
          <button class="btn btn-primary mt-4 w-full" :disabled="store.isLoading" @click="generateMessage">Generate message</button>
          <textarea v-model="generatedMessage" class="input mt-4 min-h-64 resize-y" placeholder="Generated message will appear here." />
        </aside>
      </div>

      <div v-else class="mt-8 rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        Loading lead...
      </div>
    </div>
  </AppLayout>
</template>


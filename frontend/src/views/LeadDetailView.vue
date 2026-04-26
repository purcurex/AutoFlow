<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { AppLayout } from '@/components/layout'
import { useAutoFlowStore } from '@/stores'

const route = useRoute()
const autoFlowStore = useAutoFlowStore()

onMounted(() => {
  autoFlowStore.fetchLead(String(route.params.id))
})

async function generateMessage() {
  if (!autoFlowStore.currentLead) return
  await autoFlowStore.generateMessage(autoFlowStore.currentLead.id)
}
</script>

<template>
  <AppLayout>
    <div class="p-6" v-if="autoFlowStore.currentLead">
      <div class="flex items-start justify-between gap-6">
        <div>
          <h2 class="text-2xl font-semibold">{{ autoFlowStore.currentLead.brandName }}</h2>
          <a :href="autoFlowStore.currentLead.storeUrl" target="_blank" class="text-primary-600">{{ autoFlowStore.currentLead.domain }}</a>
          <p class="mt-3 max-w-3xl text-[var(--color-text-secondary)]">{{ autoFlowStore.currentLead.recommendedAngle }}</p>
        </div>
        <button class="btn btn-primary" @click="generateMessage">Generate WhatsApp message</button>
      </div>

      <div class="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Total score</div>
          <div class="mt-2 text-3xl font-semibold">{{ autoFlowStore.currentLead.totalScore }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Shopify confidence</div>
          <div class="mt-2 text-3xl font-semibold">{{ autoFlowStore.currentLead.shopifyConfidence }}%</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Ad activity</div>
          <div class="mt-2 text-3xl font-semibold">{{ autoFlowStore.currentLead.adActivityScore }}</div>
        </div>
        <div class="card p-4">
          <div class="text-xs text-[var(--color-text-secondary)]">Contact quality</div>
          <div class="mt-2 text-3xl font-semibold">{{ autoFlowStore.currentLead.contactScore }}</div>
        </div>
      </div>

      <div class="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section class="card p-4">
          <h3 class="font-semibold mb-3">Lead profile</h3>
          <dl class="grid grid-cols-2 gap-3 text-sm">
            <dt class="text-[var(--color-text-secondary)]">Source</dt><dd>{{ autoFlowStore.currentLead.source }}</dd>
            <dt class="text-[var(--color-text-secondary)]">Country</dt><dd>{{ autoFlowStore.currentLead.country }}</dd>
            <dt class="text-[var(--color-text-secondary)]">Language</dt><dd>{{ autoFlowStore.currentLead.language }}</dd>
            <dt class="text-[var(--color-text-secondary)]">Category</dt><dd>{{ autoFlowStore.currentLead.category }}</dd>
            <dt class="text-[var(--color-text-secondary)]">Status</dt><dd class="capitalize">{{ autoFlowStore.currentLead.status }}</dd>
          </dl>
        </section>

        <section class="card p-4">
          <h3 class="font-semibold mb-3">Contacts</h3>
          <div class="space-y-2">
            <div v-for="contact in autoFlowStore.currentLead.contacts" :key="contact.value" class="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
              <div>
                <div class="uppercase text-xs text-[var(--color-text-secondary)]">{{ contact.type }}</div>
                <div>{{ contact.value }}</div>
              </div>
              <span class="text-xs" :class="contact.verified ? 'text-green-500' : 'text-amber-500'">
                {{ contact.verified ? 'Verified' : 'Unverified' }}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </AppLayout>
</template>

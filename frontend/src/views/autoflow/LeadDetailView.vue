<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CheckCircle2, FileSpreadsheet, Send, Sparkles } from 'lucide-vue-next'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { fopApi, type FopHandoff } from '@/api/fop'

const route = useRoute()
const store = useAutoFlowStore()
const generatedMessage = ref('')
const generatedTaskId = ref('')
const draftStatus = ref<'idle' | 'draft' | 'ready'>('idle')
const messageError = ref('')
const handoff = ref<FopHandoff | null>(null)
const handoffBusy = ref(false)

onMounted(async () => {
  const leadId = String(route.params.id)
  await store.fetchLead(leadId)
  handoff.value = await fopApi.getHandoff(leadId)
})

const lead = computed(() => store.currentLead)

async function generateMessage() {
  if (!lead.value) return
  messageError.value = ''
  try {
    const response = await store.generateMessage(lead.value.id)
    generatedTaskId.value = response.id
    generatedMessage.value = response.message
    draftStatus.value = 'draft'
  } catch (error) {
    messageError.value = error instanceof Error ? error.message : 'AI message generation is unavailable.'
  }
}

async function approveDraft() {
  if (!generatedTaskId.value || !generatedMessage.value.trim()) return
  await store.updateOutreachTask(generatedTaskId.value, { status: 'ready', message: generatedMessage.value.trim() })
  draftStatus.value = 'ready'
}

async function handoffToFop() {
  if (!lead.value || handoffBusy.value) return
  handoffBusy.value = true
  try {
    handoff.value = await fopApi.handoff(lead.value.id, 'Qualified prospect handed off from AutoFlow')
  } finally {
    handoffBusy.value = false
  }
}
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <RouterLink to="/leads" class="text-sm font-medium text-primary-600">Back to leads</RouterLink>

      <div v-if="lead" class="mt-4 grid gap-6 xl:grid-cols-[1fr_400px]">
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
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs uppercase text-slate-500">{{ contact.type }}</p>
                  <span class="text-xs capitalize text-slate-500">{{ contact.verificationStatus }} · {{ contact.confidence }}%</span>
                </div>
                <p class="mt-1 break-all font-medium">{{ contact.value }}</p>
                <a v-if="contact.sourceUrl" :href="contact.sourceUrl" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-xs text-blue-600 hover:underline dark:text-blue-400">Evidence source</a>
              </div>
              <p v-if="lead.contacts.length === 0" class="text-sm text-slate-500">No verified contact evidence yet.</p>
            </div>
          </div>
        </section>

        <aside class="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div class="flex items-center justify-between gap-3">
            <h2 class="font-semibold">AI outreach draft</h2>
            <span v-if="draftStatus !== 'idle'" class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600 dark:bg-slate-800 dark:text-slate-300">{{ draftStatus }}</span>
          </div>
          <button class="btn btn-primary mt-4 w-full gap-2" :disabled="store.isLoading" @click="generateMessage">
            <Sparkles class="h-4 w-4" />
            Generate draft
          </button>
          <textarea v-model="generatedMessage" class="input mt-4 min-h-64 resize-y" placeholder="Generated message will appear here." />
          <p v-if="messageError" class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{{ messageError }}</p>
          <button class="btn btn-secondary mt-3 w-full gap-2" :disabled="draftStatus !== 'draft' || !generatedMessage.trim()" @click="approveDraft">
            <CheckCircle2 class="h-4 w-4" />
            Approve for outreach
          </button>
          <RouterLink :to="{ name: 'Quotes', query: { leadId: lead.id } }" class="btn btn-secondary mt-3 w-full gap-2">
            <FileSpreadsheet class="h-4 w-4" />
            Prepare quote
          </RouterLink>
          <button class="btn btn-secondary mt-3 w-full gap-2" :disabled="handoffBusy || handoff?.status === 'pending' || handoff?.status === 'succeeded'" @click="handoffToFop">
            <Send class="h-4 w-4" />
            {{ handoff?.status === 'succeeded' ? 'Handed off to FOP' : handoffBusy ? 'Handing off...' : 'Handoff to FOP' }}
          </button>
          <div v-if="handoff" class="mt-3 border-l-4 border-slate-300 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <p class="font-medium capitalize">FOP sync: {{ handoff.status.replace('_', ' ') }}</p>
            <p v-if="handoff.fopLeadId" class="mt-1">Lead ID: {{ handoff.fopLeadId }}</p>
            <p v-if="handoff.fopOpportunityId" class="mt-1">Opportunity ID: {{ handoff.fopOpportunityId }}</p>
            <p v-if="handoff.conflicts.length" class="mt-1 text-amber-700 dark:text-amber-300">{{ handoff.conflicts.join('; ') }}</p>
            <p v-if="handoff.lastError" class="mt-1 text-red-600 dark:text-red-300">{{ handoff.lastError }}</p>
          </div>
        </aside>
      </div>

      <div v-else class="mt-8 rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        Loading lead...
      </div>
    </div>
  </AppLayout>
</template>


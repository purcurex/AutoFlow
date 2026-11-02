<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  ExternalLink,
  Facebook,
  FileSpreadsheet,
  Globe2,
  Instagram,
  Linkedin,
  LoaderCircle,
  Mail,
  Megaphone,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  ShoppingBag,
  Sparkles,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { ReturnButton, StatusBadge } from '@/components/ui'
import OutreachConversationPanel from '@/components/ai/OutreachConversationPanel.vue'
import { fopApi, type FopHandoff } from '@/api/fop'
import type { LeadAdEvidence, LeadContact } from '@/api/autoflow'
import { contactDisplayValue, contactHref } from '@/utils/contactEvidence'

const route = useRoute()
const store = useAutoFlowStore()
const { t } = useI18n()
const handoff = ref<FopHandoff | null>(null)
const handoffBusy = ref(false)
const contactAnalysisBusy = ref(false)
const contactAnalysisError = ref('')

onMounted(async () => {
  const leadId = String(route.params.id)
  await store.fetchLead(leadId)
  handoff.value = await fopApi.getHandoff(leadId)
})

const lead = computed(() => store.currentLead)
const discoverySources = computed(() => {
  if (!lead.value) return []
  if (lead.value.discoverySources?.length) return lead.value.discoverySources
  if (lead.value.source.includes('google_lens')) return ['google_lens']
  if (lead.value.source.includes('pipiads')) return ['pipiads']
  return lead.value.source.includes('google') ? ['google_search'] : []
})
const scoreCards = computed(() => lead.value ? [
  { label: t('leads.shopify'), value: `${lead.value.shopifyConfidence}%`, icon: Globe2 },
  { label: t('leads.ad'), value: lead.value.adActivityScore, icon: Sparkles },
  { label: t('leads.traffic'), value: lead.value.trafficScore, icon: ExternalLink },
  { label: t('leads.contactScore'), value: lead.value.contactScore, icon: MessageCircle },
] : [])
const adEvidence = computed(() => lead.value?.adEvidence || [])

async function handoffToFop() {
  if (!lead.value || handoffBusy.value) return
  handoffBusy.value = true
  try { handoff.value = await fopApi.handoff(lead.value.id, 'Qualified prospect handed off from HyperZone') } finally { handoffBusy.value = false }
}

async function analyzeContacts() {
  if (!lead.value || contactAnalysisBusy.value) return
  contactAnalysisBusy.value = true
  contactAnalysisError.value = ''
  try {
    await store.analyzeLeadContacts(lead.value.id)
  } catch (error) {
    contactAnalysisError.value = error instanceof Error ? error.message : t('leads.contactAnalysisFailed')
  } finally {
    contactAnalysisBusy.value = false
  }
}

function contactIcon(type: LeadContact['type']) {
  return {
    email: Mail,
    phone: Phone,
    whatsapp: MessageCircle,
    facebook: Facebook,
    instagram: Instagram,
    linkedin: Linkedin,
    website: Globe2,
    other: Globe2,
  }[type] || Globe2
}

function contactTypeLabel(contact: LeadContact) {
  return t(`leads.contactType_${contact.type}`)
}

function evidenceSummary(contact: LeadContact) {
  return t('leads.contactEvidenceSummary', { type: contactTypeLabel(contact) })
}

function adSourceLabel(evidence: LeadAdEvidence) {
  return evidence.evidenceSource === 'pipiads_api'
    ? t('leads.adSourcePipiAdsApi')
    : evidence.provider
}

function adLinkLabel(evidence: LeadAdEvidence) {
  return evidence.platform === 'facebook'
    ? t('leads.openFacebookAd')
    : t('leads.openAdEvidence')
}
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <ReturnButton fallback="/leads" class="-ml-3 mb-3" />
      <div v-if="lead" class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div class="min-w-0 space-y-5">
          <section class="panel overflow-hidden">
            <div class="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-start sm:justify-between" style="border-color: var(--color-border)">
              <div class="min-w-0"><p class="page-eyebrow">{{ t('leads.detailEyebrow') }}</p><h1 class="mt-1 truncate text-2xl font-bold text-slate-950 dark:text-white">{{ lead.brandName }}</h1><a :href="lead.storeUrl" target="_blank" rel="noopener noreferrer" class="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-orange-600 hover:underline dark:text-orange-400"><Globe2 class="h-4 w-4" />{{ lead.domain }}<ExternalLink class="h-3 w-3" /></a><div class="mt-3 flex flex-wrap gap-1.5"><span v-for="source in discoverySources" :key="source" class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-[#171b21] dark:text-slate-300">{{ t(`leads.source_${source}`) }}</span></div></div>
              <div class="flex items-center gap-3"><StatusBadge :status="lead.status" /><span class="rounded-md bg-slate-950 px-3 py-2 text-sm font-bold text-white dark:bg-white dark:text-black">{{ t('common.score') }} {{ lead.totalScore }}</span></div>
            </div>
            <div class="grid gap-px bg-slate-200 dark:bg-slate-800 sm:grid-cols-2 xl:grid-cols-4"><div v-for="item in scoreCards" :key="item.label" class="bg-white p-4 dark:bg-[#111419]"><div class="flex items-center justify-between"><p class="text-xs font-semibold text-slate-500">{{ item.label }}</p><component :is="item.icon" class="h-4 w-4 text-orange-500" /></div><p class="mt-3 text-2xl font-bold tabular-nums text-slate-950 dark:text-white">{{ item.value }}</p></div></div>
            <div class="p-5"><div class="flex flex-wrap gap-2"><a v-if="lead.productUrl" :href="lead.productUrl" target="_blank" rel="noopener noreferrer" class="btn btn-primary"><ShoppingBag class="h-4 w-4" />{{ t('leads.openProduct') }}<ExternalLink class="h-3.5 w-3.5" /></a><a v-if="lead.ownerFacebookUrl" :href="lead.ownerFacebookUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary text-blue-700 dark:text-blue-300"><Facebook class="h-4 w-4" />{{ t('leads.openOwnerFacebook') }}<ExternalLink class="h-3.5 w-3.5" /></a></div><h2 class="panel-title mt-5">{{ t('leads.recommendedAngle') }}</h2><p class="mt-2 text-sm leading-7 text-slate-600 dark:text-slate-300">{{ lead.recommendedAngle }}</p></div>
          </section>

          <section class="panel overflow-hidden">
            <div class="panel-header">
              <div><h2 class="panel-title">{{ t('leads.adEvidence') }}</h2></div>
            </div>
            <div v-if="adEvidence.length" class="divide-y divide-slate-200 dark:divide-slate-800">
              <article v-for="evidence in adEvidence" :key="`${evidence.provider}-${evidence.adId || evidence.sourceUrl}`" class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex min-w-0 items-start gap-3">
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Megaphone class="h-4.5 w-4.5" /></span>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-bold text-slate-950 dark:text-white">{{ evidence.platform === 'unknown' ? t('leads.adPlatformUnknown') : t(`leads.adPlatform_${evidence.platform}`) }}</p>
                      <span class="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">{{ adSourceLabel(evidence) }}</span>
                      <span v-if="evidence.isDirectAdLink" class="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{{ t('leads.directAdLink') }}</span>
                    </div>
                    <p class="mt-1 text-xs text-slate-500">{{ t('leads.confidence') }}：{{ evidence.confidence }}%<span v-if="evidence.adId"> · Ad ID {{ evidence.adId }}</span></p>
                  </div>
                </div>
                <a :href="evidence.sourceUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary shrink-0">
                  <Facebook v-if="evidence.platform === 'facebook'" class="h-4 w-4 text-blue-600" />
                  <Megaphone v-else class="h-4 w-4" />
                  {{ adLinkLabel(evidence) }}
                  <ExternalLink class="h-3.5 w-3.5" />
                </a>
              </article>
            </div>
            <p v-else class="empty-state">{{ t('leads.noAdEvidence') }}</p>
          </section>

          <section class="panel overflow-hidden">
            <div class="panel-header">
              <div><h2 class="panel-title">{{ t('leads.contacts') }}</h2></div>
              <button type="button" class="btn btn-secondary" :disabled="contactAnalysisBusy" @click="analyzeContacts">
                <LoaderCircle v-if="contactAnalysisBusy" class="h-4 w-4 animate-spin" />
                <RefreshCw v-else class="h-4 w-4" />
                {{ contactAnalysisBusy ? t('leads.analyzingContacts') : t('leads.analyzeContacts') }}
              </button>
            </div>
            <p v-if="contactAnalysisError" class="notice mx-4 mt-4 border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300">{{ contactAnalysisError }}</p>
            <div v-if="lead.contacts.length" class="grid gap-px bg-slate-200 dark:bg-slate-800 md:grid-cols-2">
              <article v-for="contact in lead.contacts" :key="`${contact.type}-${contact.value}`" class="bg-white p-5 dark:bg-[#111419]">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400">
                      <component :is="contactIcon(contact.type)" class="h-4.5 w-4.5" />
                    </span>
                    <div class="min-w-0">
                      <p class="text-xs font-bold uppercase text-slate-500">{{ contactTypeLabel(contact) }}</p>
                      <p class="mt-1 truncate text-base font-bold text-slate-950 dark:text-white">{{ contactDisplayValue(contact) }}</p>
                    </div>
                  </div>
                  <StatusBadge :status="contact.verificationStatus" />
                </div>
                <div class="mt-4 rounded-md border bg-slate-50 p-3 text-xs leading-5 text-slate-600 dark:bg-[#171b21] dark:text-slate-300" style="border-color: var(--color-border)">
                  <p class="font-semibold text-slate-800 dark:text-slate-100">{{ evidenceSummary(contact) }}</p>
                  <p class="mt-1">{{ t('leads.evidencePage') }}：{{ contact.sourcePageTitle || t(`leads.evidencePage_${contact.sourcePageKind || 'unknown'}`) }}</p>
                  <p class="mt-1">{{ t('leads.confidence') }}：{{ contact.confidence }}%</p>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  <a :href="contactHref(contact)" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
                    <component :is="contactIcon(contact.type)" class="h-4 w-4" />
                    {{ t('leads.openContact') }}
                    <ExternalLink class="h-3.5 w-3.5" />
                  </a>
                  <a v-if="contact.sourceUrl" :href="contact.sourceUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
                    <Globe2 class="h-4 w-4" />
                    {{ t('leads.openEvidence') }}
                    <ExternalLink class="h-3.5 w-3.5" />
                  </a>
                </div>
              </article>
            </div>
            <p v-else class="empty-state">{{ t('leads.noContacts') }}</p>
          </section>
        </div>

        <div class="space-y-5">
          <OutreachConversationPanel :lead="lead" />
          <section class="panel p-4">
            <RouterLink :to="{ name: 'Quotes', query: { leadId: lead.id, returnTo: route.fullPath } }" class="btn btn-secondary w-full"><FileSpreadsheet class="h-4 w-4" />{{ t('leads.prepareQuote') }}</RouterLink>
            <button class="btn btn-secondary mt-3 w-full" :disabled="handoffBusy || handoff?.status === 'pending' || handoff?.status === 'succeeded'" @click="handoffToFop"><Send class="h-4 w-4" />{{ handoff?.status === 'succeeded' ? t('leads.handedOff') : handoffBusy ? t('leads.handingOff') : t('leads.handoff') }}</button>
            <div v-if="handoff" class="mt-4 rounded-md border bg-slate-50 p-3 text-xs text-slate-600 dark:bg-[#171b21] dark:text-slate-300" style="border-color: var(--color-border)"><div class="flex items-center justify-between"><strong>{{ t('leads.fopSync') }}</strong><StatusBadge :status="handoff.status" /></div><p v-if="handoff.fopLeadId" class="mt-2">{{ t('leads.leadId') }}: {{ handoff.fopLeadId }}</p><p v-if="handoff.fopOpportunityId" class="mt-1">{{ t('leads.opportunityId') }}: {{ handoff.fopOpportunityId }}</p><p v-if="handoff.conflicts.length" class="mt-2 text-amber-700 dark:text-amber-300">{{ handoff.conflicts.join('; ') }}</p><p v-if="handoff.lastError" class="mt-2 text-red-600 dark:text-red-300">{{ handoff.lastError }}</p></div>
          </section>
        </div>
      </div>
      <div v-else class="panel empty-state">{{ t('leads.loading') }}</div>
    </div>
  </AppLayout>
</template>

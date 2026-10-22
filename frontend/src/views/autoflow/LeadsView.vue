<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Clock3,
  Facebook,
  PackageSearch,
  Search,
  SlidersHorizontal,
  Trophy,
  Workflow,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useAutoFlowStore } from '@/stores'
import { AppLayout } from '@/components/layout'
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui'
import type { DiscoverySource, StoreLead } from '@/api/autoflow'
import shopifyGlyph from '@/assets/shopify-glyph.svg'
import { leadCustomerName } from '@/utils/leadDisplay'
import { groupLeadsByWorkflow } from '@/utils/leadGrouping'
import { withReturnTo } from '@/composables/useReturnNavigation'

const store = useAutoFlowStore()
const route = useRoute()
const { t, locale } = useI18n()
const query = ref('')
const statuses = ['new', 'qualified', 'contacted', 'replied', 'opportunity', 'won', 'lost']
const status = ref(statuses.includes(String(route.query.status)) ? String(route.query.status) : 'all')

onMounted(() => store.fetchLeads())
watch(
  () => route.query.status,
  (nextStatus) => {
    status.value = statuses.includes(String(nextStatus)) ? String(nextStatus) : 'all'
  },
)

const filteredLeads = computed(() => {
  const search = query.value.trim().toLowerCase()
  return store.leads.filter((lead) => (
    (status.value === 'all' || lead.status === status.value)
    && (!search || [lead.brandName, lead.domain, lead.category, lead.country]
      .some((value) => value.toLowerCase().includes(search)))
  ))
})
const workflowGroups = computed(() => groupLeadsByWorkflow(filteredLeads.value))
const occurrenceCount = computed(() => workflowGroups.value.reduce(
  (total, group) => total + group.entries.length,
  0,
))

function leadSources(lead: StoreLead): DiscoverySource[] {
  if (lead.discoverySources?.length) return lead.discoverySources
  if (lead.source.includes('google_lens')) return ['google_lens']
  if (lead.source.includes('pipiads')) return ['pipiads']
  return lead.source.includes('google') ? ['google_search'] : []
}

function formatDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return t('common.notAvailable')
  return new Intl.DateTimeFormat(locale.value.startsWith('zh') ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader
        :eyebrow="t('leads.eyebrow')"
        :title="t('leads.title')"
        :description="t('leads.groupedDescription')"
      />

      <div class="panel mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <label class="relative min-w-0 flex-1 sm:max-w-lg">
          <Search class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <input v-model="query" type="search" class="input pl-10" :placeholder="t('leads.searchPlaceholder')" />
        </label>
        <label class="relative sm:w-52">
          <SlidersHorizontal class="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <select v-model="status" class="input pl-10">
            <option value="all">{{ t('leads.allStatus') }}</option>
            <option v-for="item in statuses" :key="item" :value="item">{{ t(`status.${item}`) }}</option>
          </select>
        </label>
        <span class="px-2 text-xs font-semibold text-slate-500">
          {{ t('leads.groupedCount', { occurrences: occurrenceCount, leads: filteredLeads.length }) }}
        </span>
      </div>

      <div v-if="workflowGroups.length" class="space-y-4">
        <section
          v-for="group in workflowGroups"
          :key="group.workflowRunId"
          class="panel overflow-hidden"
        >
          <header class="flex flex-col gap-3 border-b bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:bg-[#14181d]" style="border-color: var(--color-border)">
            <div class="flex min-w-0 items-center gap-3">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300">
                <Workflow class="h-5 w-5" />
              </span>
              <div class="min-w-0">
                <p class="text-xs font-bold uppercase text-orange-600">{{ t('leads.sourceWorkflow') }}</p>
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 class="truncate text-base font-bold text-slate-950 dark:text-white">
                    {{ group.workflowName || t('leads.unassignedWorkflow') }}
                  </h2>
                  <span
                    v-if="group.workflowDisplayId"
                    class="inline-flex shrink-0 items-center rounded border border-slate-200 bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600 dark:border-slate-700 dark:bg-[#101419] dark:text-slate-300"
                  >
                    {{ t('workflows.workflowId') }} {{ group.workflowDisplayId }}
                  </span>
                </div>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-500">
              <span class="inline-flex items-center gap-1.5">
                <Clock3 class="h-4 w-4" />
                {{ t('leads.workflowCreatedAt') }} {{ formatDate(group.workflowCreatedAt) }}
              </span>
              <span>{{ t('leads.groupLeadCount', { count: group.entries.length }) }}</span>
              <span class="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                <Trophy class="h-4 w-4 text-orange-500" />
                {{ t('leads.highestScore') }} {{ group.entries[0]?.discovery.score ?? 0 }}
              </span>
            </div>
          </header>

          <div class="overflow-x-auto">
            <table class="data-table min-w-[1220px]">
              <thead>
                <tr>
                  <th>{{ t('leads.lead') }}</th>
                  <th>{{ t('leads.searchCreatedAt') }}</th>
                  <th>{{ t('leads.source') }}</th>
                  <th>{{ t('leads.directLinks') }}</th>
                  <th>{{ t('common.category') }}</th>
                  <th>{{ t('leads.scores') }}</th>
                  <th>{{ t('leads.angle') }}</th>
                  <th>{{ t('common.status') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="{ lead, discovery } in group.entries"
                  :key="`${group.workflowRunId}:${lead.id}`"
                >
                  <td>
                    <RouterLink
                      :to="withReturnTo(`/leads/${lead.id}`, route.fullPath)"
                      class="font-semibold text-orange-600 hover:underline dark:text-orange-400"
                    >
                      {{ leadCustomerName(lead.brandName) }}
                    </RouterLink>
                    <p class="mt-0.5 text-xs text-slate-500">{{ lead.domain }}</p>
                  </td>
                  <td>
                    <span class="inline-flex min-w-36 items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <Clock3 class="h-4 w-4 text-slate-400" />
                      {{ formatDate(discovery.discoveredAt) }}
                    </span>
                  </td>
                  <td>
                    <div class="flex min-w-28 flex-wrap gap-1">
                      <span
                        v-for="source in leadSources(lead)"
                        :key="source"
                        class="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-[#171b21] dark:text-slate-300"
                      >
                        {{ t(`leads.source_${source}`) }}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div class="flex min-w-32 items-center gap-1.5">
                      <a
                        v-if="lead.productUrl"
                        :href="lead.productUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-orange-200 bg-orange-50 text-orange-600 transition hover:border-orange-600 hover:bg-orange-600 hover:text-white dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-600 dark:hover:text-white"
                        :title="t('leads.openProduct')"
                      >
                        <PackageSearch class="h-[18px] w-[18px]" />
                      </a>
                      <a
                        v-if="lead.ownerFacebookUrl"
                        :href="lead.ownerFacebookUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-600 transition hover:border-blue-600 hover:bg-blue-600 hover:text-white dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-600 dark:hover:text-white"
                        :title="t('leads.openOwnerFacebook')"
                      >
                        <Facebook class="h-[18px] w-[18px]" />
                      </a>
                      <a
                        :href="lead.storeUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#b9d98b] bg-[#f4f8ee] transition hover:border-[#78a83f] hover:bg-[#eaf3df] dark:border-[#527630] dark:bg-[#172111] dark:hover:bg-[#24351a]"
                        :title="t('leads.openStore')"
                      >
                        <img :src="shopifyGlyph" alt="Shopify" class="h-5 w-5 object-contain" />
                      </a>
                    </div>
                  </td>
                  <td>{{ lead.category }}</td>
                  <td>
                    <div class="flex items-baseline gap-2">
                      <strong class="text-lg text-slate-950 dark:text-white">{{ discovery.score }}</strong>
                      <span class="text-xs text-slate-500">
                        {{ t('leads.ad') }} {{ lead.adActivityScore }} · {{ t('leads.traffic') }} {{ lead.trafficScore }}
                      </span>
                    </div>
                  </td>
                  <td class="max-w-sm">
                    <p class="line-clamp-2 leading-6">{{ lead.recommendedAngle }}</p>
                  </td>
                  <td>
                    <div class="flex min-w-28 flex-col items-start gap-1.5">
                      <span class="status-badge" :class="lead.discoveryStatus === 'seen_before' ? 'status-warning' : 'status-success'">
                        {{ t(`leads.discovery_${lead.discoveryStatus}`, { count: lead.discoveryCount }) }}
                      </span>
                      <StatusBadge :status="lead.status" />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section v-else class="panel">
        <EmptyState :message="t('leads.noMatch')" />
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  AlertTriangle,
  BadgeCheck,
  ExternalLink,
  LoaderCircle,
  PackageSearch,
  RefreshCw,
  ShoppingBag,
  Store,
} from 'lucide-vue-next'
import { AppLayout } from '@/components/layout'
import { PageHeader, ReturnButton } from '@/components/ui'
import {
  currentSourcingSearch,
  displayNumber,
  displayPercent,
  isSourcingRunning,
  offerPriceParts,
  offerPrimaryTitle,
  offerReasons,
  offerSecondaryTitle,
  offerShopUrl,
  offerSupplierIdentities,
  offerSupplierName,
  offerSupplierScore,
  safeExternalUrl,
  sourcingApi,
  sourcingStatus,
  sourcingStatusClass,
  type SourcingOffer,
  type SourcingSummary,
} from '@/utils/sourcing'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const summary = ref<SourcingSummary | null>(null)
const loading = ref(true)
const starting = ref(false)
const loadError = ref('')
const searchId = ref(typeof route.query?.searchId === 'string' ? route.query.searchId : '')
const parsedPage = Number(route.query?.page || 1)
const parsedPageSize = Number(route.query?.pageSize)
const hasRoutePageSize = [10, 20, 50].includes(parsedPageSize)
const page = ref(Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1)
const pageSize = ref<10 | 20 | 50>(hasRoutePageSize
  ? parsedPageSize as 10 | 20 | 50
  : 20)
const pageSizeResolved = ref(hasRoutePageSize)
const pageCache = new Map<number, SourcingSummary>()
let pollTimer: ReturnType<typeof setTimeout> | null = null

const workflowId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] || '' : String(value || '')
})
const status = computed(() => sourcingStatus(summary.value))
const search = computed(() => currentSourcingSearch(summary.value))
const offers = computed(() => summary.value?.items ?? summary.value?.offers ?? [])
const pagination = computed(() => summary.value?.pagination)
const running = computed(() => isSourcingRunning(summary.value))
const canStart = computed(() => Boolean(
  workflowId.value
  && summary.value?.providerConfigured
  && !running.value
  && !starting.value,
))

onMounted(loadSourcing)
onBeforeUnmount(stopPolling)

async function loadSourcing(showLoading = true) {
  if (!workflowId.value) {
    loading.value = false
    loadError.value = t('sourcing.workflowMissing')
    return
  }

  if (showLoading) loading.value = true
  loadError.value = ''
  try {
    const result = await sourcingApi.getWorkflowSourcing(workflowId.value, {
      searchId: searchId.value || undefined,
      page: page.value,
      pageSize: pageSizeResolved.value ? pageSize.value : undefined,
    })
    summary.value = result
    if (result.pagination?.pageSize) {
      pageSize.value = result.pagination.pageSize
      pageSizeResolved.value = true
    }
    const resolvedSearch = currentSourcingSearch(result)
    if (resolvedSearch?.id) searchId.value = resolvedSearch.id
    if (result.pagination?.loaded) pageCache.set(page.value, result)
    syncRoute()
    schedulePollingIfNeeded()
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : t('sourcing.loadFailed')
  } finally {
    if (showLoading) loading.value = false
  }
}

async function restartSourcing() {
  if (!canStart.value) return
  starting.value = true
  loadError.value = ''
  try {
    stopPolling()
    const started = await sourcingApi.startWorkflowSourcing(workflowId.value, {
      force: true,
      pageSize: pageSize.value,
    })
    searchId.value = started.searchId
    page.value = 1
    pageSize.value = started.pageSize
    pageCache.clear()
    await loadSourcing(false)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : t('sourcing.startFailed')
  } finally {
    starting.value = false
  }
}

async function changePage(targetPage: number) {
  const totalPages = pagination.value?.totalPages
  if (!searchId.value || targetPage < 1 || (totalPages !== null && totalPages !== undefined && targetPage > totalPages)) return
  stopPolling()
  page.value = targetPage
  const cached = pageCache.get(targetPage)
  if (cached) {
    summary.value = cached
    syncRoute()
    return
  }
  loadError.value = ''
  try {
    await sourcingApi.requestWorkflowSourcingPage(workflowId.value, searchId.value, targetPage)
    await loadSourcing(false)
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : t('sourcing.loadFailed')
  }
}

async function retryCurrentPage() {
  if (!searchId.value) return
  pageCache.delete(page.value)
  await sourcingApi.requestWorkflowSourcingPage(workflowId.value, searchId.value, page.value)
  await loadSourcing(false)
}

async function changePageSize(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  if (![10, 20, 50].includes(value) || value === pageSize.value) return
  pageSize.value = value as 10 | 20 | 50
  await restartSourcing()
}

function schedulePollingIfNeeded() {
  stopPolling()
  if (status.value === 'not_configured') return
  if (!pagination.value || !['pending', 'running'].includes(pagination.value.status)) return
  pollTimer = setTimeout(async () => {
    pollTimer = null
    await loadSourcing(false)
  }, 1_500)
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function syncRoute() {
  void router.replace({
    query: {
      ...route.query,
      ...(searchId.value ? { searchId: searchId.value } : {}),
      page: String(page.value),
      pageSize: String(pageSize.value),
    },
  })
}

const rangeStart = computed(() => {
  if (pagination.value?.totalRecords === 0) return 0
  return (page.value - 1) * pageSize.value + 1
})
const rangeEnd = computed(() => Math.min(
  page.value * pageSize.value,
  pagination.value?.totalRecords ?? page.value * pageSize.value,
))

function offerLink(offer: SourcingOffer) {
  return safeExternalUrl(offer.offerUrl)
}
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader
        :eyebrow="t('sourcing.eyebrow')"
        :title="t('sourcing.title')"
        :description="t('sourcing.description')"
      >
        <template #actions>
          <ReturnButton fallback="/workflows" />
          <button
            type="button"
            class="btn btn-primary"
            data-test="restart-sourcing"
            :disabled="!canStart"
            @click="restartSourcing"
          >
            <LoaderCircle v-if="starting || running" class="h-4 w-4 animate-spin" />
            <RefreshCw v-else class="h-4 w-4" />
            {{ starting || running
              ? t('sourcing.runningAction')
              : search ? t('sourcing.restartAction') : t('sourcing.startAction') }}
          </button>
        </template>
      </PageHeader>

      <section class="notice mb-5 border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
        <PackageSearch class="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p class="font-bold">{{ t('sourcing.boundaryTitle') }}</p>
          <p>{{ t('sourcing.boundaryDescription') }}</p>
        </div>
      </section>

      <section class="panel overflow-hidden">
        <div class="panel-header">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="panel-title">{{ t('sourcing.resultsTitle') }}</h2>
              <span class="status-badge status-info" data-test="source-tag">
                {{ t('sourcing.sourceTag') }}
              </span>
            </div>
            <p class="panel-description">{{ t('sourcing.resultsDescription') }}</p>
          </div>
          <span
            v-if="!loading"
            class="status-badge"
            data-test="sourcing-status"
            :class="sourcingStatusClass(status)"
          >
            <LoaderCircle v-if="status === 'running'" class="h-3.5 w-3.5 animate-spin" />
            <AlertTriangle v-else-if="status === 'failed' || status === 'partial' || status === 'not_configured'" class="h-3.5 w-3.5" />
            <BadgeCheck v-else-if="status === 'completed'" class="h-3.5 w-3.5" />
            {{ t(`sourcing.status_${status}`) }}
          </span>
        </div>

        <div
          v-if="!loading && summary?.workflowInput"
          class="grid gap-3 border-b bg-slate-50 px-5 py-4 text-sm dark:bg-[#171b21] sm:grid-cols-2 xl:grid-cols-4"
          style="border-color: var(--color-border)"
          data-test="sourcing-match-context"
        >
          <div>
            <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.workflowName') }}</p>
            <p class="mt-1 font-semibold text-slate-950 dark:text-white">{{ summary.workflowInput.name }}</p>
          </div>
          <div>
            <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.matchType') }}</p>
            <p class="mt-1 font-semibold text-slate-950 dark:text-white">
              {{ t(`sourcing.matchType_${summary.workflowInput.seedType}`) }}
            </p>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.query') }}</p>
            <p class="mt-1 truncate font-semibold text-slate-950 dark:text-white" :title="summary.workflowInput.seedValue">
              {{ summary.workflowInput.seedValue }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.targetMarket') }}</p>
            <p class="mt-1 font-semibold text-slate-950 dark:text-white">{{ summary.workflowInput.targetMarket }}</p>
          </div>
        </div>

        <div v-if="loading" class="empty-state" data-test="sourcing-loading">
          <LoaderCircle class="h-6 w-6 animate-spin text-orange-500" />
          <p>{{ t('sourcing.loading') }}</p>
        </div>

        <div v-else-if="loadError" class="empty-state" data-test="sourcing-error">
          <span class="empty-state-icon"><AlertTriangle class="h-5 w-5" /></span>
          <p class="font-semibold text-red-600 dark:text-red-300">{{ t('sourcing.loadFailed') }}</p>
          <p>{{ loadError }}</p>
          <button type="button" class="btn btn-secondary" @click="loadSourcing()">
            <RefreshCw class="h-4 w-4" />
            {{ t('sourcing.retryLoad') }}
          </button>
        </div>

        <div
          v-else-if="status === 'not_configured'"
          class="empty-state"
          data-test="provider-not-configured"
        >
          <span class="empty-state-icon"><AlertTriangle class="h-5 w-5" /></span>
          <p class="font-bold text-slate-950 dark:text-white">{{ t('sourcing.providerNotConfigured') }}</p>
          <p>{{ t('sourcing.providerNotConfiguredHint') }}</p>
        </div>

        <div v-else-if="pagination?.status === 'failed'" class="empty-state" data-test="sourcing-page-failed">
          <span class="empty-state-icon"><AlertTriangle class="h-5 w-5" /></span>
          <p class="font-bold text-slate-950 dark:text-white">{{ t('sourcing.pageFailed') }}</p>
          <p>{{ pagination.errorMessage || t('sourcing.searchFailedHint') }}</p>
          <button type="button" class="btn btn-secondary" data-test="retry-sourcing-page" @click="retryCurrentPage">
            <RefreshCw class="h-4 w-4" />
            {{ t('sourcing.retryPage') }}
          </button>
        </div>

        <div v-else-if="status === 'failed'" class="empty-state" data-test="sourcing-failed">
          <span class="empty-state-icon"><AlertTriangle class="h-5 w-5" /></span>
          <p class="font-bold text-slate-950 dark:text-white">{{ t('sourcing.searchFailed') }}</p>
          <p>{{ search?.failureMessage || t('sourcing.searchFailedHint') }}</p>
        </div>

        <div v-else-if="status === 'running' && !offers.length" class="empty-state" data-test="sourcing-running">
          <LoaderCircle class="h-7 w-7 animate-spin text-orange-500" />
          <p class="font-bold text-slate-950 dark:text-white">{{ t('sourcing.searchRunning') }}</p>
          <p>{{ t('sourcing.searchRunningHint') }}</p>
        </div>

        <div v-else-if="offers.length" class="grid gap-px bg-slate-200 dark:bg-slate-800 xl:grid-cols-2">
          <article
            v-for="offer in offers"
            :key="offer.id"
            class="bg-white p-5 dark:bg-[#111419]"
            data-test="sourcing-offer"
          >
            <div class="flex min-w-0 gap-4">
              <div class="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-slate-50 dark:bg-[#171b21]" style="border-color: var(--color-border)">
                <img
                  v-if="safeExternalUrl(offer.imageUrl)"
                  :src="safeExternalUrl(offer.imageUrl) || undefined"
                  :alt="t('sourcing.productImageAlt')"
                  class="h-full w-full object-contain"
                />
                <ShoppingBag v-else class="h-8 w-8 text-slate-300 dark:text-slate-600" />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <span class="status-badge status-info">{{ t('sourcing.sourceTag') }}</span>
                    <h3 class="mt-2 line-clamp-2 text-base font-bold leading-6 text-slate-950 dark:text-white">
                      {{ offerPrimaryTitle(offer) || t('sourcing.untitledOffer') }}
                    </h3>
                    <p v-if="offerSecondaryTitle(offer)" class="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                      {{ offerSecondaryTitle(offer) }}
                    </p>
                  </div>
                  <div class="shrink-0 rounded-md bg-slate-950 px-3 py-2 text-center text-white dark:bg-white dark:text-black">
                    <p class="text-[10px] font-semibold uppercase">{{ t('sourcing.score') }}</p>
                    <p class="text-xl font-bold tabular-nums">{{ offer.sourcingScore }}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-slate-200 dark:bg-slate-800 sm:grid-cols-4" style="border-color: var(--color-border)">
              <div class="bg-slate-50 p-3 dark:bg-[#171b21]">
                <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.price') }}</p>
                <p class="mt-1 font-bold text-slate-950 dark:text-white">
                  <template v-if="offerPriceParts(offer).minimum">
                    {{ offerPriceParts(offer).currency }}
                    {{ offerPriceParts(offer).minimum }}
                    <template v-if="offerPriceParts(offer).maximum"> - {{ offerPriceParts(offer).maximum }}</template>
                  </template>
                  <template v-else>{{ t('sourcing.notAvailable') }}</template>
                </p>
              </div>
              <div class="bg-slate-50 p-3 dark:bg-[#171b21]">
                <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.moq') }}</p>
                <p class="mt-1 font-bold text-slate-950 dark:text-white">
                  {{ displayNumber(offer.moq) || t('sourcing.notAvailable') }}
                  <span v-if="offer.moq && offer.unit" class="text-xs font-medium text-slate-500">{{ offer.unit }}</span>
                </p>
              </div>
              <div class="bg-slate-50 p-3 dark:bg-[#171b21]">
                <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.sales') }}</p>
                <p class="mt-1 font-bold text-slate-950 dark:text-white">{{ displayNumber(offer.salesVolume) || t('sourcing.notAvailable') }}</p>
              </div>
              <div class="bg-slate-50 p-3 dark:bg-[#171b21]">
                <p class="text-xs font-semibold text-slate-500">{{ t('sourcing.repurchase') }}</p>
                <p class="mt-1 font-bold text-slate-950 dark:text-white">{{ displayPercent(offer.repurchaseRate) || t('sourcing.notAvailable') }}</p>
              </div>
            </div>

            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <p class="text-xs font-bold uppercase text-slate-500">{{ t('sourcing.supplier') }}</p>
                <p class="mt-1 text-sm font-bold text-slate-950 dark:text-white">
                  {{ offerSupplierName(offer) || t('sourcing.notAvailable') }}
                </p>
                <p v-if="offerSupplierScore(offer)" class="mt-1 text-xs text-slate-500">
                  {{ t('sourcing.supplierScore') }}: {{ offerSupplierScore(offer) }}
                </p>
                <div v-if="offerSupplierIdentities(offer).length" class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="identity in offerSupplierIdentities(offer)"
                    :key="identity"
                    class="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    {{ identity }}
                  </span>
                </div>
              </div>

              <div>
                <p class="text-xs font-bold uppercase text-slate-500">{{ t('sourcing.recommendationReasons') }}</p>
                <ul v-if="offerReasons(offer).length" class="mt-1 space-y-1.5 text-sm leading-5 text-slate-600 dark:text-slate-300">
                  <li v-for="reason in offerReasons(offer)" :key="reason" class="flex gap-2">
                    <BadgeCheck class="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    <span>{{ reason }}</span>
                  </li>
                </ul>
                <p v-else class="mt-1 text-sm text-slate-500">{{ t('sourcing.noRecommendationReasons') }}</p>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap gap-2 border-t pt-4" style="border-color: var(--color-border)">
              <a
                v-if="offerLink(offer)"
                :href="offerLink(offer) || undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-primary"
                data-test="offer-link"
              >
                <ShoppingBag class="h-4 w-4" />
                {{ t('sourcing.openOffer') }}
                <ExternalLink class="h-3.5 w-3.5" />
              </a>
              <a
                v-if="offerShopUrl(offer)"
                :href="offerShopUrl(offer) || undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-secondary"
                data-test="shop-link"
              >
                <Store class="h-4 w-4" />
                {{ t('sourcing.openShop') }}
                <ExternalLink class="h-3.5 w-3.5" />
              </a>
            </div>
          </article>
        </div>

        <div v-else class="empty-state" data-test="sourcing-empty">
          <span class="empty-state-icon"><PackageSearch class="h-5 w-5" /></span>
          <p class="font-bold text-slate-950 dark:text-white">{{ t('sourcing.noOffers') }}</p>
          <p>{{ t('sourcing.noOffersHint') }}</p>
        </div>

        <div
          v-if="!loading && searchId && status !== 'not_configured'"
          class="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4"
          style="border-color: var(--color-border)"
          data-test="sourcing-pagination"
        >
          <p class="text-sm text-slate-500">
            {{ t('sourcing.resultRange', {
              start: rangeStart,
              end: rangeEnd,
              total: pagination?.totalRecords ?? '?',
            }) }}
          </p>
          <div class="flex items-center gap-2">
            <select
              :value="pageSize"
              class="input h-9 w-20 py-1"
              data-test="sourcing-page-size"
              @change="changePageSize"
            >
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
            </select>
            <button
              type="button"
              class="btn btn-secondary"
              data-test="previous-sourcing-page"
              :disabled="page <= 1"
              @click="changePage(page - 1)"
            >
              {{ t('sourcing.previousPage') }}
            </button>
            <span class="text-sm font-semibold">{{ page }} / {{ pagination?.totalPages ?? '?' }}</span>
            <button
              type="button"
              class="btn btn-secondary"
              data-test="next-sourcing-page"
              :disabled="pagination?.totalPages === null || page >= (pagination?.totalPages ?? page)"
              @click="changePage(page + 1)"
            >
              {{ t('sourcing.nextPage') }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

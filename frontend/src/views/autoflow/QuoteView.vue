<script setup lang="ts">
import { DEFAULT_CURRENCY, formatCurrency } from '@/utils/currency'
import { sumCompleteMoney } from '@/utils/tableTotals'
import TableTotals from '@/components/ui/TableTotals.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Calculator,
  CheckCircle2,
  Download,
  Info,
  LoaderCircle,
  PackageSearch,
  Percent,
  Plus,
  RefreshCcw,
  Search,
  Save,
  Trash2,
  Truck,
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { AppLayout } from '@/components/layout'
import { PageHeader, ReturnButton } from '@/components/ui'
import {
  fopApi,
  type FopActualLogisticsChannel,
  type FopCapabilities,
} from '@/api/fop'
import {
  quotationApi,
  type Quotation,
  type QuoteDraftPayload,
} from '@/api/quotation'
import { captureSession, isCurrentSession, onSessionReset } from '@/utils/session'
import { downloadBlob } from '@/utils/export'
import {
  QUOTE_COUNTRIES,
  createDefaultProductTiers,
  customerAmountFromMargin,
  type ProductTierDraft,
  type SelectedLogisticsChannelDraft,
} from '@/utils/quoteOptions'

const route = useRoute()
const { t, locale } = useI18n()
const text = (cn: string, en: string) => String(locale.value).startsWith('zh') ? cn : en
const capabilities = ref<FopCapabilities | null>(null)
const capabilityError = ref('')
const productReference = ref('')
const unit = ref('piece')
const currency = ref(DEFAULT_CURRENCY)
const productProfitMarginRate = ref(20)
const tiers = ref<ProductTierDraft[]>(createDefaultProductTiers())
const nextTierId = ref(4)
const productLineId = crypto.randomUUID()
const quotationId = ref('')
const savedVersion = ref(0)
const saveError = ref('')
const actionMessage = ref('')
const isSaving = ref(false)
const isRequesting = ref(false)
const isExporting = ref(false)
const costLoading = ref(false)
const costError = ref('')
const latestQuotation = ref<Quotation | null>(null)
const countries = QUOTE_COUNTRIES
const selectedCountries = ref(['US'])
const packageData = reactive({
  quantity: 1,
  weight: 1,
  weightUnit: 'kg',
  length: 20,
  width: 15,
  height: 10,
  dimensionUnit: 'cm',
})
const actualChannels = ref<FopActualLogisticsChannel[]>([])
const selectedLogisticsChannels = ref<SelectedLogisticsChannelDraft[]>([])
const defaultLogisticsProfitMarginRate = ref(20)
const channelLoading = ref(false)
const channelError = ref('')
const channelSearch = ref('')
const appliedChannelSearch = ref('')
const channelPage = ref(1)
const channelTotal = ref(0)
const channelPageSize = 24
const catalogSource = ref<'fop' | 'sandbox'>()
const channelPages = computed(() => Math.max(1, Math.ceil(channelTotal.value / channelPageSize)))
let catalogRequest = 0, capabilitiesRequest = 0, disposed = false
let catalogController: AbortController | undefined
const offCatalogSession = onSessionReset(() => {
  catalogRequest++; capabilitiesRequest++; catalogController?.abort(); capabilities.value = null
  actualChannels.value = []; selectedLogisticsChannels.value = []; channelTotal.value = 0; channelLoading.value = false
  appliedChannelSearch.value = ''; channelSearch.value = ''; channelPage.value = 1; channelError.value = ''; catalogSource.value = undefined
})
onBeforeUnmount(() => { disposed = true; catalogRequest++; capabilitiesRequest++; catalogController?.abort(); offCatalogSession() })


const leadId = computed(() => typeof route.query.leadId === 'string' ? route.query.leadId : '')
const quoteAvailable = computed(() => Boolean(
  capabilities.value?.productCost.available
  && capabilities.value?.logisticsCatalog.available
  && capabilities.value?.logisticsRate.available,
))
const resultMatrix = computed<Array<Record<string, unknown>>>(() => {
  const result = latestQuotation.value?.versions[0]?.resultSnapshot
  return Array.isArray(result?.combinedMatrix) ? result.combinedMatrix as Array<Record<string, unknown>> : []
})
const matrixRows = computed(() => tiers.value.flatMap((tier) =>
  selectedCountries.value.flatMap((countryCode) =>
    selectedLogisticsChannels.value.map((channel) => ({
      tier,
      country: countries.find((item) => item.code === countryCode),
      channel,
    })),
  ),
).filter((row) => row.country))
const validationMessages = computed(() => {
  const messages: string[] = []
  if (!productReference.value.trim()) messages.push(t('quotes.validationSku'))
  if (productProfitMarginRate.value < 0 || productProfitMarginRate.value >= 100) messages.push(t('quotes.validationProductMargin'))
  if (!selectedCountries.value.length) messages.push(t('quotes.validationCountry'))
  if (!selectedLogisticsChannels.value.length) messages.push(t('quotes.validationChannel'))
  if (packageData.quantity < 1 || packageData.weight <= 0 || packageData.length <= 0 || packageData.width <= 0 || packageData.height <= 0) {
    messages.push(t('quotes.validationPackage'))
  }
  tiers.value.forEach((tier, index) => {
    const number = { index: index + 1 }
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < 1) messages.push(t('quotes.validationMin', number))
    if (tier.maxQuantity !== null && (!Number.isInteger(tier.maxQuantity) || tier.maxQuantity < tier.minQuantity)) {
      messages.push(t('quotes.validationMax', number))
    }
    if (index < tiers.value.length - 1 && tier.maxQuantity === null) messages.push(t('quotes.validationCap', number))
    const previous = tiers.value[index - 1]
    if (previous?.maxQuantity !== null && previous?.maxQuantity !== undefined && tier.minQuantity <= previous.maxQuantity) {
      messages.push(t('quotes.validationOverlap', number))
    }
    if (!tier.customerUnitPrice.trim() || Number(tier.customerUnitPrice) <= 0) {
      messages.push(t('quotes.validationPrice', number))
    }
  })
  selectedLogisticsChannels.value.forEach((channel) => {
    if (channel.logisticsProfitMarginRate < 0 || channel.logisticsProfitMarginRate >= 100) {
      messages.push(t('quotes.validationLogisticsMargin', { channel: channel.actualChannelName }))
    }
  })
  return messages
})
const quoteRequestEnabled = computed(() =>
  quoteAvailable.value
  && validationMessages.value.length === 0
  && !isRequesting.value)
const draftSaveEnabled = computed(() => validationMessages.value.length === 0 && !isSaving.value)

watch(productProfitMarginRate, () => {
  tiers.value = tiers.value.map((tier) => ({
    ...tier,
    customerUnitPrice: tier.purchaseCost
      ? customerAmountFromMargin(tier.purchaseCost, productProfitMarginRate.value)
      : tier.customerUnitPrice,
  }))
})

watch(channelSearch, value => {
  if (!value.trim() && appliedChannelSearch.value) { appliedChannelSearch.value = ''; void loadChannels(1) }
})

async function loadCapabilities() {
  const ticket = ++capabilitiesRequest, session = captureSession()
  capabilityError.value = ''
  try {
    const next = await fopApi.getCapabilities()
    if (disposed || ticket !== capabilitiesRequest || !isCurrentSession(session)) return
    capabilities.value = next
    if (next.logisticsCatalog.available) await loadChannels(1)
    else { catalogRequest++; catalogController?.abort(); actualChannels.value = []; channelTotal.value = 0; channelLoading.value = false; channelError.value = '' }
  } catch {
    if (!disposed && ticket === capabilitiesRequest && isCurrentSession(session)) {
      capabilityError.value = t('quotes.statusError'); capabilities.value = null
      catalogRequest++; catalogController?.abort(); actualChannels.value = []; channelTotal.value = 0; channelLoading.value = false
    }
  }
}

function searchChannels() {
  appliedChannelSearch.value = channelSearch.value.trim()
  void loadChannels(1)
}

async function loadChannels(page = 1) {
  if (!capabilities.value?.logisticsCatalog.available) return
  const ticket = ++catalogRequest, session = captureSession()
  catalogController?.abort()
  const controller = new AbortController(); catalogController = controller
  channelLoading.value = true; channelError.value = ''; actualChannels.value = []
  try {
    const result = await fopApi.searchActualLogisticsChannels({ ...(appliedChannelSearch.value ? { search: appliedChannelSearch.value } : {}), page, pageSize: channelPageSize }, controller.signal)
    if (disposed || ticket !== catalogRequest || !isCurrentSession(session)) return
    actualChannels.value = result.channels.filter(channel => channel.enabled)
    channelTotal.value = result.total; channelPage.value = result.page; catalogSource.value = result.source
  } catch {
    if (!disposed && ticket === catalogRequest && isCurrentSession(session)) { channelTotal.value = 0; channelError.value = t('quotes.channelLoadFailed') }
  } finally {
    if (!disposed && ticket === catalogRequest && isCurrentSession(session)) channelLoading.value = false
  }
}

function addTier() {
  const previous = tiers.value.at(-1)
  const minQuantity = previous?.maxQuantity
    ? previous.maxQuantity + 1
    : Math.max(1, previous?.minQuantity || 1)
  tiers.value.push({
    id: nextTierId.value++,
    minQuantity,
    maxQuantity: null,
    customerUnitPrice: '',
    purchaseCost: '',
  })
}

function removeTier(id: number) {
  if (tiers.value.length > 1) tiers.value = tiers.value.filter((tier) => tier.id !== id)
}

function toggleCountry(country: string) {
  selectedCountries.value = selectedCountries.value.includes(country)
    ? selectedCountries.value.filter((item) => item !== country)
    : [...selectedCountries.value, country]
}

function isChannelSelected(channel: FopActualLogisticsChannel) {
  return selectedLogisticsChannels.value.some((selected) =>
    selected.customChannelCode === channel.customChannelCode
    && selected.actualChannelCode === channel.code)
}

function toggleActualChannel(channel: FopActualLogisticsChannel) {
  const index = selectedLogisticsChannels.value.findIndex((selected) =>
    selected.customChannelCode === channel.customChannelCode
    && selected.actualChannelCode === channel.code)
  if (index >= 0) {
    selectedLogisticsChannels.value.splice(index, 1)
    return
  }
  selectedLogisticsChannels.value.push({
    customChannelCode: channel.customChannelCode,
    customChannelName: channel.customChannelName || channel.customChannelCode,
    actualChannelCode: channel.code,
    actualChannelName: channel.name,
    ...(channel.carrierName ? { carrierName: channel.carrierName } : {}),
    logisticsProfitMarginRate: defaultLogisticsProfitMarginRate.value,
  })
}

function removeSelectedChannel(channel: SelectedLogisticsChannelDraft) {
  selectedLogisticsChannels.value = selectedLogisticsChannels.value.filter((selected) =>
    selected.customChannelCode !== channel.customChannelCode
    || selected.actualChannelCode !== channel.actualChannelCode)
}

async function lookupPurchaseCosts() {
  if (!productReference.value.trim() || !capabilities.value?.productCost.available || costLoading.value) return
  costLoading.value = true
  costError.value = ''
  try {
    const result = await fopApi.getProductPurchaseCosts({
      lineId: productLineId,
      productReference: productReference.value.trim(),
      unit: unit.value,
      currency: currency.value,
      productProfitMarginRate: productProfitMarginRate.value,
      quantityTiers: tiers.value.map((tier) => ({
        minQuantity: tier.minQuantity,
        ...(tier.maxQuantity === null ? {} : { maxQuantity: tier.maxQuantity }),
      })),
    })
    const resultTiers = result.items.find((item) => item.lineId === productLineId)?.tiers || []
    tiers.value = tiers.value.map((tier) => {
      const matched = resultTiers.find((resultTier) =>
        resultTier.minQuantity === tier.minQuantity
        && (resultTier.maxQuantity ?? null) === tier.maxQuantity)
      return matched
        ? {
            ...tier,
            purchaseCost: matched.unitCost,
            customerUnitPrice: matched.customerUnitPrice
              || customerAmountFromMargin(matched.unitCost, productProfitMarginRate.value),
          }
        : tier
    })
    actionMessage.value = t('quotes.costLoaded')
  } catch {
    costError.value = t('quotes.costLoadFailed')
  } finally {
    costLoading.value = false
  }
}

function draftPayload(): QuoteDraftPayload {
  return {
    ...(leadId.value ? { leadId: leadId.value } : {}),
    title: productReference.value.trim()
      ? `${productReference.value.trim()} Quotation`
      : 'Customer Quotation',
    currency: currency.value,
    products: [{
      lineId: productLineId,
      productReference: productReference.value.trim(),
      unit: unit.value,
      productProfitMarginRate: productProfitMarginRate.value,
      quantityTiers: tiers.value.map((tier) => ({
        minQuantity: tier.minQuantity,
        ...(tier.maxQuantity === null ? {} : { maxQuantity: tier.maxQuantity }),
        customerUnitPrice: tier.customerUnitPrice,
        ...(tier.purchaseCost ? { purchaseCost: tier.purchaseCost } : {}),
      })),
    }],
    destinationCountries: [...selectedCountries.value],
    packages: [{ ...packageData }],
    logisticsChannels: selectedLogisticsChannels.value.map((channel) => ({ ...channel })),
  }
}

async function saveDraft(): Promise<boolean> {
  if (!draftSaveEnabled.value) return false
  isSaving.value = true
  saveError.value = ''
  actionMessage.value = ''
  try {
    const quotation = quotationId.value
      ? await quotationApi.createVersion(quotationId.value, draftPayload())
      : await quotationApi.create(draftPayload())
    quotationId.value = quotation.id
    savedVersion.value = quotation.currentVersion
    latestQuotation.value = quotation
    return true
  } catch {
    saveError.value = t('quotes.saveFailed')
    return false
  } finally {
    isSaving.value = false
  }
}

async function requestFopQuote() {
  if (!quoteRequestEnabled.value) return
  isRequesting.value = true
  actionMessage.value = ''
  saveError.value = ''
  try {
    const saved = await saveDraft()
    if (!saved || !quotationId.value) return
    latestQuotation.value = await quotationApi.requestFop(quotationId.value)
    savedVersion.value = latestQuotation.value.currentVersion
    const version = latestQuotation.value.versions[0]
    actionMessage.value = version.productCostStatus === 'succeeded'
      && version.logisticsRateStatus === 'succeeded'
      ? t('quotes.fopQuoteCompleted')
      : t('quotes.fopQuotePartial')
  } catch {
    saveError.value = t('quotes.fopQuoteFailed')
  } finally {
    isRequesting.value = false
  }
}

async function exportQuote() {
  if (!quotationId.value || !savedVersion.value || isExporting.value) return
  isExporting.value = true
  saveError.value = ''
  actionMessage.value = ''
  try {
    const blob = await quotationApi.exportExcel(quotationId.value, savedVersion.value)
    const safeReference = productReference.value.trim().replace(/[^\w.-]+/g, '_') || 'Quotation'
    downloadBlob(blob, `HyperZone_${safeReference}_V${savedVersion.value}.xlsx`)
    actionMessage.value = t('quotes.exportCompleted')
  } catch {
    saveError.value = t('quotes.exportFailed')
  } finally {
    isExporting.value = false
  }
}

function resultFor(row: typeof matrixRows.value[number]) {
  return resultMatrix.value.find((result) =>
    result.minQuantity === row.tier.minQuantity
    && (result.maxQuantity ?? null) === row.tier.maxQuantity
    && result.countryCode === row.country?.code
    && result.customChannelCode === row.channel.customChannelCode
    && result.actualChannelCode === row.channel.actualChannelCode)
}

const matrixTotals = computed(() => (['baseFreightAmount', 'customerFreightAmount', 'combinedAmount'] as const).map(field => {
  const total = sumCompleteMoney(matrixRows.value.map(row => resultFor(row)?.[field]))
  return total === null ? text('待完整报价', 'Awaiting complete quote') : formatCurrency(total, currency.value, String(locale.value))
}))
function quoteMoney(value: unknown) {
  const amount = sumCompleteMoney([value])
  return amount === null ? '—' : formatCurrency(amount, currency.value, String(locale.value))
}

onMounted(loadCapabilities)
</script>

<template>
  <AppLayout>
    <div class="app-page">
      <PageHeader :eyebrow="t('quotes.eyebrow')" :title="t('quotes.title')" :description="t('quotes.description')">
        <template #actions>
          <ReturnButton v-if="leadId" fallback="/leads" />
          <button class="btn btn-secondary" @click="loadCapabilities">
            <RefreshCcw class="h-4 w-4" />{{ t('quotes.refreshStatus') }}
          </button>
        </template>
      </PageHeader>

      <div
        class="notice mb-5"
        :class="quoteAvailable
          ? 'tone-success'
          : 'tone-warning'"
      >
        <CheckCircle2 v-if="quoteAvailable" class="mt-0.5 h-4 w-4 shrink-0" />
        <Info v-else class="mt-0.5 h-4 w-4 shrink-0" />
        <p>{{ capabilityError || (quoteAvailable ? t('quotes.available') : t('quotes.unavailable')) }}</p>
      </div>

      <section class="panel overflow-hidden">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">{{ t('quotes.productQuotation') }}</h2>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="btn btn-secondary"
              :disabled="!productReference.trim() || !capabilities?.productCost.available || costLoading"
              @click="lookupPurchaseCosts"
            >
              <LoaderCircle v-if="costLoading" class="h-4 w-4 animate-spin" />
              <PackageSearch v-else class="h-4 w-4" />
              {{ t('quotes.getPurchaseCost') }}
            </button>
            <button class="btn btn-secondary" @click="addTier">
              <Plus class="h-4 w-4" />{{ t('quotes.addTier') }}
            </button>
          </div>
        </div>
        <div class="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <label>
            <span class="field-label">{{ t('quotes.sku') }}</span>
            <input v-model="productReference" class="input" :placeholder="t('quotes.skuPlaceholder')" />
          </label>
          <label>
            <span class="field-label">{{ t('quotes.unit') }}</span>
            <select v-model="unit" class="input">
              <option value="piece">{{ t('quotes.piece') }}</option>
              <option value="set">{{ t('quotes.set') }}</option>
              <option value="carton">{{ t('quotes.carton') }}</option>
            </select>
          </label>
          <label>
            <span class="field-label">{{ t('quotes.currency') }}</span>
            <select v-model="currency" class="input"><option>USD</option><option>EUR</option><option>GBP</option></select>
          </label>
          <label>
            <span class="field-label">{{ t('quotes.productProfitMargin') }}</span>
            <span class="relative block">
              <input v-model.number="productProfitMarginRate" type="number" min="0" max="99.99" step="0.01" class="input pr-10" />
              <Percent class="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
            </span>
            <span class="field-help">{{ t('quotes.marginFormulaHint') }}</span>
          </label>
        </div>
        <div v-if="costError" class="border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{{ costError }}</div>
        <div class="overflow-x-auto border-t" style="border-color: var(--color-border)">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ t('quotes.minQty') }}</th>
                <th>{{ t('quotes.maxQty') }}</th>
                <th>{{ t('quotes.purchaseCost') }}</th>
                <th>{{ t('quotes.customerPrice') }}</th>
                <th class="w-16" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="tier in tiers" :key="tier.id">
                <td><input v-model.number="tier.minQuantity" type="number" min="1" class="input" /></td>
                <td><input v-model.number="tier.maxQuantity" type="number" :min="tier.minQuantity" class="input" :placeholder="t('quotes.noLimit')" /></td>
                <td>
                  <div class="relative min-w-36">
                    <input :value="tier.purchaseCost" readonly class="input bg-slate-50 pr-14 dark:bg-[#11151a]" :placeholder="t('quotes.pendingFop')" />
                    <span class="absolute right-3 top-3 text-xs font-semibold text-slate-400">{{ currency }}</span>
                  </div>
                </td>
                <td>
                  <div class="relative min-w-36">
                    <input v-model="tier.customerUnitPrice" inputmode="decimal" class="input pr-14" :placeholder="currency" />
                    <span class="absolute right-3 top-3 text-xs font-semibold text-slate-400">{{ currency }}</span>
                  </div>
                </td>
                <td>
                  <button class="icon-btn h-9 w-9 text-slate-400 hover:text-red-600" :title="t('quotes.removeTier')" :disabled="tiers.length === 1" @click="removeTier(tier.id)">
                    <Trash2 class="h-4 w-4" />
                  </button>
                </td>
              </tr>
            </tbody>
            <TableTotals>
              <th scope="row" colspan="2">{{ text('合计', 'Total') }} · {{ tiers.length }} {{ text('档报价', 'price tiers') }}</th>
              <td>{{ text('单价不累加', 'Unit prices are not additive') }}</td><td>{{ text('单价不累加', 'Unit prices are not additive') }}</td><td>—</td>
            </TableTotals>
          </table>
        </div>
      </section>

      <section class="panel mt-5 overflow-hidden">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">{{ t('quotes.freight') }}</h2>
          </div>
        </div>
        <div class="p-5">
          <p class="field-label">{{ t('quotes.destinationCountries') }}</p>
          <div class="flex flex-wrap gap-2">
            <label v-for="country in countries" :key="country.code" class="cursor-pointer">
              <input type="checkbox" class="peer sr-only" :checked="selectedCountries.includes(country.code)" @change="toggleCountry(country.code)" />
              <span class="selection-control inline-flex h-10 min-w-16 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-500 transition dark:border-slate-700 dark:text-slate-400">
                <img :src="country.flagUrl" alt="" class="h-4 w-5 rounded-[2px] object-cover shadow-sm ring-1 ring-black/10" />{{ country.code }}
              </span>
            </label>
          </div>
          <div class="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-7">
            <label><span class="field-label">{{ t('quotes.packages') }}</span><input v-model.number="packageData.quantity" type="number" min="1" class="input" /></label>
            <label><span class="field-label">{{ t('quotes.weight') }}</span><input v-model.number="packageData.weight" type="number" min="0.001" step="0.001" class="input" /></label>
            <label><span class="field-label">{{ t('quotes.weightUnit') }}</span><select v-model="packageData.weightUnit" class="input"><option>kg</option><option>lb</option></select></label>
            <label><span class="field-label">{{ t('quotes.length') }}</span><input v-model.number="packageData.length" type="number" min="0.1" step="0.1" class="input" /></label>
            <label><span class="field-label">{{ t('quotes.width') }}</span><input v-model.number="packageData.width" type="number" min="0.1" step="0.1" class="input" /></label>
            <label><span class="field-label">{{ t('quotes.height') }}</span><input v-model.number="packageData.height" type="number" min="0.1" step="0.1" class="input" /></label>
            <label><span class="field-label">{{ t('quotes.dimensionUnit') }}</span><select v-model="packageData.dimensionUnit" class="input"><option>cm</option><option>in</option></select></label>
          </div>
        </div>

        <div class="border-t p-5" style="border-color: var(--color-border)">
          <div class="mb-4 flex items-center gap-2">
            <Truck class="h-5 w-5 text-orange-600 dark:text-[var(--color-primary)]" />
            <div>
              <h3 class="text-sm font-bold text-slate-950 dark:text-white">{{ t('quotes.logisticsChannels') }}</h3>
            </div>
          </div>
          <div class="grid gap-4 lg:grid-cols-2">
            <form data-testid="actual-channel-search" @submit.prevent="searchChannels">
              <label class="field-label" for="actual-channel-search">{{ t('quotes.actualChannel') }}</label>
              <div class="flex gap-2">
                <input id="actual-channel-search" v-model="channelSearch" type="search" maxlength="120" class="input min-w-0 flex-1" :aria-label="text('搜索实际物流渠道', 'Search actual logistics channels')" :placeholder="t('quotes.channelSearchPlaceholder')" />
                <button class="btn btn-primary shrink-0" type="submit" :disabled="!capabilities?.logisticsCatalog.available"><Search class="h-4 w-4" />{{ t('common.search') }}</button>
              </div>
            </form>
            <label>
              <span class="field-label">{{ t('quotes.defaultLogisticsMargin') }}</span>
              <span class="relative block">
                <input v-model.number="defaultLogisticsProfitMarginRate" type="number" min="0" max="99.99" step="0.01" class="input pr-10" />
                <Percent class="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
              </span>
            </label>
          </div>

          <div v-if="channelLoading" class="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <LoaderCircle class="h-4 w-4 animate-spin" />{{ t('quotes.loadingChannels') }}
          </div>
          <div v-else-if="channelError" class="notice mt-4 border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{{ channelError }}</div>
          <p v-else-if="!capabilities?.logisticsCatalog.available" class="mt-4 text-sm text-slate-500">{{ t('quotes.channelCatalogPending') }}</p>
          <div v-else class="mt-4">
            <div class="mb-2 flex items-center justify-between text-xs text-slate-500"><span>{{ t('quotes.actualLogisticsChannels') }} · {{ channelTotal }}</span><span v-if="catalogSource === 'sandbox'">{{ text('测试渠道', 'Sandbox channels') }}</span></div>
            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <label
                v-for="channel in actualChannels"
                :key="`${channel.customChannelCode}:${channel.code}`"
                class="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition"
                :class="isChannelSelected(channel)
                  ? 'selection-active'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'"
              >
                <input type="checkbox" :aria-label="`${text('选择实际物流渠道', 'Select actual logistics channel')} ${channel.code}`" class="mt-1 h-4 w-4 accent-orange-600 dark:accent-[#a38a72]" :checked="isChannelSelected(channel)" @change="toggleActualChannel(channel)" />
                <span class="min-w-0">
                  <strong class="block text-sm text-slate-950 dark:text-white">{{ channel.name }}</strong>
                  <span class="mt-0.5 block text-xs text-slate-500">{{ channel.code }}<template v-if="channel.carrierName"> · {{ channel.carrierName }}</template></span>
                </span>
              </label>
            </div>
            <p v-if="!actualChannels.length" class="mt-3 text-sm text-slate-500">{{ t('quotes.noActualChannels') }}</p>
            <div v-if="channelTotal > channelPageSize" class="mt-3 flex items-center justify-end gap-3 text-xs text-slate-500">
              <button type="button" class="btn btn-secondary" :disabled="channelPage <= 1" :aria-label="text('上一页物流渠道', 'Previous channel page')" @click="loadChannels(channelPage - 1)">{{ text('上一页', 'Previous') }}</button>
              <span>{{ channelPage }} / {{ channelPages }}</span>
              <button type="button" class="btn btn-secondary" :disabled="channelPage >= channelPages" :aria-label="text('下一页物流渠道', 'Next channel page')" @click="loadChannels(channelPage + 1)">{{ text('下一页', 'Next') }}</button>
            </div>
          </div>

          <div v-if="selectedLogisticsChannels.length" data-testid="selected-logistics-channels" class="mt-5 overflow-x-auto rounded-md border" style="border-color: var(--color-border)">
            <table class="data-table">
              <thead><tr><th>{{ t('quotes.logisticsProvider') }}</th><th>{{ t('quotes.actualChannel') }}</th><th>{{ t('quotes.logisticsProfitMargin') }}</th><th class="w-16" /></tr></thead>
              <tbody>
                <tr v-for="channel in selectedLogisticsChannels" :key="`${channel.customChannelCode}:${channel.actualChannelCode}`">
                  <td>{{ channel.carrierName || '—' }}</td>
                  <td><strong>{{ channel.actualChannelName }}</strong><p class="text-xs text-slate-500">{{ channel.actualChannelCode }}</p></td>
                  <td><div class="relative max-w-40"><input v-model.number="channel.logisticsProfitMarginRate" :aria-label="`${text('物流毛利率', 'Logistics gross margin')} ${channel.actualChannelCode}`" type="number" min="0" max="99.99" step="0.01" class="input pr-10" /><Percent class="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" /></div></td>
                  <td><button class="icon-btn text-slate-400 hover:text-red-600" :title="t('common.delete')" @click="removeSelectedChannel(channel)"><Trash2 class="h-4 w-4" /></button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="mt-4 text-sm text-slate-500">{{ t('quotes.noSelectedChannels') }}</p>
        </div>
      </section>

      <section class="panel mt-5 overflow-hidden">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">{{ t('quotes.matrix') }}</h2>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="btn btn-secondary"
              :disabled="!quotationId || !savedVersion || isExporting"
              @click="exportQuote"
            >
              <LoaderCircle v-if="isExporting" class="h-4 w-4 animate-spin" />
              <Download v-else class="h-4 w-4" />
              {{ isExporting ? t('quotes.exportingExcel') : t('quotes.exportExcel') }}
            </button>
            <button class="btn btn-secondary" :disabled="!draftSaveEnabled" @click="saveDraft">
              <LoaderCircle v-if="isSaving" class="h-4 w-4 animate-spin" />
              <Save v-else class="h-4 w-4" />
              {{ savedVersion ? t('quotes.saveVersion', { version: savedVersion + 1 }) : t('quotes.saveDraft') }}
            </button>
            <button class="btn btn-primary" :disabled="!quoteRequestEnabled" @click="requestFopQuote">
              <LoaderCircle v-if="isRequesting" class="h-4 w-4 animate-spin" />
              <Calculator v-else class="h-4 w-4" />
              {{ t('quotes.requestFop') }}
            </button>
          </div>
        </div>
        <div v-if="savedVersion || saveError || actionMessage" class="border-b px-5 py-3 text-sm" :class="saveError ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'">
          {{ saveError || actionMessage || t('quotes.draftSaved', { version: savedVersion }) }}
        </div>
        <div v-if="validationMessages.length" class="border-b tone-warning px-5 py-3 text-sm">
          {{ validationMessages[0] }}<span v-if="validationMessages.length > 1"> · {{ t('quotes.moreErrors', { count: validationMessages.length - 1 }) }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="data-table min-w-[1240px]">
            <thead>
              <tr>
                <th>{{ t('quotes.quantityTier') }}</th>
                <th>{{ t('quotes.destination') }}</th>
                <th>{{ t('quotes.logisticsProvider') }}</th>
                <th>{{ t('quotes.actualChannel') }}</th>
                <th>{{ t('quotes.product') }}</th>
                <th>{{ t('quotes.baseFreight') }}</th>
                <th>{{ t('quotes.customerFreight') }}</th>
                <th>{{ t('quotes.combined') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in matrixRows" :key="`${row.tier.id}-${row.country?.code}-${row.channel.customChannelCode}-${row.channel.actualChannelCode}`">
                <td>{{ row.tier.minQuantity }} - {{ row.tier.maxQuantity || '∞' }} {{ t(`quotes.${unit}`) }}</td>
                <td><span v-if="row.country" class="inline-flex items-center gap-2 font-semibold"><img :src="row.country.flagUrl" alt="" class="h-4 w-5 rounded-[2px] object-cover shadow-sm ring-1 ring-black/10" />{{ row.country.code }}</span></td>
                <td>{{ row.channel.carrierName || '—' }}</td>
                <td><strong>{{ row.channel.actualChannelName }}</strong><p class="text-xs text-slate-500">{{ row.channel.actualChannelCode }} · {{ row.channel.logisticsProfitMarginRate }}%</p></td>
                <td>{{ quoteMoney(resultFor(row)?.customerProductUnitPrice ?? row.tier.customerUnitPrice) }}</td>
                <td>{{ quoteMoney(resultFor(row)?.baseFreightAmount) }}</td>
                <td>{{ quoteMoney(resultFor(row)?.customerFreightAmount) }}</td>
                <td class="font-bold text-slate-950 dark:text-white">{{ quoteMoney(resultFor(row)?.combinedAmount) }}</td>
              </tr>
              <tr v-if="!matrixRows.length"><td colspan="8" class="text-center text-slate-500">{{ t('quotes.selectCountryAndChannel') }}</td></tr>
            </tbody>
            <TableTotals>
              <th scope="row" colspan="4">{{ text('方案金额合计', 'Quote options total') }} · {{ matrixRows.length }} {{ text('项', 'options') }}<br /><small>{{ text('仅列表统计，各方案独立报价', 'List statistics only; each option is a separate quote') }}</small></th>
              <td>{{ text('单价不累加', 'Unit prices are not additive') }}</td>
              <td v-for="(total, index) in matrixTotals" :key="index">{{ total }}</td>
            </TableTotals>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

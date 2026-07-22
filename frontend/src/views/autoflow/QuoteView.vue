<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Calculator, Plus, RefreshCcw, Trash2 } from 'lucide-vue-next'
import { AppLayout } from '@/components/layout'
import { fopApi, type FopCapabilities } from '@/api/fop'

interface ProductTier {
  id: number
  minQuantity: number
  maxQuantity: number | null
  customerUnitPrice: string
}

const route = useRoute()
const capabilities = ref<FopCapabilities | null>(null)
const capabilityError = ref('')
const productReference = ref('')
const unit = ref('piece')
const currency = ref('USD')
const tiers = ref<ProductTier[]>([
  { id: 1, minQuantity: 1, maxQuantity: 99, customerUnitPrice: '' },
  { id: 2, minQuantity: 100, maxQuantity: 499, customerUnitPrice: '' },
  { id: 3, minQuantity: 500, maxQuantity: null, customerUnitPrice: '' },
])
const nextTierId = ref(4)
const countries = ['US', 'GB', 'DE', 'FR', 'CA', 'AU']
const selectedCountries = ref(['US'])
const packageData = reactive({ quantity: 1, weight: 1, weightUnit: 'kg', length: 20, width: 15, height: 10, dimensionUnit: 'cm' })

const leadId = computed(() => typeof route.query.leadId === 'string' ? route.query.leadId : '')
const quoteAvailable = computed(() => Boolean(capabilities.value?.productCost.available && capabilities.value?.logisticsRate.available))
const matrixRows = computed(() => tiers.value.flatMap((tier) => selectedCountries.value.map((country) => ({ tier, country }))))
const validationMessages = computed(() => {
  const messages: string[] = []
  if (!productReference.value.trim()) messages.push('FOP product / SKU reference is required.')
  if (selectedCountries.value.length === 0) messages.push('Select at least one destination country.')
  if (packageData.quantity < 1 || packageData.weight <= 0 || packageData.length <= 0 || packageData.width <= 0 || packageData.height <= 0) {
    messages.push('Package quantity, weight and dimensions must be greater than zero.')
  }
  tiers.value.forEach((tier, index) => {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < 1) messages.push(`Tier ${index + 1} has an invalid minimum quantity.`)
    if (tier.maxQuantity !== null && (!Number.isInteger(tier.maxQuantity) || tier.maxQuantity < tier.minQuantity)) {
      messages.push(`Tier ${index + 1} has an invalid maximum quantity.`)
    }
    if (index < tiers.value.length - 1 && tier.maxQuantity === null) messages.push(`Tier ${index + 1} must have a maximum quantity.`)
    const previous = tiers.value[index - 1]
    if (previous?.maxQuantity !== null && previous?.maxQuantity !== undefined && tier.minQuantity <= previous.maxQuantity) {
      messages.push(`Tier ${index + 1} overlaps the previous tier.`)
    }
    if (!tier.customerUnitPrice.trim() || Number(tier.customerUnitPrice) <= 0) messages.push(`Tier ${index + 1} needs a positive customer unit price.`)
  })
  return messages
})
const quoteRequestEnabled = computed(() => quoteAvailable.value && validationMessages.value.length === 0)

async function loadCapabilities() {
  capabilityError.value = ''
  try {
    capabilities.value = await fopApi.getCapabilities()
  } catch {
    capabilityError.value = 'Unable to read FOP integration status.'
  }
}

function addTier() {
  const previous = tiers.value.at(-1)
  const minQuantity = previous?.maxQuantity ? previous.maxQuantity + 1 : Math.max(1, previous?.minQuantity || 1)
  tiers.value.push({ id: nextTierId.value++, minQuantity, maxQuantity: null, customerUnitPrice: '' })
}

function removeTier(id: number) {
  if (tiers.value.length > 1) tiers.value = tiers.value.filter((tier) => tier.id !== id)
}

function toggleCountry(country: string) {
  selectedCountries.value = selectedCountries.value.includes(country)
    ? selectedCountries.value.filter((item) => item !== country)
    : [...selectedCountries.value, country]
}

onMounted(loadCapabilities)
</script>

<template>
  <AppLayout>
    <div class="min-h-full bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-6">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <p class="text-sm font-medium text-slate-500">FOP-backed quotation</p>
          <h1 class="mt-1 text-2xl font-semibold">Quote workspace</h1>
          <p v-if="leadId" class="mt-1 text-xs text-slate-500">Lead {{ leadId }}</p>
        </div>
        <button class="btn btn-secondary gap-2 text-sm" title="Refresh FOP integration status" @click="loadCapabilities">
          <RefreshCcw class="h-4 w-4" />
          Refresh status
        </button>
      </div>

      <div class="mt-5 flex items-start gap-3 border-l-4 px-4 py-3 text-sm"
        :class="quoteAvailable ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200'">
        <Calculator class="mt-0.5 h-4 w-4 shrink-0" />
        <p v-if="capabilityError">{{ capabilityError }}</p>
        <p v-else-if="quoteAvailable">FOP product-cost and logistics-rate capabilities are available.</p>
        <p v-else>Quote controls are ready. Live Kingdee Cloud Cosmic cost and freight adapters are not implemented yet.</p>
      </div>

      <section class="mt-6 border-y border-slate-200 bg-white py-5 dark:border-slate-800 dark:bg-slate-900">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5">
          <div>
            <h2 class="font-semibold">Product quotation</h2>
            <p class="mt-1 text-sm text-slate-500">Quantity tiers and customer-facing unit prices</p>
          </div>
          <button class="btn btn-secondary gap-2 text-sm" @click="addTier">
            <Plus class="h-4 w-4" />
            Add tier
          </button>
        </div>

        <div class="mt-4 grid gap-3 px-4 sm:grid-cols-3 sm:px-5">
          <label class="text-sm">FOP product / SKU reference<input v-model="productReference" class="input mt-1" placeholder="Required for live pricing" /></label>
          <label class="text-sm">Unit<select v-model="unit" class="input mt-1"><option value="piece">Piece</option><option value="set">Set</option><option value="carton">Carton</option></select></label>
          <label class="text-sm">Currency<select v-model="currency" class="input mt-1"><option>USD</option><option>EUR</option><option>GBP</option></select></label>
        </div>

        <div class="mt-4 overflow-x-auto border-t border-slate-200 dark:border-slate-800">
          <table class="w-full min-w-[680px] text-left text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950">
              <tr><th class="px-5 py-3">Min quantity</th><th class="px-5 py-3">Max quantity</th><th class="px-5 py-3">Customer unit price</th><th class="w-16 px-5 py-3"></th></tr>
            </thead>
            <tbody>
              <tr v-for="tier in tiers" :key="tier.id" class="border-t border-slate-200 dark:border-slate-800">
                <td class="px-5 py-3"><input v-model.number="tier.minQuantity" type="number" min="1" class="input" /></td>
                <td class="px-5 py-3"><input v-model.number="tier.maxQuantity" type="number" :min="tier.minQuantity" class="input" placeholder="No limit" /></td>
                <td class="px-5 py-3"><input v-model="tier.customerUnitPrice" inputmode="decimal" class="input" :placeholder="currency" /></td>
                <td class="px-5 py-3">
                  <button class="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950" title="Remove tier" :disabled="tiers.length === 1" @click="removeTier(tier.id)">
                    <Trash2 class="h-4 w-4" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="mt-6 border-y border-slate-200 bg-white px-4 py-5 dark:border-slate-800 dark:bg-slate-900 sm:px-5">
        <h2 class="font-semibold">Destination freight</h2>
        <div class="mt-4 flex flex-wrap gap-2">
          <label v-for="country in countries" :key="country" class="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
            <input type="checkbox" :checked="selectedCountries.includes(country)" @change="toggleCountry(country)" />
            {{ country }}
          </label>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-7">
          <label class="text-sm">Packages<input v-model.number="packageData.quantity" type="number" min="1" class="input mt-1" /></label>
          <label class="text-sm">Weight<input v-model.number="packageData.weight" type="number" min="0.001" step="0.001" class="input mt-1" /></label>
          <label class="text-sm">Weight unit<select v-model="packageData.weightUnit" class="input mt-1"><option>kg</option><option>lb</option></select></label>
          <label class="text-sm">Length<input v-model.number="packageData.length" type="number" min="0.1" step="0.1" class="input mt-1" /></label>
          <label class="text-sm">Width<input v-model.number="packageData.width" type="number" min="0.1" step="0.1" class="input mt-1" /></label>
          <label class="text-sm">Height<input v-model.number="packageData.height" type="number" min="0.1" step="0.1" class="input mt-1" /></label>
          <label class="text-sm">Dimension unit<select v-model="packageData.dimensionUnit" class="input mt-1"><option>cm</option><option>in</option></select></label>
        </div>
      </section>

      <section class="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div><h2 class="font-semibold">Combined quote matrix</h2><p class="mt-1 text-sm text-slate-500">Product tier × destination × FOP channel</p></div>
          <button class="btn btn-primary text-sm" :disabled="!quoteRequestEnabled" :title="quoteAvailable ? 'Complete all required quote conditions' : 'Live FOP adapters are not implemented'">Request FOP quote</button>
        </div>
        <div v-if="validationMessages.length" class="border-b border-slate-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 dark:border-slate-800 dark:bg-amber-950 dark:text-amber-200">
          {{ validationMessages[0] }}<span v-if="validationMessages.length > 1"> +{{ validationMessages.length - 1 }} more</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-950"><tr><th class="px-5 py-3">Quantity tier</th><th class="px-5 py-3">Destination</th><th class="px-5 py-3">Channel</th><th class="px-5 py-3">Product</th><th class="px-5 py-3">Freight</th><th class="px-5 py-3">Combined</th></tr></thead>
            <tbody>
              <tr v-for="row in matrixRows" :key="`${row.tier.id}-${row.country}`" class="border-t border-slate-200 dark:border-slate-800">
                <td class="px-5 py-3">{{ row.tier.minQuantity }} - {{ row.tier.maxQuantity || '∞' }} {{ unit }}</td>
                <td class="px-5 py-3">{{ row.country }}</td>
                <td class="px-5 py-3 text-slate-500">Pending FOP</td>
                <td class="px-5 py-3">{{ row.tier.customerUnitPrice || '—' }} {{ currency }}</td>
                <td class="px-5 py-3">—</td>
                <td class="px-5 py-3">—</td>
              </tr>
              <tr v-if="matrixRows.length === 0"><td colspan="6" class="px-5 py-8 text-center text-slate-500">Select at least one destination country.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

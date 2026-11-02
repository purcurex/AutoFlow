<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import 'flag-icons/css/flag-icons.min.css'
import { normalizeShippingCountry } from '@/utils/shipping-country'

const props = defineProps<{ code?: string | null }>()
const { locale } = useI18n()
const country = computed(() => normalizeShippingCountry(props.code))
const label = computed(() => {
  if (!country.value) return String(locale.value).startsWith('zh') ? '收货国家待确认' : 'Delivery country unavailable'
  return new Intl.DisplayNames([String(locale.value)], { type: 'region' }).of(country.value) || country.value
})
</script>

<template>
  <span v-if="country" class="shipping-country" :title="label" :aria-label="`${label} ${country}`">
    <span class="country-flag fi" :class="`fi-${country.toLowerCase()}`" aria-hidden="true" />
    <span class="country-code">{{ country }}</span>
  </span>
  <span v-else class="country-unknown" :title="label">—</span>
</template>

<style scoped>
.shipping-country { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.country-flag { width: 22px; height: 16px; border-radius: 2px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-border) 60%, transparent); }
.country-code { font-size: 12px; font-weight: 500; letter-spacing: .03em; color: var(--color-text); }
.country-unknown { color: var(--color-text-secondary); }
</style>

<script setup lang="ts">
import type { LogisticsInfo } from '@/api/fop-orders'
import { useI18n } from 'vue-i18n'
import TrackingNumberCopy from './TrackingNumberCopy.vue'
const props = defineProps<{ groups?: LogisticsInfo[] | null; carrier?: string | null; trackingNumber?: string | null }>()
const { locale } = useI18n()
const labels = { full: ['QC', '全程', 'Full route'], first_mile: ['TC', '头程', 'First mile'], last_mile: ['WC', '尾程', 'Last mile'] }
</script>

<template>
  <div class="logistics-info">
    <template v-if="groups?.length">
      <div v-for="(group, index) in groups" :key="index" class="logistics-group">
        <span class="logistics-carrier">{{ group.carrierName || '—' }}</span>
        <TrackingNumberCopy v-if="group.shopifyTracking" class="logistics-tracking" :number="group.shopifyTracking.number" :prefix="labels[group.shopifyTracking.type][0]" :title="`${labels[group.shopifyTracking.type][String(locale).startsWith('zh') ? 1 : 2]}: ${group.shopifyTracking.number}`" />
        <span v-else class="logistics-tracking">—</span>
      </div>
    </template>
    <div v-else class="logistics-group">
      <span class="logistics-carrier">{{ props.carrier || '—' }}</span>
      <span class="logistics-tracking">—</span>
    </div>
  </div>
</template>

<style scoped>
.logistics-info, .logistics-group { display: flex; flex-direction: column; min-width: 0; }
.logistics-info { gap: 10px; }
.logistics-group { gap: 3px; line-height: 1.6; overflow-wrap: anywhere; }
.logistics-carrier { font-weight: 550; }
.logistics-tracking { color: var(--color-text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
</style>

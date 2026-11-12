<script setup lang="ts">
import { computed } from 'vue'
import type { LogisticsInfo, LogisticsChannel } from '@/api/fop-orders'
import { useI18n } from 'vue-i18n'
import TrackingNumberCopy from './TrackingNumberCopy.vue'
const props = defineProps<{ groups?: LogisticsInfo[] | null; channels?: LogisticsChannel[] | null; carrier?: string | null; trackingNumber?: string | null; showAllTracking?: boolean; missingTrackingText?: string }>()
const { locale } = useI18n()
const rows = computed(() => props.groups?.length ? props.groups.map(group => ({
  channelName: group.channelName || (props.groups?.length === 1 && props.channels?.length === 1 ? props.channels[0]?.name : null),
  tracking: props.showAllTracking ? group.trackingNumbers ?? [] : group.shopifyTracking ? [group.shopifyTracking] : [],
})) : props.channels?.length ? props.channels.map(channel => ({ channelName: channel.name, tracking: [] })) : [{ channelName: null, tracking: [] }])
const labels = { full: ['QC', '全程', 'Full route'], first_mile: ['TC', '头程', 'First mile'], last_mile: ['WC', '尾程', 'Last mile'] }
</script>

<template>
  <div class="logistics-info">
    <div v-for="(row, index) in rows" :key="index" class="logistics-group">
      <span class="logistics-channel-name">{{ row.channelName || '—' }}</span>
      <div v-for="tracking in row.tracking" :key="(tracking.type ?? 'package') + ':' + tracking.number" class="logistics-tracking">
        <TrackingNumberCopy :number="tracking.number" :title="tracking.type ? `${labels[tracking.type][String(locale).startsWith('zh') ? 1 : 2]}: ${tracking.number}` : tracking.number" />
        <span v-if="tracking.type" class="tracking-type" :title="labels[tracking.type][String(locale).startsWith('zh') ? 1 : 2]">{{ labels[tracking.type][0] }}</span>
      </div>
      <span v-if="!row.tracking.length" class="logistics-tracking">{{ missingTrackingText || '—' }}</span>
    </div>
  </div>
</template>

<style scoped>
.logistics-info, .logistics-group { display: flex; flex-direction: column; min-width: 0; }
.logistics-info { gap: 10px; }
.logistics-channel { display: flex; flex-direction: column; gap: 3px; overflow-wrap: anywhere; font-size: 11px; color: var(--color-text-secondary); }
.logistics-group { gap: 3px; line-height: 1.6; overflow-wrap: anywhere; }
.logistics-channel-name { font-weight: 550; }
.tracking-type{flex-shrink:0;border:1px solid var(--color-border);border-radius:3px;padding:0 4px;font-size:10px;color:var(--color-text-secondary)}
.logistics-tracking { display:flex;align-items:center;gap:5px;color: var(--color-text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
</style>

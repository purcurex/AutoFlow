<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogisticsChannel, LogisticsInfo } from '@/api/fop-orders'
import OrderLogisticsInfo from './OrderLogisticsInfo.vue'

const props = defineProps<{ customChannel?: string | null; channels?: LogisticsChannel[] | null; groups?: LogisticsInfo[] | null; showTracking?: boolean; missingTrackingText?: string }>()
const { locale } = useI18n()
const actualNames = computed(() => [...new Set(props.channels?.map(channel => channel.name?.trim()).filter(Boolean))].join(' / ') || '—')
</script>

<template>
  <div class="review-channels">
    <span class="custom-channel-name">{{ customChannel?.trim() || '—' }}</span>
    <OrderLogisticsInfo v-if="showTracking" :groups="groups" :channels="channels" :missing-tracking-text="missingTrackingText ?? (String(locale).startsWith('zh') ? '尚未获取' : 'Not yet obtained')" />
    <span v-else class="actual-channel-name">{{ actualNames }}</span>
  </div>
</template>

<style scoped>
.review-channels { display: grid; gap: 4px; line-height: 1.6; min-width: 0; overflow-wrap: anywhere; }
.custom-channel-name { color: var(--color-text-secondary); font-size: 11px; }
.actual-channel-name { font-weight: 550; }
</style>

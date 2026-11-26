<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { canFilterTaskStatus, taskStatusLabels } from '@/utils/workbench-status'
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'

const props = defineProps<{ type?: string | null; reason?: string | null; compact?: boolean }>()
const { locale } = useI18n()
const label = computed(() => canFilterTaskStatus('exceptions', props.type)
  ? taskStatusLabels[props.type][locale.value.startsWith('zh') ? 0 : 1] : undefined)
</script>

<template>
  <WorkbenchStatusBadge v-if="label" class="exception-type-badge" :class="{ compact }"
    :data-exception-type="type" :style="{ '--badge-ink': `var(--color-exception-${type})` }"
    :title="reason || undefined" :tabindex="reason ? 0 : undefined">{{ label }}</WorkbenchStatusBadge>
</template>

<style scoped>
.exception-type-badge{white-space:nowrap;flex-shrink:0}
.exception-type-badge.compact{font-size:10px}
</style>

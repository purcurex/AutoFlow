<script setup lang="ts">
import { computed } from 'vue'
import type { OpportunityOption } from '@/api/opportunities'
import { optionLabel } from '@/api/opportunities'
const props = defineProps<{ value?: string | null; options: OpportunityOption[] }>()
const index = computed(() => props.options.findIndex(item => item.value === props.value))
</script>
<template><span class="opportunity-stage" :class="`stage-${index}`">{{ optionLabel(options, value) }}</span></template>
<style scoped>
.opportunity-stage{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:4px 8px;border-radius:5px;color:var(--color-text-secondary);background:color-mix(in srgb,currentColor 8%,transparent);font-size:12px;font-weight:600}.opportunity-stage:before{content:'';width:5px;height:5px;border-radius:50%;background:currentColor}.stage-0{color:#64748b}.stage-1{color:#3b82f6}.stage-2{color:#8b5cf6}.stage-3{color:#d97706}.stage-4{color:#0891b2}.stage-5{color:#059669}.stage-6{color:#dc6666}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import WorkbenchStatusBadge from './WorkbenchStatusBadge.vue'
import { taskStatusLabels, type TaskStatus } from '@/utils/workbench-status'
const props=defineProps<{ exception?: { type: string | null; reason?: string | null } | null }>()
const {locale}=useI18n()
const label=computed(()=>props.exception?.type?.endsWith('_exception') ? taskStatusLabels[props.exception.type as TaskStatus]?.[locale.value.startsWith('zh')?0:1] : undefined)
</script>
<template><div v-if="label" class="order-exception-label"><WorkbenchStatusBadge tone="danger" :title="exception?.reason || undefined" :tabindex="exception?.reason ? 0 : undefined">{{ label }}</WorkbenchStatusBadge></div></template>
<style scoped>
.order-exception-label{display:flex;justify-content:flex-start;margin-top:6px;white-space:nowrap}
</style>

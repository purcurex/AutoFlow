<script setup lang="ts">
import ExceptionTypeBadge from './ExceptionTypeBadge.vue'
import { canFilterTaskStatus } from '@/utils/workbench-status'
defineProps<{ exception?: { type: string | null; reason?: string | null } | null }>()
</script>
<template><div v-if="canFilterTaskStatus('exceptions', exception?.type)" class="order-exception-label"><ExceptionTypeBadge :type="exception?.type" :reason="exception?.reason" /></div></template>
<style scoped>
.order-exception-label{display:flex;justify-content:flex-start;margin-top:6px;white-space:nowrap}
</style>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { opportunitiesApi, opportunityError } from '@/api/opportunities'
import { crmMockOpportunitiesApi, isCrmMockId } from '@/mocks/crm'
import { onSessionReset } from '@/utils/session'
const props = defineProps<{ leadId: string }>()
const router = useRouter(), busy = ref(false), error = ref('')
let generation = 0
const cleanup = onSessionReset(() => { generation++; error.value = ''; busy.value = false })
onBeforeUnmount(() => { generation++; cleanup() })
async function generate() {
  if (busy.value) return
  const ticket = ++generation
  busy.value = true; error.value = ''
  try { const opportunity = await (isCrmMockId(props.leadId) ? crmMockOpportunitiesApi : opportunitiesApi).fromLead(props.leadId); if (ticket === generation) await router.push(`/opportunities/${opportunity.id}`) }
  catch (e) { if (ticket === generation) error.value = opportunityError(e) }
  finally { if (ticket === generation) busy.value = false }
}
</script>
<template><span class="opportunity-generate"><button type="button" class="btn btn-secondary" :disabled="busy" @click="generate">{{ busy ? '生成中…' : '生成商机' }}</button><span v-if="error" role="alert" class="block text-xs text-red-600 mt-1">{{ error }}</span></span></template>

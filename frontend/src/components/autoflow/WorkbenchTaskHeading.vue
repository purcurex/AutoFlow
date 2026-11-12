<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, inject, onBeforeUnmount } from 'vue'
import { workbenchReplicaContext } from '@/composables/workbenchReplicaContext'
import type { WorkbenchDataAvailability, WorkbenchReplicaSnapshot } from '@/api/workbench-replica'
const props = defineProps<{ title: string; dataAvailability?: WorkbenchDataAvailability; description?: string; replica?: WorkbenchReplicaSnapshot; syncDisabled?: boolean }>()
const { locale } = useI18n()
const zh = computed(() => String(locale.value).startsWith('zh'))
const partial = computed(() => props.dataAvailability?.mode === 'collected' || props.replica?.dataMode === 'collected')
const sourceTime = computed(() => {
  const value = props.replica?.sourceSyncedAt
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(zh.value ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) + ' · UTC+8' : '—'
})
const emit = defineEmits<{ 'replica-synced': [] }>()
const unregister = inject(workbenchReplicaContext, undefined)?.register({
  replica: computed(() => props.replica), disabled: computed(() => !!props.syncDisabled),
  reload: () => emit('replica-synced'),
})
onBeforeUnmount(() => unregister?.())
</script>

<template>
  <header class="workbench-task-heading">
    <div class="task-heading-copy">
      <h2>{{ title }}</h2>
      <p v-if="description" class="task-heading-description" :title="description">{{ description }}</p>
    </div>
    <div class="task-heading-actions"><slot /></div>
    <p v-if="partial" class="collection-notice" role="status">{{ zh ? '已采集数据 · 只读 · 部分字段待提供' : 'Collected data · Read-only · Some fields unavailable' }} · {{ zh ? '采集时点' : 'Source as of' }} {{ sourceTime }}<span v-if="dataAvailability?.reason"> · {{ dataAvailability.reason }}</span><span v-else-if="dataAvailability?.missingDatasets?.length || replica?.missingDatasets?.length"> · {{ zh ? '本清单所需业务单据尚未采集，当前空白不代表没有待办。' : 'Required documents have not been collected. An empty list does not establish that there are no tasks.' }}</span></p>
  </header>
</template>

<style scoped>
.workbench-task-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; margin-bottom: 20px; }
h2 { font-size: 21px; font-weight: 750; letter-spacing: -.03em; line-height: 1.4; }
.collection-notice { flex-basis: 100%; margin: 0; color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.task-heading-actions { display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end; gap:12px; }
@media (max-width: 700px) { h2 { font-size: 18px; } }
</style>

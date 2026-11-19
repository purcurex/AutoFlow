<script setup lang="ts">
import { computed, inject, onBeforeUnmount } from 'vue'
import { workbenchReplicaContext } from '@/composables/workbenchReplicaContext'
import type { WorkbenchDataAvailability, WorkbenchReplicaSnapshot } from '@/api/workbench-replica'
const props = defineProps<{ title: string; dataAvailability?: WorkbenchDataAvailability; description?: string; replica?: WorkbenchReplicaSnapshot; syncDisabled?: boolean }>()
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
      <p v-if="description" class="task-heading-description">{{ description }}</p>
    </div>
    <div class="task-heading-actions"><slot /></div>
  </header>
</template>

<style scoped>
.workbench-task-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; margin-bottom: 20px; }
h2 { font-size: 21px; font-weight: 750; letter-spacing: -.03em; line-height: 1.4; }
.task-heading-actions { display:flex; align-items:center; flex-wrap:wrap; justify-content:flex-end; gap:12px; margin-inline-start:auto; }
@media (max-width: 700px) { h2 { font-size: 18px; } }
</style>

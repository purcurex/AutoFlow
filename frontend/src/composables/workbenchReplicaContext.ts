import { computed, provide, shallowRef, type ComputedRef, type InjectionKey } from 'vue'
import type { WorkbenchReplicaSnapshot } from '@/api/workbench-replica'

interface ReplicaList {
  replica: ComputedRef<WorkbenchReplicaSnapshot | undefined>
  disabled: ComputedRef<boolean>
  reload: () => void
}
export const workbenchReplicaContext: InjectionKey<{ register: (list: ReplicaList) => () => void }> = Symbol('workbench-replica')

/** One shared action; list headings supply only their snapshot, busy state and local reload. */
export function provideWorkbenchReplica() {
  const current = shallowRef<ReplicaList>()
  provide(workbenchReplicaContext, { register(list) {
    current.value = list
    return () => { if (current.value === list) current.value = undefined }
  } })
  return {
    replica: computed(() => current.value?.replica.value),
    disabled: computed(() => current.value?.disabled.value ?? false),
    navigationReady: computed(() => !!current.value && !current.value.disabled.value),
    reload: () => current.value?.reload(),
  }
}

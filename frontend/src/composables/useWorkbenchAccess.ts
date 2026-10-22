import { computed, shallowRef } from 'vue'
import { getWorkbenchAccess, type WorkbenchAccess } from '@/api/workbench-access'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'

// This is a display snapshot only. Every workbench navigation refreshes it from the server.
const access = shallowRef<WorkbenchAccess>()
let requestId = 0
export function clearWorkbenchAccess() { requestId++; access.value = undefined }
onSessionReset(clearWorkbenchAccess)
export async function refreshWorkbenchAccess() {
  const session = captureSession()
  const request = ++requestId
  access.value = undefined
  const result = await getWorkbenchAccess()
  assertCurrentSession(session)
  if (request !== requestId) throw new Error('Workbench access request superseded')
  access.value = result
  return result
}
export function useWorkbenchAccess() {
  return { access, roles: computed(() => access.value?.roles ?? []), isAdmin: computed(() => access.value?.isAdmin === true) }
}

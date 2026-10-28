import { computed, shallowRef } from 'vue'
import { getWorkbenchAccess, type WorkbenchAccess } from '@/api/workbench-access'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'
import { workbenchRoles } from '@/utils/workbench'

// This is a display snapshot only. Every workbench navigation refreshes it from the server.
const access = shallowRef<WorkbenchAccess>()
let requestId = 0
export function clearWorkbenchAccess() { requestId++; access.value = undefined }
onSessionReset(clearWorkbenchAccess)
export async function refreshWorkbenchAccess() {
  const session = captureSession()
  const request = ++requestId
  // Keep this session's display structure while the server rechecks authorization.
  // Data endpoints still enforce permissions on every query; errors/revocation clear the snapshot.
  try {
    const result = await getWorkbenchAccess()
    assertCurrentSession(session)
    if (request !== requestId) throw new Error('Workbench access request superseded')
    const orderedAccess = { ...result, roles: workbenchRoles.filter(role => result.roles.includes(role)) }
    access.value = orderedAccess
    return orderedAccess
  } catch (cause) {
    if (request === requestId) access.value = undefined
    throw cause
  }
}
export function useWorkbenchAccess() {
  return { access, roles: computed(() => access.value?.roles ?? []), isAdmin: computed(() => access.value?.isAdmin === true) }
}

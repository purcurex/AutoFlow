import { readonly, shallowRef } from 'vue'

const epoch = shallowRef(0)
const resetters = new Set<() => void>()
export const sessionEpoch = readonly(epoch)
export const captureSession = () => epoch.value
export const isCurrentSession = (value: number) => value === epoch.value
export class StaleSessionError extends Error {
  constructor() { super('Session changed; discarded a previous session response'); this.name = 'StaleSessionError' }
}
export function assertCurrentSession(value: number) {
  if (!isCurrentSession(value)) throw new StaleSessionError()
}
export function onSessionReset(reset: () => void) {
  resetters.add(reset)
  return () => { resetters.delete(reset) }
}
export function invalidateSession() {
  epoch.value++
  for (const reset of resetters) reset()
}

// Cookie sessions are shared between tabs. Clear in-memory state when another
// tab changes the persisted account; profile refresh re-establishes identity.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== 'user' && event.key !== null) return
    const identity = (value: string | null) => {
      try { return value ? JSON.parse(value).id : null } catch { return null }
    }
    if (event.key === null || identity(event.oldValue) !== identity(event.newValue)) invalidateSession()
  })
}

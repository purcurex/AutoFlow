import type { Router, RouteLocationNormalized } from 'vue-router'
import { defaultWorkbenchQueue, isWorkbenchRole } from './workbench'

// A queue visit outlives the list component: switching purchase/fulfillment view can remount it.
const visits = new WeakMap<Router, { key: string; visit: number; attempted: string }>()
export const workbenchNavigationKey = (route: Pick<RouteLocationNormalized, 'path' | 'query'>) => {
  const role = /^\/workbench\/([^/]+)$/.exec(route.path)?.[1]
  return isWorkbenchRole(role) ? `${route.path}:${String(route.query.queue ?? defaultWorkbenchQueue(role))}` : ''
}
export function navigationSyncGate(router: Router) {
  let state = visits.get(router)
  if (!state) {
    state = { key: workbenchNavigationKey(router.currentRoute.value), visit: 1, attempted: '' }
    visits.set(router, state)
    const shared = state
    router.afterEach((to, _from, failure) => {
      if (failure) return
      const key = workbenchNavigationKey(to)
      if (key !== shared.key) { shared.key = key; shared.visit++ }
    })
  }
  const shared = state
  return (session: number) => {
    const token = `${session}:${shared.visit}`
    if (!shared.key || shared.attempted === token) return false
    shared.attempted = token
    return true
  }
}

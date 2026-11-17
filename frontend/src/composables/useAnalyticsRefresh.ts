import { onBeforeUnmount, onMounted, onActivated, onDeactivated } from 'vue'
import { analyticsInterval, analyticsQueriedAt, analyticsRefreshDelay } from '@/utils/analytics-cache'
import { onSessionReset } from '@/utils/session'

/** Refresh mounted, visible analytics only; this never schedules FOP collection or list queries. */
export function useAnalyticsRefresh(refresh: () => Promise<unknown>, busy: () => boolean = () => false, checkRevision = false) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let queriedAt: number | undefined, mounted = false, active = true, disposed = false, running = false
  const stop = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  function schedule() {
    stop()
    if (!mounted || !active || disposed || queriedAt === undefined || document.hidden || running) return
    timer = setTimeout(tick, Math.max(1000, Math.min(checkRevision ? 60_000 : Infinity, analyticsRefreshDelay(queriedAt))))
  }
  async function tick() {
    if (!active || disposed || document.hidden || queriedAt === undefined) return
    if (checkRevision || Date.now() - queriedAt >= analyticsInterval()) {
      if (busy()) { timer = setTimeout(tick, 1000); return }
      running = true; queriedAt = Date.now()
      try { await refresh() } catch { /* The chart owns its visible error; retry at the next cadence. */ }
      finally { running = false }
    }
    schedule()
  }
  function updated(result: unknown) { queriedAt = analyticsQueriedAt(result); schedule() }
  const off = onSessionReset(() => { queriedAt = undefined; stop() })
  onMounted(() => { mounted = true; document.addEventListener('visibilitychange', schedule); schedule() })
  onActivated(() => { active = true; schedule() })
  onDeactivated(() => { active = false; stop() })
  onBeforeUnmount(() => { disposed = true; stop(); off(); document.removeEventListener('visibilitychange', schedule) })
  return { updated }
}

import { onScopeDispose } from 'vue'
import { onSessionReset } from '@/utils/session'

/** First selection is immediate; a rapid burst submits only its final selection. Instance-local. */
export function useChartQuerySchedule(query: () => unknown, invalidate: () => void, delay = 200) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  function cancel() { clearTimeout(timer); timer = undefined }
  function run() {
    cancel()
    last = Date.now()
    void query()
  }
  function schedule() {
    cancel()
    if (Date.now() - last >= delay) { run(); return }
    // An earlier response must not publish while the latest selection is queued.
    invalidate()
    timer = setTimeout(run, delay)
  }
  const off = onSessionReset(() => { cancel(); last = -Infinity })
  onScopeDispose(() => { cancel(); off() })
  return { schedule, cancel }
}

import { onScopeDispose, watch, type Ref } from 'vue'
import { onSessionReset } from '@/utils/session'

export interface DateRangeLimits {
  min?: string
  max?: string
  maxDays?: number
  enabled?: boolean
}

export function validDateRange(from: string, to: string, limits: DateRangeLimits = {}) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  return limits.enabled !== false && validDate(from) && validDate(to) && from <= to
    && (!limits.min || from >= limits.min) && (!limits.max || to <= limits.max)
    && (!limits.maxDays || (Date.parse(to) - Date.parse(from)) / 86400_000 < limits.maxDays)
}

/** Commit complete dates together; manual queries and session changes cancel pending work. */
export function useDateRangeQuery(from: Ref<string>, to: Ref<string>, query: () => unknown,
  limits: () => DateRangeLimits = () => ({})) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const key = () => `${from.value}/${to.value}`
  let submitted = key()
  const cancel = () => { clearTimeout(timer); timer = undefined }
  const isValid = () => validDateRange(from.value, to.value, limits())
  const markApplied = () => { cancel(); submitted = key() }
  watch([from, to], () => {
    cancel()
    if (!isValid() || key() === submitted) return
    timer = setTimeout(() => {
      if (!isValid() || key() === submitted) return
      markApplied()
      void query()
    }, 350)
  }, { flush: 'sync' })
  const off = onSessionReset(cancel)
  onScopeDispose(() => { cancel(); off() })
  return { cancel, isValid, markApplied }
}

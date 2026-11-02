import { computed, inject, onBeforeUnmount, provide, shallowRef, type ComputedRef, type InjectionKey } from 'vue'
import { getChartAccess, type ChartId, type EffectiveChartAccess } from '@/api/fop-chart-access'
import { assertCurrentSession, captureSession, onSessionReset } from '@/utils/session'
const capabilityKey: InjectionKey<ComputedRef<EffectiveChartAccess | undefined>> = Symbol('chartCapability')
export function useChartCapabilities() {
  const capability = inject(capabilityKey, computed(() => undefined))
  return {
    canViewDetails: computed(() => capability.value?.visible === true && capability.value.canViewDetails && !capability.value.summaryOnly),
    canExport: computed(() => capability.value?.visible === true && capability.value.canExport),
  }
}
/** A display capability snapshot. Refresh before dispatch; the server independently validates every request. */
export function useChartAccess(chartId: ChartId | (() => ChartId)) {
  const access = shallowRef<EffectiveChartAccess>()
  let requestId = 0
  const capability = computed(() => access.value)
  provide(capabilityKey, capability)
  function clear() { requestId++; access.value = undefined }
  async function refresh() {
    const session = captureSession(), request = ++requestId
    access.value = undefined
    const result = await getChartAccess()
    assertCurrentSession(session)
    if (request !== requestId) throw new Error('Chart access request superseded')
    access.value = result.charts?.find(chart => chart.chartId === (typeof chartId === 'function' ? chartId() : chartId))
    return access.value
  }
  function applyResponse(result: { chartAccess?: EffectiveChartAccess }) {
    const next = result.chartAccess
    access.value = next?.chartId === (typeof chartId === 'function' ? chartId() : chartId) ? next : undefined
    return access.value?.visible === true
  }
  async function requireDetails() {
    const result = await refresh()
    if (!result?.visible || !result.canViewDetails || result.summaryOnly) throw { code: 'chart_details_denied' }
    return result
  }
  const off = onSessionReset(clear)
  onBeforeUnmount(() => { off(); clear() })
  return { access, refresh, clear, requireDetails, applyResponse,
    visible: computed(() => access.value?.visible === true),
    canViewDetails: computed(() => access.value?.visible === true && access.value.canViewDetails && !access.value.summaryOnly),
    canExport: computed(() => access.value?.visible === true && access.value.canExport),
  }
}

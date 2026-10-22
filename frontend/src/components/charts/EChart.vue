<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsCoreOption, type EChartsType } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, ToolboxComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

use([BarChart, LineChart, AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, ToolboxComponent, SVGRenderer])
const props = defineProps<{ option: EChartsCoreOption; label: string }>()
export interface ChartClick { seriesId?: string; dataIndex?: number; name?: string }
export interface ChartZoom { start?: number; end?: number; startValue?: number; endValue?: number; batch?: ChartZoom[] }
const emit = defineEmits<{ select: [event: ChartClick]; zoom: [event: ChartZoom] }>()
defineExpose({ zoom: (event: ChartZoom) => {
  chart?.dispatchAction({ ...(event.batch?.[0] ?? event), type: 'dataZoom' }, { silent: true })
  rememberRange()
} })
const element = ref<HTMLDivElement>()
let chart: EChartsType | undefined
let observer: ResizeObserver | undefined
let frame: number | undefined
let dragOrigin: { x: number; y: number } | undefined
let dragged = false
let acceptedRanges: { dataZoomIndex: number; start: number; end: number }[] = []

function rememberRange() {
  const ranges = chart?.getOption().dataZoom as { start: number; end: number }[] | undefined
  acceptedRanges = (ranges ?? []).map(({ start, end }, dataZoomIndex) => ({ dataZoomIndex, start, end }))
}
function renderOption() {
  if (!chart) return
  const raw = props.option.dataZoom
  const sliders = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .filter(item => item.type !== 'inside')
    .map(item => ({ ...item, brushSelect: false, zoomLock: true }))
  chart.setOption({ ...props.option, dataZoom: sliders }, { notMerge: true })
  dragged = false
  rememberRange()
}
function startDrag(event: PointerEvent) {
  dragged = false
  dragOrigin = event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined
}
function moveDrag(event: PointerEvent) {
  if (dragOrigin && event.buttons && Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >= 3) dragged = true
}
function endDrag() { dragOrigin = undefined }
function changeRange(event: ChartZoom) {
  // ECharts also jumps its slider on a single track click. Restore that change;
  // only an actual drag may alter the user's window or synchronize other charts.
  if (!dragged) {
    if (acceptedRanges.length) chart?.dispatchAction({ type: 'dataZoom', batch: acceptedRanges }, { silent: true })
    return
  }
  rememberRange()
  emit('zoom', event)
}

onMounted(() => {
  if (!element.value) return
  chart = init(element.value, undefined, { renderer: 'svg' })
  renderOption()
  chart.on('click', event => emit('select', event as ChartClick))
  chart.on('datazoom', event => changeRange(event as ChartZoom))
  window.addEventListener('pointermove', moveDrag, true)
  window.addEventListener('pointerup', endDrag, true)
  window.addEventListener('pointercancel', endDrag, true)
  observer = new ResizeObserver(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => chart?.resize())
  })
  observer.observe(element.value)
})
watch(() => props.option, renderOption)
onBeforeUnmount(() => {
  observer?.disconnect()
  if (frame !== undefined) cancelAnimationFrame(frame)
  chart?.dispose()
  window.removeEventListener('pointermove', moveDrag, true)
  window.removeEventListener('pointerup', endDrag, true)
  window.removeEventListener('pointercancel', endDrag, true)
})
</script>

<template>
  <div ref="element" class="h-full min-h-64 w-full min-w-0" role="img" :aria-label="label" @pointerdown.capture="startDrag" />
</template>

import palettes from '@/theme/palettes.json'
import type { EChartsCoreOption } from 'echarts/core'

type ComponentOption = Record<string, any>

function mapComponents(value: any, transform: (item: ComponentOption) => ComponentOption) {
  return Array.isArray(value) ? value.map(transform) : transform(value)
}

/** Resolve shared chart colors and chrome without changing data, callbacks or caller-owned options. */
export function applyChartTheme(option: EChartsCoreOption, dark: boolean, palette: keyof typeof palettes = 'blue'): EChartsCoreOption {
  const tokens = palettes[palette][dark ? 'dark' : 'light']
  // Replace only the standard comparison hues; semantic categories retain their colors.
  const recolor = (value: any): any => {
    if (typeof value === 'string') {
      if (['#5364b8','#5465bc','#5873d4','#5566c2','#5470c6','#5368be'].includes(value.toLowerCase())) return tokens[0]
      if (['#91a8d6','#91a7d5','#91a7d6'].includes(value.toLowerCase())) return dark ? tokens[2] : '#' + tokens[0].slice(1).match(/../g)!.map(h => Math.round(parseInt(h,16)*.45+255*.55).toString(16).padStart(2,'0')).join('')
      return value
    }
    if (Array.isArray(value)) return value.map(recolor)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, recolor(item)]))
    return value
  }
  option = recolor({ ...option, color: option.color ?? [tokens[0], '#37a3a3', '#c89c4d', '#8f9db1', '#b77f99'] })
  if (!dark) return option
  const themed: EChartsCoreOption = { ...option, backgroundColor: '#18222E', darkMode: true }
  const axis = (item: ComponentOption) => ({
    ...item,
    axisLabel: { ...item.axisLabel, color: '#a9b9cf' },
    nameTextStyle: { ...item.nameTextStyle, color: '#a9b9cf' },
    axisLine: { ...item.axisLine, lineStyle: { ...item.axisLine?.lineStyle, color: '#40506a' } },
    axisTick: { ...item.axisTick, lineStyle: { ...item.axisTick?.lineStyle, color: '#40506a' } },
    splitLine: { ...item.splitLine, lineStyle: { ...item.splitLine?.lineStyle, color: '#2a374a' } },
    axisPointer: { ...item.axisPointer, lineStyle: { ...item.axisPointer?.lineStyle, color: '#849bc2' }, shadowStyle: { ...item.axisPointer?.shadowStyle, color: '#a9b9cf0d' } },
  })
  for (const key of ['xAxis', 'yAxis']) {
    if (option[key]) themed[key] = mapComponents(option[key], axis)
  }
  if (option.legend) themed.legend = mapComponents(option.legend, item => ({
    ...item, textStyle: { ...item.textStyle, color: '#b9c7db' },
    inactiveColor: '#536277', pageIconColor: '#a9b9cf', pageIconInactiveColor: '#40506a',
    pageTextStyle: { ...item.pageTextStyle, color: '#a9b9cf' },
  }))
  if (option.tooltip) themed.tooltip = mapComponents(option.tooltip, item => ({
    ...item, backgroundColor: '#1c2839', borderColor: '#40506a',
    textStyle: { ...item.textStyle, color: '#e4edf8' },
    extraCssText: `${item.extraCssText ?? ''};box-shadow:0 12px 32px #00000040;`,
  }))
  if (option.toolbox) themed.toolbox = mapComponents(option.toolbox, item => ({
    ...item, iconStyle: { ...item.iconStyle, borderColor: '#a4b5d3' },
    emphasis: { ...item.emphasis, iconStyle: { ...item.emphasis?.iconStyle, borderColor: '#d6e1ff' } },
  }))
  if (option.dataZoom) themed.dataZoom = mapComponents(option.dataZoom, item => ({
    ...item, backgroundColor: '#101926', borderColor: '#34445b', fillerColor: '#8fa9e329',
    textStyle: { ...item.textStyle, color: '#b9c7db' },
    handleStyle: { ...item.handleStyle, color: '#aabde8', borderColor: '#aabde8' },
    moveHandleStyle: { ...item.moveHandleStyle, color: '#6e84af' },
    dataBackground: {
      ...item.dataBackground,
      lineStyle: { ...item.dataBackground?.lineStyle, color: '#597297' },
      areaStyle: { ...item.dataBackground?.areaStyle, color: '#59729726' },
    },
    selectedDataBackground: {
      ...item.selectedDataBackground,
      lineStyle: { ...item.selectedDataBackground?.lineStyle, color: '#aabde8' },
      areaStyle: { ...item.selectedDataBackground?.areaStyle, color: '#8fa9e333' },
    },
  }))
  return themed
}
